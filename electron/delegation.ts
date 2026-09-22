import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DELEGATION_MODELS, DELEGATION_PRESETS, EFFORT_LEVELS, type DelegationConfig, type DelegationEffort, type DelegationFileState, type DelegationModel, type DelegationPreset, type DelegationState } from '../shared/events'
import { tr } from './lang'
import { loadUi, saveUi } from './ui-store'
import { claudeDir } from './watcher/paths'

/**
 * "멀티 에이전트": a standing instruction that tells Claude when to hand work to sub-agents.
 *
 * The way a harness does it — not a sentence tacked onto every prompt, but a rule in the system
 * layer, read once per session. Claude Code reads the user's memory file (`~/.claude/CLAUDE.md`,
 * or `<CLAUDE_CONFIG_DIR>/CLAUDE.md` for another account) at the start of every session and puts
 * it into the system prompt for every project, so that is where the block goes: one marked block
 * per account, added and removed whole, the rest of the file left exactly as it was. Together with
 * the status line this is the second thing the app writes into an account's folder — and it is on
 * by default, because the user asked for it to be; the block says in its first line who owns it.
 *
 * The block is worded in main's language (electron/lang.ts, `delegation.block` in shared/i18n) at
 * the moment it is built, never at module load, so it follows the language setting the same way
 * the UI does. The two markers are fixed bytes in every language: they are what finds the block.
 *
 * A running session does not see a change until the next `claude` (the CLI caches its memory files
 * for the session; the terminal's /memory clears that cache by hand).
 *
 * Free of any `electron` import, so scripts/unit can drive it with tsx against temp files.
 */

const START = '<!-- hamster-desk:delegation start -->'
const END = '<!-- hamster-desk:delegation end -->'
const UI_KEY = 'delegation'
const CUSTOM_MAX = 2000

const PRESETS = DELEGATION_PRESETS

export const DEFAULT_DELEGATION: DelegationConfig = { on: true, preset: 'when-needed', custom: '', model: 'inherit', effort: 'inherit' }

/**
 * Whatever ui.json holds, made into a config. A `cap` (how many sub-agents at once, 0.1.16–0.1.18)
 * in an older file is simply not read — nothing of it survives into the result.
 */
export function sanitizeConfig(raw: unknown): DelegationConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof DelegationConfig, unknown>>
  const preset = PRESETS.some((p) => p.id === c.preset) ? (c.preset as DelegationPreset) : DEFAULT_DELEGATION.preset
  const model = (DELEGATION_MODELS as readonly unknown[]).includes(c.model) ? (c.model as DelegationModel) : DEFAULT_DELEGATION.model
  const effort = c.effort === 'inherit' || (EFFORT_LEVELS as readonly unknown[]).includes(c.effort) ? (c.effort as DelegationEffort) : DEFAULT_DELEGATION.effort
  return {
    on: c.on === undefined ? DEFAULT_DELEGATION.on : c.on === true,
    preset,
    custom: typeof c.custom === 'string' ? c.custom.replace(/\r\n?/g, '\n').slice(0, CUSTOM_MAX) : '',
    model,
    effort,
  }
}

export function loadConfig(): DelegationConfig {
  return sanitizeConfig(loadUi()[UI_KEY])
}

export function storeConfig(c: DelegationConfig): DelegationConfig {
  const clean = sanitizeConfig(c)
  saveUi({ [UI_KEY]: clean })
  return clean
}

/**
 * The block as it goes into the file (LF; the writer converts when the file is CRLF), in main's
 * language as of now: the owner line, the heading, the preset's line and — when set — the lines
 * that say what the sub-agents run with all come from `tr().delegation.block`.
 *
 * One short line per preset — what the user would type at the end of a prompt, no more. A longer
 * brief (report formats, test discipline, when not to) made Claude over-test and over-report; the
 * model knows how to split work, it only needs to be told to.
 */
