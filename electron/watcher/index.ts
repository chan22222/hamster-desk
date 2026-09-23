import { EventEmitter } from 'node:events'
import { dirname } from 'node:path'
import type { DeskEvent, SessionInfo } from '../../shared/events'
import { SessionWatcher } from './sessions'
import { ProjectWatcher } from './project'
import { findTranscript, transcriptAt } from './paths'

export type { DeskEvent, SessionInfo }

/** the slug-named folder is looked at every tick; every folder only this often, doubling up to the cap */
const SCAN_FIRST_MS = 1000
const SCAN_MAX_MS = 30_000

interface Pending {
  info: SessionInfo
  /** when the look through every project folder is due again */
  scanAt: number
  misses: number
}

export interface DeskWatcherOptions {
  /** shells this window spawned (empty → nothing is "mine", everything is shown) */
  ownedShells?: () => { ptyId: number; pid: number }[]
  /** watch another account's config folder instead of the CLI's own (electron/profiles.ts) */
  baseDir?: string
  profileId?: string
}

/**
 * Orchestrates: live sessions (from ~/.claude/sessions) → per-project transcript watchers.
 * Emits 'event' with a DeskEvent. Zero impact on the CLI: we only read files it already writes.
 */
export class DeskWatcher extends EventEmitter {
  private sessions: SessionWatcher
  private projects = new Map<string, ProjectWatcher>() // dir → watcher
  private sessionDir = new Map<string, string>() // sessionId → project dir
  private locate: NodeJS.Timeout | null = null
  private locating = false
  private pendingTranscript = new Map<string, Pending>()
  /** stop() can come while start() or an attach is still awaiting; nothing may be set up after it */
  private stopped = false

  private readonly baseDir: string | undefined

  constructor(opts: DeskWatcherOptions = {}) {
    super()
    this.baseDir = opts.baseDir
    this.sessions = new SessionWatcher({ ownedShells: opts.ownedShells ?? (() => []), baseDir: opts.baseDir, profileId: opts.profileId })
    this.sessions.on('session', (s: SessionInfo) => void this.onSession(s))
    this.sessions.on('session_gone', (id: string) => this.onGone(id))
  }

  async start(): Promise<void> {
    await this.sessions.start()
    if (this.stopped) return
    // a fresh session has no transcript until the first message; keep looking
    this.locate = setInterval(() => void this.retryPending(), SCAN_FIRST_MS)
  }

  /** Re-scan now (e.g. right after a new shell was spawned, so ownership is attributed quickly). */
  rescan(): Promise<void> {
    return this.sessions.scan()
  }

  stop(): void {
    this.stopped = true
    this.sessions.stop()
    if (this.locate) clearInterval(this.locate)
    this.locate = null
    for (const p of this.projects.values()) p.stop()
    this.projects.clear()
    this.sessionDir.clear()
    this.pendingTranscript.clear()
  }

  get liveSessions(): SessionInfo[] {
    return [...this.sessions.sessions.values()]
  }

  private async onSession(s: SessionInfo): Promise<void> {
    if (this.stopped) return
    this.emit('event', { kind: 'session', ...s } satisfies DeskEvent)
    if (!s.transcriptPath) {
      const had = this.pendingTranscript.get(s.sessionId)
      if (!had) {
        this.pendingTranscript.set(s.sessionId, { info: s, scanAt: 0, misses: 0 })
        return
      }
      // A status change is the moment a transcript gets written (the first message), so it brings
      // the look through every folder forward; otherwise the backoff it is on carries over.
      if (had.info.status !== s.status) had.scanAt = 0
      had.info = s
      return
    }
    this.pendingTranscript.delete(s.sessionId)
    await this.attach(s.sessionId, s.transcriptPath)
  }

  private async attach(sessionId: string, transcriptPath: string): Promise<void> {
    if (this.stopped || this.sessionDir.has(sessionId)) return
    const dir = dirname(transcriptPath)
    let pw = this.projects.get(dir)
    if (!pw) {
      pw = new ProjectWatcher(dir)
      pw.on('event', (e: DeskEvent) => this.emit('event', e))
      pw.start()
      this.projects.set(dir, pw)
    }
    this.sessionDir.set(sessionId, dir)
    await pw.track(sessionId)
  }

