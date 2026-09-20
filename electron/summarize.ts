import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { claudeInvocation, cleanEnv, findClaude } from './env'
import type { BubbleRequest, BubbleResult, BubbleState } from '../shared/events'

/**
 * Speech-bubble summaries through the user's own Claude subscription — no API key, no SDK.
 *
 * The desk shows whatever the assistant literally wrote, which is usually a paragraph (and often
 * English tool chatter), so the bubble gets cut off. Instead we ask Haiku for one short line, run
 * as a headless `claude -p`:
 *
 *   MAX_THINKING_TOKENS=0 claude -p --model haiku --no-session-persistence --disable-slash-commands \
 *     --tools "" --strict-mcp-config --setting-sources "" --output-format json \
 *     --system-prompt "<system>" "<user>"
 *
 * Every flag earns its place:
 *  - MAX_THINKING_TOKENS=0 — without it Haiku thinks ~5,000 tokens and the call takes 44s instead
 *    of 2.8s. Never drop this one.
 *  - --no-session-persistence — no ~/.claude/sessions/<pid>.json and no transcript, so the desk
 *    watcher does not see these calls as another hamster.
 *  - --tools "" / --strict-mcp-config / --setting-sources "" / --disable-slash-commands — nothing of
 *    the user's config is loaded, so the call stays at ~550 input tokens (~$0.0007, 2.8s measured).
 *  - --output-format json — one JSON object on stdout with `result`, `is_error`, `usage`, cost.
 *
 * The environment must come from cleanEnv(): if the app itself was started inside a Claude Code
 * session, CLAUDECODE & friends would be inherited and the CLI would treat this as a nested session.
 *
 * Nothing here may import 'electron' — the module has to run under plain node/tsx (see
 * scripts/bubble-smoke.ts).
 */

const SYSTEM = [
  'You voice a pixel-art hamster that stands in for an AI coding assistant working in a terminal.',
  'Given what the assistant just said (or the task it was just assigned), write the hamster’s speech bubble: what it is doing or about to do right now.',
  'Rules: write in {lang}; first person, present tense, one line; at most {maxChars} characters; keep concrete nouns (file names, features, commands); drop greetings, apologies and filler; no quotes, no emoji, no markdown, no trailing period. Output only the bubble text.',
].join('\n')

const INPUT_MAX = 1200
const CACHE_MAX = 500
const AVAIL_TTL = 60_000
const FAIL_LIMIT = 3
const DISABLE_MS = 5 * 60_000
const NO_CLAUDE = 'claude 명령을 찾을 수 없어요'

export function buildSystemPrompt(lang: string, maxChars: number): string {
  return SYSTEM.split('{lang}').join(lang).split('{maxChars}').join(String(maxChars))
}

export function buildUserPrompt(kind: BubbleRequest['kind'], text: string): string {
  const body = text.slice(0, INPUT_MAX)
  const head = kind === 'assigned' ? 'The hamster was just hired for this task:' : 'The assistant said:'
  return `${head}\n"""\n${body}\n"""`
}

const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
]

