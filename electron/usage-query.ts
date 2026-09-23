import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import type { RateWindow, UsageWindows } from '../shared/events'
import { claudeInvocation, cleanEnv, findClaude, stopTree, type ClaudeInvocation } from './env'

/**
 * The per-model weekly windows, asked of the CLI itself.
 *
 * The status line (electron/statusline.ts) only ever carries the two windows the API sends back
 * in response headers: the 5-hour one and the all-model weekly one. But a Max plan also has a
 * weekly budget *per model* — "Current week (Fable)" on the CLI's /usage screen — and that one can
 * run out first without the gauges ever showing it. The CLI learns those from its usage endpoint,
 * and exposes the answer over its SDK control channel: a headless `claude -p` fed one
 * `get_usage` control request on stdin answers with `rate_limits.model_scoped` and exits when
 * stdin closes. No model is called, no token is spent — only the usage endpoint is asked, under
 * the account's own login.
 *
 * Asked at start and every ten minutes for every account with a login, and whenever the usage
 * popover asks for fresh numbers. Free of any `electron` import, so scripts/unit can drive the
 * parser with tsx.
 */

const TIMEOUT_MS = 30_000
const EVERY_MS = 10 * 60_000
const FIRST_MS = 20_000
/** the answer is a few hundred bytes; a CLI that keeps talking past this is not answering */
const OUT_MAX = 1024 * 1024

const REQUEST = JSON.stringify({ type: 'control_request', request_id: 'usage', request: { subtype: 'get_usage', skip_behaviors: true } }) + '\n'

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** `resets_at` comes back as an ISO string here, as seconds in the status line; take both */
function at(v: unknown): number | null {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

function window(v: unknown): RateWindow | null {
  if (!v || typeof v !== 'object') return null
  const w = v as Record<string, unknown>
  const used = num(w.utilization) ?? num(w.used_percentage) ?? num(w.percent)
  if (used === null) return null
  return { usedPercentage: used, resetsAt: at(w.resets_at) }
}

/** Read the `control_response` out of the CLI's stream-json lines. null when there is none. */
export function parseUsage(stdout: string, profileId: string, ts = Date.now()): UsageWindows | null {
  for (const line of stdout.split(/\r?\n/)) {
    const s = line.trim()
    if (!s.startsWith('{')) continue
    let j: Record<string, unknown>
    try {
      j = JSON.parse(s) as Record<string, unknown>
    } catch {
      continue
    }
    if (j.type !== 'control_response') continue
    const env = (j.response ?? {}) as Record<string, unknown>
    if (env.subtype !== 'success') return null
    const r = (env.response ?? {}) as Record<string, unknown>
    const rl = (r.rate_limits ?? {}) as Record<string, unknown>
    const models: Record<string, RateWindow> = {}
    // the server-labelled buckets first, then the two named ones older CLIs reported instead
    for (const m of Array.isArray(rl.model_scoped) ? (rl.model_scoped as unknown[]) : []) {
      const o = (m ?? {}) as Record<string, unknown>
      const w = window(o)
      if (w && typeof o.display_name === 'string' && o.display_name) models[o.display_name] = w
    }
    for (const [key, name] of [
      ['seven_day_opus', 'Opus'],
      ['seven_day_sonnet', 'Sonnet'],
    ] as const) {
      const w = window(rl[key])
      if (w && !(name in models)) models[name] = w
    }
    return {
      profileId,
      ts,
      fiveHour: window(rl.five_hour),
      sevenDay: window(rl.seven_day),
      models,
      subscription: typeof r.subscription_type === 'string' ? r.subscription_type : null,
    }
  }
  return null
}

export type UsageExec = (configDir: string | null, signal: AbortSignal) => Promise<string>

/** The real thing: one headless claude, one control request, stdin closed, stdout collected. */
function runClaude(configDir: string | null, signal: AbortSignal): Promise<string> {
  const bin = findClaude()
  if (!bin) return Promise.reject(new Error('no-claude'))
  const argv = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    'haiku',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--tools',
    '',
    '--strict-mcp-config',
    '--setting-sources',
    '',
  ]
  let inv: ClaudeInvocation
  try {
    inv = claudeInvocation(bin, argv)
  } catch (e) {
    return Promise.reject(e as Error)
  }
  const env: Record<string, string> = { ...cleanEnv(), MAX_THINKING_TOKENS: '0' }
  // the question is about the *subscription*; a key in the environment would answer for the key
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir
  return new Promise((resolve, reject) => {
    // stderr is not read, so it is not a pipe either: one nobody drains fills up, and the CLI then
    // stalls on its next write until the timeout
    const child = spawn(inv.file, inv.args, { cwd: homedir(), env, windowsHide: true, windowsVerbatimArguments: inv.verbatim, stdio: ['pipe', 'pipe', 'ignore'] })
    let out = ''
    let done = false
    const finish = (err?: Error): void => {
      if (done) return
      done = true
      if (err) reject(err)
      else resolve(out)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      out += d
      // the answer is one line; once it is here the process has nothing more to say
      if (out.includes('"control_response"')) {
        finish()
        setTimeout(() => stopTree(child), 500).unref()
      } else if (out.length > OUT_MAX) {
        finish(new Error('too-long'))
        stopTree(child)
      }
    })
    child.on('error', (e) => finish(e))
    child.on('close', () => finish(new Error(out.trim() ? 'no-response' : 'exited')))
    signal.addEventListener(
      'abort',
      () => {
        stopTree(child) // the tree: through cmd.exe the child is only the interpreter (electron/env.ts)
        finish(new Error('aborted'))
      },
      { once: true },
    )
    child.stdin.on('error', () => {})
    child.stdin.end(REQUEST)
  })
}