  /**
   * Sessions without a transcript yet. The folder named by the cwd's slug is one stat and is looked
   * at every tick; looking in every project folder (a cwd the slug rule does not name) used to run
   * synchronously every second for as long as a claude sat unused, and now backs off to 30 s.
   */
  private async retryPending(): Promise<void> {
    if (this.locating || this.stopped) return
    this.locating = true
    try {
      for (const [id, pending] of [...this.pendingTranscript]) {
        const due = pending.scanAt
        const scan = Date.now() >= due
        const cwd = pending.info.cwd
        const p = scan ? await findTranscript(id, cwd, this.baseDir) : await transcriptAt(id, cwd, this.baseDir)
        // stopped, gone, or answered by the session watcher while this looked
        if (this.stopped || this.pendingTranscript.get(id) !== pending) continue
        if (!p) {
          // (a status change while this looked has already asked for the next look to come sooner)
          if (scan && pending.scanAt === due) {
            pending.misses++
            pending.scanAt = Date.now() + Math.min(SCAN_FIRST_MS * 2 ** pending.misses, SCAN_MAX_MS)
          }
          continue
        }
        this.pendingTranscript.delete(id)
        const live = this.sessions.sessions.get(id)
        if (live) {
          live.transcriptPath = p
          this.emit('event', { kind: 'session', ...live } satisfies DeskEvent)
        }
        await this.attach(id, p)
      }
    } finally {
      this.locating = false
    }
  }

  private onGone(sessionId: string): void {
    if (this.stopped) return
    this.pendingTranscript.delete(sessionId)
    const dir = this.sessionDir.get(sessionId)
    if (dir) {
      const pw = this.projects.get(dir)
      pw?.untrack(sessionId)
      if (pw && pw.trackedCount === 0) {
        pw.stop()
        this.projects.delete(dir)
      }
      this.sessionDir.delete(sessionId)
    }
    this.emit('event', { kind: 'session_gone', sessionId } satisfies DeskEvent)
  }
}

/**
 * Offline: read a whole transcript (plus its subagents) and return every event in time order.
 * Used by `npm run replay` to drive the renderer without a live session.
 */
export async function collectEvents(transcriptPath: string): Promise<DeskEvent[]> {
  const { promises: fsp } = await import('node:fs')
  const { join, basename } = await import('node:path')
  const { parseLine } = await import('./parse')
  const sessionId = basename(transcriptPath, '.jsonl')
  const out: DeskEvent[] = []
  const readAll = async (p: string, agentId: string | null): Promise<void> => {
    let text: string
    try {
      text = await fsp.readFile(p, 'utf8')
    } catch {
      return
    }
    let last = 0
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      for (const e of parseLine(line, { sessionId, agentId })) {
        if ('ts' in e && typeof e.ts === 'number') last = e.ts
        else (e as { ts?: number }).ts = last
        out.push(e)
      }
    }
  }
  await readAll(transcriptPath, null)
  const root = join(dirname(transcriptPath), sessionId, 'subagents')
  const walk = async (d: string): Promise<void> => {
    let ents
    try {
      ents = await fsp.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        await walk(p)
        continue
      }
      const m = e.name.match(/^agent-([A-Za-z0-9_-]+)\.jsonl$/)
      if (!m) continue
      const agentId = m[1]
      let meta: Record<string, unknown> = {}
      try {
        meta = JSON.parse(await fsp.readFile(join(d, `agent-${agentId}.meta.json`), 'utf8'))
      } catch {
        /* no meta */
      }
      const before = out.length
      await readAll(p, agentId)
      const firstTs = (out[before] as { ts?: number } | undefined)?.ts
      out.push({
        kind: 'agent_start',
        sessionId,
        agentId,
        agentType: String(meta.agentType ?? 'agent'),
        description: String(meta.description ?? ''),
        toolUseId: typeof meta.toolUseId === 'string' ? meta.toolUseId : null,
        depth: Number(meta.spawnDepth ?? 1),
        background: meta.requestShape === 'background',
        ts: typeof firstTs === 'number' ? firstTs - 1 : 0,
      })
    }
  }
  await walk(root)
  const tsOf = (e: DeskEvent): number => ('ts' in e && typeof e.ts === 'number' ? e.ts : 0)
  // stable sort: keeps record order for events sharing a timestamp (e.g. cost/title without ts)
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => tsOf(a.e) - tsOf(b.e) || a.i - b.i)
    .map((x) => x.e)
}
