import { EventEmitter } from 'node:events'
import { dirname } from 'node:path'
import type { DeskEvent, SessionInfo } from '../../shared/events'
import { SessionWatcher } from './sessions'
import { ProjectWatcher } from './project'
import { findTranscript } from './paths'

export type { DeskEvent, SessionInfo }

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
  private pendingTranscript = new Map<string, SessionInfo>()

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
    // a fresh session has no transcript until the first message; keep looking
    this.locate = setInterval(() => void this.retryPending(), 1000)
  }

  /** Re-scan now (e.g. right after a new shell was spawned, so ownership is attributed quickly). */
  rescan(): Promise<void> {
    return this.sessions.scan()
  }

  stop(): void {
    this.sessions.stop()
    if (this.locate) clearInterval(this.locate)
    for (const p of this.projects.values()) p.stop()
    this.projects.clear()
  }

  get liveSessions(): SessionInfo[] {
    return [...this.sessions.sessions.values()]
  }

  private async onSession(s: SessionInfo): Promise<void> {
    this.emit('event', { kind: 'session', ...s } satisfies DeskEvent)
    if (!s.transcriptPath) {
      this.pendingTranscript.set(s.sessionId, s)
      return
    }
    this.pendingTranscript.delete(s.sessionId)
    await this.attach(s.sessionId, s.transcriptPath)
  }

  private async attach(sessionId: string, transcriptPath: string): Promise<void> {
    if (this.sessionDir.has(sessionId)) return
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

  private async retryPending(): Promise<void> {
    for (const [id, s] of this.pendingTranscript) {
      const p = findTranscript(id, s.cwd, this.baseDir)
      if (!p) continue
      this.pendingTranscript.delete(id)
      const live = this.sessions.sessions.get(id)
      if (live) {
        live.transcriptPath = p
        this.emit('event', { kind: 'session', ...live } satisfies DeskEvent)
      }
      await this.attach(id, p)
    }
  }

  private onGone(sessionId: string): void {
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