export function blockFor(c: DelegationConfig): string {
  const b = tr().delegation.block
  const owner = `<!-- ${b.owner} -->`
  const body: string[] = []
  if (c.preset === 'custom') {
    for (const l of c.custom.split('\n')) if (l.trim()) body.push(l.trim().startsWith('-') ? l.trim() : `- ${l.trim()}`)
    if (body.length === 0) body.push(`- ${b.lines['when-needed']}`)
  } else {
    body.push(`- ${b.lines[c.preset]}`)
  }
  // the Agent tool's `model` / `effort` options, spelled out; `inherit` is the CLI's own default and says nothing
  if (c.model === 'lower') body.push(`- ${b.modelLower}`)
  else if (c.model !== 'inherit') body.push(`- ${b.model(c.model)}`)
  if (c.effort !== 'inherit') body.push(`- ${b.effort(c.effort)}`)
  return [START, owner, b.heading, ...body, END].join('\n')
}

const BLOCK_RE = new RegExp(`\\n*${START.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}[\\s\\S]*?${END.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}\\n*`, 'g')

/** the file with our block taken out (and the blank lines that framed it) */
export function withoutBlock(text: string): string {
  return text.replace(BLOCK_RE, (m, offset: number, whole: string) => {
    // one blank line where it stood between two things, the file's final newline where it was
    // last, nothing where it was the whole file
    const atStart = offset === 0
    const atEnd = offset + m.length >= whole.length
    if (atStart) return ''
    return atEnd ? '\n' : '\n\n'
  })
}

/** the file as it should read for this config: the rest untouched, our block last (or gone) */
export function withBlock(text: string, c: DelegationConfig): string {
  const rest = withoutBlock(text).replace(/\s+$/, '')
  if (!c.on) return rest ? rest + '\n' : ''
  return (rest ? rest + '\n\n' : '') + blockFor(c) + '\n'
}

export function claudeMdOf(configDir: string | null | undefined): string {
  return join(configDir || claudeDir(), 'CLAUDE.md')
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * What the file says about this config, without touching it. The block in the file is compared to
 * `blockFor(c)` as worded right now, so after a language change a block written in the old language
 * counts as 'stale' — and the next sync (app start, any change in the menu) rewrites it in the new one.
 */
export function fileState(file: string, c: DelegationConfig): DelegationFileState {
  const text = readText(file)
  const m = text.match(BLOCK_RE)
  if (!m) return c.on ? 'none' : 'installed' // off and no block: exactly what was asked for
  const present = m[0].replace(/\r\n/g, '\n').trim()
  return c.on && present === blockFor(c) ? 'installed' : 'stale'
}

/**
 * Make the file match the config. Atomic (temp + rename), keeps the file's own line endings, and
 * a file this leaves empty is removed rather than left as a zero-byte CLAUDE.md. Returns the state
 * the file is in afterwards and the reason when it could not be written.
 */
export function applyToFile(file: string, c: DelegationConfig): { state: DelegationFileState; error: string | null } {
  try {
    const existed = existsSync(file)
    const raw = existed ? readFileSync(file, 'utf8') : ''
    const crlf = raw.includes('\r\n')
    const next = withBlock(raw.replace(/\r\n/g, '\n'), c)
    const out = crlf ? next.replace(/\n/g, '\r\n') : next
    if (out === raw) return { state: fileState(file, c), error: null }
    if (!out) {
      if (existed) rmSync(file, { force: true })
      return { state: 'installed', error: null }
    }
    mkdirSync(join(file, '..'), { recursive: true }) // a brand-new account has no folder yet
    const tmp = `${file}.hamster-tmp`
    writeFileSync(tmp, out, 'utf8')
    renameSync(tmp, file)
    return { state: fileState(file, c), error: null }
  } catch (e) {
    return { state: 'error', error: String((e as Error)?.message ?? e).slice(0, 160) }
  }
}

export interface DelegationAccountRef {
  id: string
  /** `CLAUDE_CONFIG_DIR`; null = the CLI's own account */
  dir: string | null
}

/**
 * Every account's file brought in line with the stored config. `readOnly` (a capture run) only
 * reports — a blind screenshot run must never write into somebody's real ~/.claude.
 */
export function syncDelegation(accounts: DelegationAccountRef[], readOnly = false): DelegationState {
  const config = loadConfig()
  const state: DelegationState = { config, accounts: {} }
  for (const a of accounts) {
    const file = claudeMdOf(a.dir)
    const r = readOnly ? { state: fileState(file, config), error: null } : applyToFile(file, config)
    state.accounts[a.id] = { ...r, file }
  }
  return state
}
