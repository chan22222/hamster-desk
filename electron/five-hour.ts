import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import { claudeInvocation, cleanEnv, findClaude, stopTree, type ClaudeInvocation } from './env'
import { tr } from './lang'
import { loadUi, saveUi } from './ui-store'
import type { FiveHourAccount, FiveHourState, RateWindow } from '../shared/events'

/**
 * Opt-in, per account: start the next 5-hour window the moment the last one ends.
 *
 * The subscription's 5-hour window does not run on a clock — it starts with the first message after
 * the previous one ran out. So an account left alone overnight starts its window whenever the user
 * types the first thing in the morning, and a heavy afternoon then hits the limit with hours to go.
 * Sending one tiny message right after each reset keeps the windows back to back, and the user
 * always walks into one that is already counting down.
 *
 * The message is a headless `claude -p` under the account's own `CLAUDE_CONFIG_DIR`, with the same
 * flags as the bubble summaries (electron/summarize.ts) plus `stream-json`: the CLI then also prints
 * a `rate_limit_event` whose `unifiedWindows.five_hour.resetsAt` is exactly when the window it just
 * started (or found running) ends. Measured: ~380 tokens in, 4 out, 2 s.
 *
 * When to send comes from two witnesses: the status-line snapshots (the account talking in a
 * terminal, electron/statusline.ts) and the answer to our own last message. A snapshot can only move
 * the end *later*: the CLI also redraws its status line from rate limits it cached hours ago, and an
 * end that already passed would otherwise send a message on every redraw. Knowing nothing is treated
 * as "no window running" — a message sent into a running window changes nothing, it only tells us
 * when that window ends.
 *
 * Free of any `electron` import (like ui-store.ts), so scripts/unit can drive it with tsx.
 */

export const WINDOW_MS = 5 * 60 * 60_000
/** after the reset, so the message lands in the new window and not in the last second of the old one */
export const GRACE_MS = 60_000
const TICK_MS = 30_000
/** the status watcher's first scan reports what every account last said; wait for it */
const FIRST_TICK_MS = 15_000
const TIMEOUT_MS = 90_000
/** after the n-th failure in a row (a sleeping network, a login that expired) */
const BACKOFF_MIN = [2, 5, 15, 30, 60]
const UI_KEY = 'fiveHourStart'

const SYSTEM = 'Reply with the single word OK.'
const MESSAGE = 'hi'

/** What is kept per account in ui.json. */
export interface FiveHourEntry {
  on: boolean
  /** unix ms the account's 5-hour window ends, as far as anyone told us */
  resetsAt: number | null
  /** unix ms of the last message this sent */
  lastAt: number | null
  error: string | null
  failures: number
  /** not before this (unix ms): a backoff, or a limit that has to run out first */
  retryAt: number | null
}

const blank = (): FiveHourEntry => ({ on: false, resetsAt: null, lastAt: null, error: null, failures: 0, retryAt: null })

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** the CLI says seconds; the status line has said both over time */
const ms = (v: unknown): number | null => {
  const n = num(v)
  if (n === null || n <= 0) return null
  return n < 1e12 ? n * 1000 : n
}

export function sanitizeEntries(raw: unknown): Record<string, FiveHourEntry> {
  const out: Record<string, FiveHourEntry> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z0-9-]{1,32}$/.test(id) || !v || typeof v !== 'object') continue
    const e = v as Record<string, unknown>
    out[id] = {
      on: e.on === true,
      resetsAt: num(e.resetsAt),
      lastAt: num(e.lastAt),
      error: typeof e.error === 'string' ? e.error.slice(0, 200) : null,
      failures: Math.max(0, Math.floor(num(e.failures) ?? 0)),
      retryAt: num(e.retryAt),
    }
  }
  return out
}

/** When the next message is due (unix ms; already past = now). null = off. */
export function dueAt(e: FiveHourEntry): number | null {
  if (!e.on) return null
  return Math.max(e.resetsAt !== null ? e.resetsAt + GRACE_MS : 0, e.retryAt ?? 0)
}

export function backoffMs(failures: number): number {
  return BACKOFF_MIN[Math.min(BACKOFF_MIN.length, Math.max(1, failures)) - 1] * 60_000
}

export interface PingResult {
  /** unix ms the 5-hour window ends, when the CLI said so */
  resetsAt: number | null
  /** a limit refused the message: unix ms it lifts, when known */
  blockedUntil: number | null
  /** which one (`five_hour`, `seven_day`, …) */
  blockedBy: string | null
  /** the CLI answered but reported no rate limits at all — not a subscription login, most likely */
  noLimits: boolean
  error: string | null
}