export interface UsageAccountRef {
  id: string
  dir: string | null
  /** an account nobody has logged into has nothing to ask */
  loggedIn: boolean
}

export interface UsageQuerierOptions {
  accounts: () => UsageAccountRef[]
  exec?: UsageExec
}

/** Emits 'usage' with a UsageWindows per account, on the schedule above and on `refresh()`. */
export class UsageQuerier extends EventEmitter {
  private readonly accounts: () => UsageAccountRef[]
  private readonly exec: UsageExec
  private readonly inflight = new Map<string, AbortController>()
  private timer: ReturnType<typeof setInterval> | null = null
  private first: ReturnType<typeof setTimeout> | null = null

  constructor(opts: UsageQuerierOptions) {
    super()
    this.accounts = opts.accounts
    this.exec = opts.exec ?? runClaude
  }

  start(): void {
    if (this.timer) return
    this.first = setTimeout(() => void this.refresh(), FIRST_MS)
    this.timer = setInterval(() => void this.refresh(), EVERY_MS)
  }

  stop(): void {
    if (this.first) clearTimeout(this.first)
    if (this.timer) clearInterval(this.timer)
    this.first = null
    this.timer = null
    for (const c of this.inflight.values()) c.abort()
    this.inflight.clear()
  }

  /** Ask now — every logged-in account, or one. Resolves when the answers are in (or failed). */
  async refresh(profileId?: string): Promise<UsageWindows[]> {
    const jobs = this.accounts()
      .filter((a) => a.loggedIn && (!profileId || a.id === profileId) && !this.inflight.has(a.id))
      .map((a) => this.ask(a))
    return (await Promise.all(jobs)).filter((u): u is UsageWindows => u !== null)
  }

  private async ask(a: UsageAccountRef): Promise<UsageWindows | null> {
    const ctrl = new AbortController()
    this.inflight.set(a.id, ctrl)
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const u = parseUsage(await this.exec(a.dir, ctrl.signal), a.id)
      if (u) this.emit('usage', u)
      return u
    } catch {
      return null // the gauges keep what the status line said; asked again in ten minutes
    } finally {
      clearTimeout(timer)
      if (this.inflight.get(a.id) === ctrl) this.inflight.delete(a.id)
    }
  }
}
