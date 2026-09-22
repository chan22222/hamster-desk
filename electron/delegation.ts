import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DELEGATION_CAPS, DELEGATION_PRESETS, type DelegationConfig, type DelegationFileState, type DelegationPreset, type DelegationState } from '../shared/events'
import { loadUi, saveUi } from './ui-store'
import { claudeDir } from './watcher/paths'

/**
 * "명령 하달": a standing instruction that tells Claude when to hand work to sub-agents.
 *
 * The way a harness does it — not a sentence tacked onto every prompt, but a rule in the system
 * layer, read once per session. Claude Code reads the user's memory file (`~/.claude/CLAUDE.md`,
 * or `<CLAUDE_CONFIG_DIR>/CLAUDE.md` for another account) at the start of every session and puts
 * it into the system prompt for every project, so that is where the block goes: one marked block
 * per account, added and removed whole, the rest of the file left exactly as it was. Together with
 * the status line this is the second thing the app writes into an account's folder — and it is on
 * by default, because the user asked for it to be; the block says in its first line who owns it.
 *
 * A running session does not see a change until the next `claude` (the CLI caches its memory files
 * for the session; the terminal's /memory clears that cache by hand).
 *
 * Free of any `electron` import, so scripts/unit can drive it with tsx against temp files.
 */

const START = '<!-- hamster-desk:delegation start -->'
const END = '<!-- hamster-desk:delegation end -->'
const OWNER = '<!-- Hamster Desk 의 `명령 하달` 설정이 관리하는 블록이에요. 앱에서 끄면 통째로 사라지니 손으로 고치지 마세요. -->'
const UI_KEY = 'delegation'
const CUSTOM_MAX = 2000

const PRESETS = DELEGATION_PRESETS
const CAPS: readonly number[] = DELEGATION_CAPS

const LINES: Record<Exclude<DelegationPreset, 'custom'>, string[]> = {
  'when-needed': [
    '요청이 서로 독립적인 부분으로 나뉘고 각 부분이 혼자 맡길 만한 크기이면, 그 부분들을 서브에이전트(Agent 도구)에게 병렬로 맡기고 결과를 합쳐서 보고해.',
    '나눌 이유가 없는 작업은 그냥 직접 해. 작은 수정이나 질문 하나에 에이전트를 띄우지 마.',
  ],
  eager: [
    '부분이 둘 이상인 작업은 언제나 서브에이전트(Agent 도구)로 나눠서 병렬로 진행해. 너는 나누고, 조율하고, 합치는 일만 하고 각 부분의 실제 작업은 서브에이전트에게 맡겨.',
    '부분이 하나뿐인 작은 작업만 직접 해.',
  ],
  'plan-review': [
    '작업을 받으면 먼저 계획을 세워 부분으로 나누고, 각 부분을 서브에이전트(Agent 도구)에게 병렬로 맡겨.',
    '결과가 다 모이면 별도의 검토 서브에이전트에게 전체를 검토시키고, 지적된 것을 고친 뒤에 보고해.',
    '한 줄짜리 작업은 이 절차 없이 직접 해.',
  ],
}

export const DEFAULT_DELEGATION: DelegationConfig = { on: true, preset: 'when-needed', cap: 0, custom: '' }

export function sanitizeConfig(raw: unknown): DelegationConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof DelegationConfig, unknown>>
  const preset = PRESETS.some((p) => p.id === c.preset) ? (c.preset as DelegationPreset) : DEFAULT_DELEGATION.preset
  const cap = typeof c.cap === 'number' && CAPS.includes(c.cap) ? c.cap : 0
  return {
    on: c.on === undefined ? DEFAULT_DELEGATION.on : c.on === true,
    preset,
    cap,
    custom: typeof c.custom === 'string' ? c.custom.replace(/\r\n?/g, '\n').slice(0, CUSTOM_MAX) : '',
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

/** The block as it goes into the file (LF; the writer converts when the file is CRLF). */
export function blockFor(c: DelegationConfig): string {
  const body: string[] = []
  if (c.preset === 'custom') {
    for (const l of c.custom.split('\n')) if (l.trim()) body.push(l.trim().startsWith('-') ? l.trim() : `- ${l.trim()}`)
    if (body.length === 0) body.push(`- ${LINES['when-needed'][0]}`)
  } else {
    for (const l of LINES[c.preset]) body.push(`- ${l}`)
  }
  if (c.cap > 0) body.push(`- 동시에 띄우는 서브에이전트는 최대 ${c.cap}개까지만.`)
  return [START, OWNER, '## 작업 분담 (Hamster Desk)', ...body, END].join('\n')
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

/** What the file says about this config, without touching it. */
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