/** Read the `--output-format stream-json` lines of one call. */
export function parsePing(stdout: string): PingResult {
  let resetsAt: number | null = null
  let blockedUntil: number | null = null
  let blockedBy: string | null = null
  let sawLimits = false
  let result: Record<string, unknown> | null = null
  for (const line of stdout.split(/\r?\n/)) {
    const s = line.trim()
    if (!s.startsWith('{')) continue
    let j: Record<string, unknown>
    try {
      j = JSON.parse(s) as Record<string, unknown>
    } catch {
      continue
    }
    if (j.type === 'result') result = j
    if (j.type !== 'rate_limit_event' || !j.rate_limit_info || typeof j.rate_limit_info !== 'object') continue
    sawLimits = true
    const info = j.rate_limit_info as Record<string, unknown>
    const windows = (info.unifiedWindows ?? {}) as Record<string, Record<string, unknown> | undefined>
    const five = ms(windows.five_hour?.resetsAt) ?? (info.rateLimitType === 'five_hour' ? ms(info.resetsAt) : null)
    if (five !== null) resetsAt = five
    if (info.status === 'rejected') {
      blockedUntil = ms(info.resetsAt) ?? blockedUntil
      blockedBy = typeof info.rateLimitType === 'string' ? info.rateLimitType : blockedBy
    }
  }
  const base = { resetsAt, blockedUntil, blockedBy, noLimits: false }
  // worded in main's language at the moment the answer is read (electron/lang.ts)
  if (!result) return { ...base, error: blockedUntil ? null : tr().main.noReply }
  if (result.is_error === true) {
    const why = typeof result.result === 'string' && result.result.trim() ? result.result.trim().split(/\r?\n/)[0].slice(0, 160) : String(result.subtype ?? tr().common.failed)
    return { ...base, error: why }
  }
  return { ...base, noLimits: !sawLimits, error: null }
}

/** One message under one account; resolves with stdout whatever the exit code (errors are on stdout too). */
export type PingExec = (configDir: string | null, signal: AbortSignal) => Promise<string>

function runClaude(configDir: string | null, signal: AbortSignal): Promise<string> {
  const bin = findClaude()
  if (!bin) return Promise.reject(new Error(tr().main.noClaude))
  const argv = [
    '-p',
    '--model',
    'haiku',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--tools',
    '',
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--output-format',
    'stream-json',
    '--verbose',
    '--system-prompt',
    SYSTEM,
    MESSAGE,
  ]
  let inv: ClaudeInvocation
  try {
    inv = claudeInvocation(bin, argv)
  } catch (e) {
    return Promise.reject(e as Error)
  }
  const env: Record<string, string> = { ...cleanEnv(), MAX_THINKING_TOKENS: '0' }
  // The point is the subscription's window. A key in the environment would take precedence over
  // the account's login: the message would be billed to that key and start no window at all.
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir
  return new Promise((resolve, reject) => {
    const child = execFile(
      inv.file,
      inv.args,
      { cwd: homedir(), env, windowsHide: true, windowsVerbatimArguments: inv.verbatim, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = String(stdout ?? '')
        if (err && !out.includes('"type":"result"')) {
          const why = String(stderr ?? '').trim().split(/\r?\n/)[0] || err.message
          return reject(new Error(why.slice(0, 160)))
        }
        resolve(out)
      },
    )
    // the timeout (or stop()) takes the whole tree — through cmd.exe the child is only the interpreter
    const stop = (): void => stopTree(child)
    if (signal.aborted) stop()
    else signal.addEventListener('abort', stop, { once: true })
    // with a pipe on stdin that nobody closes, `-p` first waits 3 s for input it will never get
    child.stdin?.on('error', () => {})
    child.stdin?.end()
  })
}

export interface FiveHourAccountRef {
  id: string
  /** `CLAUDE_CONFIG_DIR`; null = the CLI's own account */
  dir: string | null
}

export interface FiveHourOptions {
  /** the accounts as they are right now (electron/profiles.ts) */
  accounts: () => FiveHourAccountRef[]
  exec?: PingExec
  now?: () => number
}

/** Emits 'change' with a FiveHourState whenever something the UI shows moved. */
export class FiveHourStarter extends EventEmitter {
  private entries: Record<string, FiveHourEntry>
  private readonly inflight = new Map<string, AbortController>()
  private readonly accounts: () => FiveHourAccountRef[]
  private readonly exec: PingExec
  private readonly now: () => number
  private timer: ReturnType<typeof setInterval> | null = null
  private first: ReturnType<typeof setTimeout> | null = null

  constructor(opts: FiveHourOptions) {
    super()
    this.accounts = opts.accounts
    this.exec = opts.exec ?? runClaude
    this.now = opts.now ?? Date.now
    this.entries = sanitizeEntries(loadUi()[UI_KEY])
  }