/** Models like wrapping one-liners in quotes or backticks; strip that and keep the bubble short. */
export function cleanBubble(raw: string, maxChars: number): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  s = s
    .replace(/^```[A-Za-z0-9_-]*\s*/, '')
    .replace(/\s*```$/, '')
    .replace(/`/g, '')
    .trim()
  for (let i = 0; i < 4; i++) {
    let stripped = false
    for (const [a, b] of QUOTE_PAIRS) {
      if (s.length > a.length + b.length - 1 && s.startsWith(a) && s.endsWith(b)) {
        s = s.slice(a.length, s.length - b.length).trim()
        stripped = true
      }
    }
    if (!stripped) break
  }
  const limit = Math.max(1, maxChars + 12)
  if (s.length > limit) s = s.slice(0, limit - 1).trimEnd() + '…'
  return s
}

export type BubbleExec = (system: string, user: string, signal: AbortSignal) => Promise<string>

export interface BubbleOptions {
  concurrency?: number
  timeoutMs?: number
  exec?: BubbleExec
}

interface Job {
  req: BubbleRequest
  cacheKey: string
  done: (r: BubbleResult) => void
}

function cacheKeyOf(r: BubbleRequest): string {
  return `${r.lang}|${r.kind}|${r.maxChars}|${r.text}`
}

/** Default runner: the real `claude -p` call described at the top of this file. */
function runClaude(system: string, user: string, signal: AbortSignal): Promise<string> {
  const bin = findClaude()
  if (!bin) return Promise.reject(new Error('no-claude'))
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
    'json',
    '--system-prompt',
    system,
    user,
  ]
  const inv = claudeInvocation(bin, argv)
  return new Promise((resolve, reject) => {
    execFile(
      inv.file,
      inv.args,
      {
        cwd: homedir(),
        env: { ...cleanEnv(), MAX_THINKING_TOKENS: '0' },
        windowsHide: true,
        windowsVerbatimArguments: inv.verbatim,
        maxBuffer: 4 * 1024 * 1024,
        signal,
      },
      (err, stdout) => {
        if (err) return reject(err)
        resolve(String(stdout))
      },
    )
  })
}

export class BubbleSummarizer {
  private readonly concurrency: number
  private readonly timeoutMs: number
  private readonly exec: BubbleExec
  private readonly injected: boolean
  private readonly cache = new Map<string, string>()
  private readonly queue: Job[] = []
  private readonly running = new Set<AbortController>()
  private avail: { at: number; ok: boolean } | null = null
  private fails = 0
  private disabledUntil: number | null = null
  private disposed = false

  constructor(opts?: BubbleOptions) {
    this.concurrency = Math.max(1, opts?.concurrency ?? 2)
    this.timeoutMs = Math.max(1000, opts?.timeoutMs ?? 20_000)
    this.exec = opts?.exec ?? runClaude
    this.injected = opts?.exec != null
  }

  state(): BubbleState {
    const ok = this.available()
    if (this.disabledUntil != null && this.disabledUntil <= Date.now()) {
      this.disabledUntil = null
      this.fails = 0
    }
    return { available: ok, reason: ok ? null : NO_CLAUDE, disabledUntil: this.disabledUntil }
  }

  summarize(req: BubbleRequest): Promise<BubbleResult> {
    const key = req.key
    if (this.disposed) return Promise.resolve({ key, text: null, error: 'disposed' })
    const st = this.state()
    if (!st.available) return Promise.resolve({ key, text: null, error: 'unavailable' })
    if (st.disabledUntil != null) return Promise.resolve({ key, text: null, error: 'disabled' })

    const cacheKey = cacheKeyOf(req)
    const hit = this.cache.get(cacheKey)
    if (hit != null) {
      this.cache.delete(cacheKey)
      this.cache.set(cacheKey, hit)
      return Promise.resolve({ key, text: hit, error: null })
    }

    // One queued request per lane: while a hamster keeps talking, only its newest line is worth
    // summarizing. Already-running calls are left alone — the renderer drops stale keys.
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].req.lane === req.lane) {
        const old = this.queue.splice(i, 1)[0]
        old.done({ key: old.req.key, text: null, error: 'superseded' })
      }
    }

    return new Promise<BubbleResult>((resolve) => {
      this.queue.push({ req, cacheKey, done: resolve })
      this.pump()
    })
  }

  dispose(): void {
    this.disposed = true
    while (this.queue.length) {
      const j = this.queue.shift()!
      j.done({ key: j.req.key, text: null, error: 'disposed' })
    }
    for (const c of this.running) c.abort()
    this.running.clear()
  }

  private available(): boolean {
    if (this.injected) return true
    const now = Date.now()
    if (!this.avail || now - this.avail.at > AVAIL_TTL) this.avail = { at: now, ok: findClaude() != null }
    return this.avail.ok
  }

  private pump(): void {
    while (!this.disposed && this.running.size < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!
      void this.run(job)
    }
  }

  private async run(job: Job): Promise<void> {
    const { req } = job
    const ctrl = new AbortController()
    this.running.add(ctrl)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      ctrl.abort()
    }, this.timeoutMs)
    try {
      const stdout = await this.exec(buildSystemPrompt(req.lang, req.maxChars), buildUserPrompt(req.kind, req.text), ctrl.signal)
      const text = parseResult(stdout, req.maxChars)
      this.cache.set(job.cacheKey, text)
      while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string)
      this.fails = 0
      job.done({ key: req.key, text, error: null })
    } catch (e) {
      const msg = timedOut ? 'timeout' : ((e as Error)?.message ?? 'failed')
      if (!this.disposed) {
        this.fails++
        if (this.fails >= FAIL_LIMIT) this.disabledUntil = Date.now() + DISABLE_MS
      }
      job.done({ key: req.key, text: null, error: this.disposed ? 'disposed' : msg })
    } finally {
      clearTimeout(timer)
      this.running.delete(ctrl)
      this.pump()
    }
  }
}

function parseResult(stdout: string, maxChars: number): string {
  let j: unknown
  try {
    j = JSON.parse(stdout)
  } catch {
    throw new Error('bad-json')
  }
  const o = (j ?? {}) as { result?: unknown; is_error?: unknown }
  if (o.is_error === true) throw new Error(typeof o.result === 'string' ? o.result.slice(0, 200) : 'cli-error')
  if (typeof o.result !== 'string') throw new Error('bad-result')
  const text = cleanBubble(o.result, maxChars)
  if (!text) throw new Error('empty')
  return text
}