  start(): void {
    if (this.timer) return
    this.first = setTimeout(() => void this.tick(), FIRST_TICK_MS)
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.first) clearTimeout(this.first)
    if (this.timer) clearInterval(this.timer)
    this.first = null
    this.timer = null
    for (const c of this.inflight.values()) c.abort()
    this.inflight.clear()
  }

  state(): FiveHourState {
    const out: FiveHourState = {}
    for (const a of this.accounts()) {
      const e = this.entries[a.id] ?? blank()
      const due = dueAt(e)
      const view: FiveHourAccount = {
        on: e.on,
        resetsAt: e.resetsAt,
        lastAt: e.lastAt,
        nextAt: due === null ? null : Math.max(due, this.now()),
        sending: this.inflight.has(a.id),
        error: e.error,
      }
      out[a.id] = view
    }
    return out
  }

  set(id: string, on: boolean): FiveHourState {
    if (!this.accounts().some((a) => a.id === id)) return this.state()
    const e = this.entry(id)
    e.on = on
    // a fresh start: whatever went wrong last time is not a reason to wait now
    e.failures = 0
    e.error = null
    e.retryAt = null
    this.save()
    if (on) void this.tick()
    return this.state()
  }

  /** A status-line snapshot of this account: the 5-hour window it reports. Only ever moves the end later. */
  observe(id: string, w: RateWindow | null): void {
    if (!w || w.resetsAt === null) return
    const e = this.entry(id)
    if (w.resetsAt <= (e.resetsAt ?? 0)) return
    e.resetsAt = w.resetsAt
    if (e.on) {
      this.save()
      this.changed()
    }
  }

  /** Send whatever is due. Also called on resume from sleep, when every timer is late at once. */
  async tick(): Promise<void> {
    const now = this.now()
    const jobs: Promise<void>[] = []
    for (const a of this.accounts()) {
      const e = this.entries[a.id]
      if (!e || this.inflight.has(a.id)) continue
      const due = dueAt(e)
      if (due === null || due > now) continue
      jobs.push(this.ping(a, e))
    }
    await Promise.all(jobs)
  }

  private entry(id: string): FiveHourEntry {
    return (this.entries[id] ??= blank())
  }

  private async ping(a: FiveHourAccountRef, e: FiveHourEntry): Promise<void> {
    const ctrl = new AbortController()
    this.inflight.set(a.id, ctrl)
    this.changed()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      ctrl.abort()
    }, TIMEOUT_MS)
    const at = this.now()
    e.lastAt = at
    try {
      const r = parsePing(await this.exec(a.dir, ctrl.signal))
      if (r.resetsAt !== null && r.resetsAt > (e.resetsAt ?? 0)) e.resetsAt = r.resetsAt
      if (r.blockedUntil !== null) {
        // A limit that has to run out first; asking sooner changes nothing. The 5-hour one means its
        // window is running (and used up) — nothing is wrong. Never sooner than a backoff: a lift
        // time that is already past must not turn into a message on every tick.
        e.error = r.blockedBy === 'five_hour' ? null : tr().main.rateLimited
        e.retryAt = Math.max(r.blockedUntil + GRACE_MS, at + backoffMs(1))
        e.failures = 0
      } else if (r.error) {
        throw new Error(r.error)
      } else {
        e.failures = 0
        e.retryAt = null
        e.error = r.noLimits ? tr().main.noLimits : null
        // said by the CLI when it can; otherwise the window this message just opened ends five hours from now
        e.resetsAt = r.resetsAt !== null && r.resetsAt > at ? r.resetsAt : at + WINDOW_MS
      }
    } catch (err) {
      if (ctrl.signal.aborted && !timedOut) return // stop(): the app is quitting
      e.failures++
      e.error = timedOut ? tr().main.timedOut : ((err as Error)?.message ?? tr().common.failed)
      e.retryAt = at + backoffMs(e.failures)
    } finally {
      clearTimeout(timer)
      if (this.inflight.get(a.id) === ctrl) this.inflight.delete(a.id)
    }
    this.save()
    this.changed()
  }

  private save(): void {
    // only the accounts that still exist; a forgotten one takes its entry with it
    const ids = new Set(this.accounts().map((a) => a.id))
    const kept: Record<string, FiveHourEntry> = {}
    for (const [id, e] of Object.entries(this.entries)) if (ids.has(id) && (e.on || e.lastAt !== null)) kept[id] = e
    saveUi({ [UI_KEY]: Object.keys(kept).length ? kept : null })
  }

  private changed(): void {
    this.emit('change', this.state())
  }
}
