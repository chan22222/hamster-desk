import { EventEmitter } from 'node:events'
import { promises as fsp, watch, type FSWatcher } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { DeskEvent } from '../../shared/events'
import { Tailer, scanLines } from './tail'
import { NOTICE, parseRecord, readRecord, recordTs, taskEnds } from './parse'
import { classifyRelPath } from './paths'

// Transcripts embed tool results (screenshots as base64 can be MBs), so the catch-up window is generous.
const MAIN_TAIL_BYTES = 8_000_000
const AGENT_TAIL_BYTES = 1_000_000
const DEBOUNCE_MS = 30
const POLL_MS = 1500
/** an unchanged model is still repeated after this many events (see ModelFilter) */
const MODEL_REPEAT_EVERY = 500
/** finished tasks remembered per session (background shells and workflow runs count too); the oldest go first */
const ENDED_MAX = 1000
/** how far before the catch-up scanOlder() looks for finished-agent notices */
const OLDER_MAX_BYTES = 256_000_000

/** events every ProjectWatcher has emitted: roughly where main's backlog ring (4000) has got to */
let emitted = 0

/**
 * Every assistant record carries its model, and Claude Code writes one record per content block, so
 * `model` was close to half of all events — the same value again and again, crowding the backlog ring
 * main keeps for a renderer that mounts late. Only what changes what the renderer shows goes through:
 * a new model, or a new effort (a record without one keeps the last, as the store does). The value is
 * repeated after MODEL_REPEAT_EVERY events regardless, so a ring that has dropped the first one still
 * holds one near the agent's latest work.
 */
export class ModelFilter {
  private last = new Map<string, { model: string; effort: string | null; at: number }>()

  constructor(private readonly repeatEvery = MODEL_REPEAT_EVERY) {}

  /** `at`: how many events have gone out so far */
  pass(e: { sessionId: string; agentId: string | null; model: string; effort: string | null }, at: number): boolean {
    const key = `${e.sessionId}:${e.agentId ?? ''}`
    const prev = this.last.get(key)
    const effort = e.effort ?? prev?.effort ?? null
    if (prev && prev.model === e.model && prev.effort === effort && at - prev.at < this.repeatEvery) return false
    this.last.set(key, { model: e.model, effort, at })
    return true
  }

  /**
   * Start over for one hamster (`agentId`, null = the main conversation) or, without it, for the
   * whole session. The renderer lets a finished agent go, and a resumed one comes back without a model.
   */
  forget(sessionId: string, agentId?: string | null): void {
    if (agentId !== undefined) {
      this.last.delete(`${sessionId}:${agentId ?? ''}`)
      return
    }
    for (const key of this.last.keys()) if (key.startsWith(`${sessionId}:`)) this.last.delete(key)
  }
}

interface AgentSlot {
  tailer: Tailer | null
  metaSeen: boolean
  started: boolean
  stopped: boolean
  agentType: string
  description: string
  toolUseId: string | null
  depth: number
  background: boolean
  pendingFirstPrompt: string | null
  /** its transcript has been read as far as it went when it was found: a finished-task notice can be judged */
  ready: boolean
  /** the newest timestamp in its own transcript */
  lastTs: number
  /** when a task notification let it go (null: it ended by itself, or is working) */
  endedBy: number | null
  /** StructuredOutput calls still waiting for their result */
  structured: Set<string>
}

/**
 * One recursive watcher per project folder (~/.claude/projects/<slug>). Routes change events to the
 * main transcript tailer of each tracked session and to the subagent tailers under <sessionId>/subagents/**.
 * A slow stat-poll backs up fs.watch, which can drop events on Windows under heavy writes.
 */
export class ProjectWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null
  private mains = new Map<string, Tailer>() // sessionId → tailer
  private agents = new Map<string, Map<string, AgentSlot>>() // sessionId → agentId → slot
  private ended = new Map<string, Map<string, number>>() // sessionId → task id → when a notification said it finished
  private older = new Map<string, Promise<void>>() // sessionId → its scanOlder() while it runs
  private debounce = new Map<string, NodeJS.Timeout>()
  private poll: NodeJS.Timeout | null = null
  private closed = false

  constructor(public readonly dir: string) {
    super()
  }

  start(): void {
    try {
      this.watcher = watch(this.dir, { recursive: true, persistent: false }, (_ev, filename) => {
        if (!filename) return
        this.onChange(String(filename))
      })
      this.watcher.on('error', () => {})
    } catch {
      /* polling only */
    }
    this.poll = setInterval(() => this.pollAll(), POLL_MS)
  }

  stop(): void {
    this.closed = true
    this.watcher?.close()
    if (this.poll) clearInterval(this.poll)
    for (const t of this.debounce.values()) clearTimeout(t)
    for (const t of this.mains.values()) t.close()
    for (const m of this.agents.values()) for (const s of m.values()) s.tailer?.close()
  }

  /** Begin tracking a session whose main transcript lives in this folder. */
  async track(sessionId: string, opts: { fromStart?: boolean } = {}): Promise<void> {
    if (this.closed || this.mains.has(sessionId)) return
    const path = join(this.dir, `${sessionId}.jsonl`)
    const ctx = { sessionId, agentId: null }
    const first = { ts: null as number | null } // the oldest time the catch-up saw
    const tailer = new Tailer(
      path,
      (line) => {
        const rec = readRecord(line)
        first.ts ??= recordTs(rec)
        this.emitAll(parseRecord(rec, ctx))
        for (const t of taskEnds(rec)) this.noteEnded(sessionId, t.taskId, t.ts)
      },
      { tailBytes: opts.fromStart ? undefined : MAIN_TAIL_BYTES },
    )
    this.mains.set(sessionId, tailer)
    if (!this.agents.has(sessionId)) this.agents.set(sessionId, new Map())
    await tailer.open()
    // untracked (the session ended) or stopped while the catch-up was read
    if (this.closed || this.mains.get(sessionId) !== tailer) return
    await this.discoverAgents(sessionId, opts.fromStart === true)
    if (this.closed || this.mains.get(sessionId) !== tailer || tailer.windowStart === 0) return
    const scan = this.scanOlder(sessionId, tailer, first.ts).finally(() => {
      if (this.older.get(sessionId) === scan) this.older.delete(sessionId)
    })
    this.older.set(sessionId, scan)
  }

  /**
   * The catch-up reads a main transcript's last 8 MB; a long session's notices about agents that had
   * finished before that lie further back, and those agents stayed at the desk until the session
   * ended. Look for the notices there — in the background, not holding up the attach, and only while
   * an agent that fell quiet before the catch-up began is still at the desk (one busy since then has
   * its notice in the catch-up, if it has one). Cancelled by untrack() and stop().
   */
  private async scanOlder(sessionId: string, tailer: Tailer, since: number | null): Promise<void> {
    const slots = this.agents.get(sessionId)
    if (!slots) return
    const waiting = (): boolean => {
      for (const s of slots.values()) if (s.started && !s.stopped && (since === null || s.lastTs < since)) return true
      return false
    }
    if (!waiting()) return
    const to = tailer.windowStart
    await scanLines(tailer.path, {
      from: Math.max(0, to - OLDER_MAX_BYTES),
      to,
      marker: NOTICE,
      // only agents of this session: a background shell's notice has nobody to let go
      onLine: (line) => {
        for (const t of taskEnds(readRecord(line))) if (slots.has(t.taskId)) this.noteEnded(sessionId, t.taskId, t.ts)
      },
      go: () => !this.closed && this.mains.get(sessionId) === tailer && waiting(),
    })
  }

  untrack(sessionId: string): void {
    this.mains.get(sessionId)?.close()
    this.mains.delete(sessionId)
    const slots = this.agents.get(sessionId)
    if (slots) for (const s of slots.values()) s.tailer?.close()
    this.agents.delete(sessionId)
    this.ended.delete(sessionId)
    // the same id can come back (claude --resume) and must be told its title and model again
    this.lastTitle.delete(sessionId)
    this.models.forget(sessionId)
  }

  get trackedCount(): number {
    return this.mains.size
  }

  private lastTitle = new Map<string, string>()
  private models = new ModelFilter()

  private emitAll(evs: DeskEvent[]): void {
    for (const e of evs) this.out(e)
  }

  /** Every event leaves through here: the unchanged title and model are dropped on the way. */
  private out(e: DeskEvent): void {
    if (e.kind === 'title') {
      if (this.lastTitle.get(e.sessionId) === e.title) return
      this.lastTitle.set(e.sessionId, e.title)
    } else if (e.kind === 'model') {
      if (!this.models.pass(e, emitted)) return
    } else if (e.kind === 'agent_stop') {
      this.models.forget(e.sessionId, e.agentId)
    }
    emitted++
    this.emit('event', e)
  }

  private onChange(rel: string): void {
    const key = rel.split(sep).join('/')
    const prev = this.debounce.get(key)
    if (prev) clearTimeout(prev)
    this.debounce.set(
      key,
      setTimeout(() => {
        this.debounce.delete(key)
        void this.handle(rel)
      }, DEBOUNCE_MS),
    )
  }

  private async handle(rel: string): Promise<void> {
    if (this.closed) return
    const c = classifyRelPath(rel)
    if (!c) return
    if (c.type === 'main') {
      await this.mains.get(c.sessionId)?.poll()
      return
    }
    if (!this.mains.has(c.sessionId)) return
    await this.touchAgent(c.sessionId, c.agentId, join(this.dir, rel), c.part, false)
  }

  private async pollAll(): Promise<void> {
    for (const t of this.mains.values()) await t.poll()
    for (const m of this.agents.values()) for (const s of m.values()) await s.tailer?.poll()
  }

  /** Scan <session>/subagents/** once so agents that appeared before we started are known. */
  private async discoverAgents(sessionId: string, fromStart: boolean): Promise<void> {
    const root = join(this.dir, sessionId, 'subagents')
    const files: string[] = []
    const walk = async (d: string): Promise<void> => {
      let ents
      try {
        ents = await fsp.readdir(d, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of ents) {
        const p = join(d, e.name)
        if (e.isDirectory()) await walk(p)
        else files.push(p)
      }
    }
    await walk(root)
    // meta first so names are right when the transcript starts streaming
    files.sort((a, b) => Number(b.endsWith('.meta.json')) - Number(a.endsWith('.meta.json')))
    for (const p of files) {
      const c = classifyRelPath(relative(this.dir, p))
      if (c?.type === 'agent') await this.touchAgent(sessionId, c.agentId, p, c.part, !fromStart)
    }
  }

  private slot(sessionId: string, agentId: string): AgentSlot {
    let slots = this.agents.get(sessionId)
    if (!slots) {
      slots = new Map()
      this.agents.set(sessionId, slots)
    }
    let s = slots.get(agentId)
    if (!s) {
      s = {
        tailer: null,
        metaSeen: false,
        started: false,
        stopped: false,
        agentType: 'agent',
        description: '',
        toolUseId: null,
        depth: 1,
        background: false,
        pendingFirstPrompt: null,
        ready: false,
        lastTs: 0,
        endedBy: null,
        structured: new Set(),
      }
      slots.set(agentId, s)
    }
    return s
  }

  private async touchAgent(sessionId: string, agentId: string, path: string, part: 'jsonl' | 'meta', catchUp: boolean): Promise<void> {
    // a session that ended while its agents were being found gets no new tailers
    if (this.closed || !this.mains.has(sessionId)) return
    const s = this.slot(sessionId, agentId)
    if (part === 'meta') {
      if (s.metaSeen) return
      let j: Record<string, unknown>
      try {
        j = JSON.parse(await fsp.readFile(path, 'utf8'))
      } catch {
        return // half-written; retried on the next change event
      }
      if (this.closed || this.agents.get(sessionId)?.get(agentId) !== s) return
      s.metaSeen = true
      s.agentType = String(j.agentType ?? s.agentType)
      s.description = String(j.description ?? s.description)
      s.toolUseId = typeof j.toolUseId === 'string' ? j.toolUseId : s.toolUseId
      s.depth = Number(j.spawnDepth ?? s.depth)
      s.background = j.requestShape === 'background'
      this.emitStart(sessionId, agentId, s)
      return
    }
    if (!s.tailer) {
      const ctx = { sessionId, agentId }
      s.tailer = new Tailer(
        path,
        (line) => {
          const rec = readRecord(line)
          const at = recordTs(rec)
          // written before the notification that let this agent go, but read after it (two files, two
          // writes): it is done, not resumed — and an event for a hamster already walking out would
          // put it back on the desk for good
          if (s.stopped && s.endedBy !== null && at !== null && at <= s.endedBy) return
          if (at !== null && at > s.lastTs) s.lastTs = at
          for (const e of parseRecord(rec, ctx)) {
            if (e.kind === 'prompt' && !s.description && !s.pendingFirstPrompt) {
              s.pendingFirstPrompt = e.text
            }
            if (e.kind === 'agent_stop') {
              s.stopped = true
              s.endedBy = null
            } else if (s.stopped && e.kind !== 'tool_done') {
              // the agent was resumed (SendMessage) → back to the desk
              s.stopped = false
              s.started = false
              s.endedBy = null
            }
            if (!s.started) this.emitStart(sessionId, agentId, s)
            if (e.kind === 'tool' && e.name === 'StructuredOutput') s.structured.add(e.toolUseId)
            this.out(e)
            // A workflow agent hands in its result with StructuredOutput and is finished there: no
            // end_turn follows. A call that failed validation is retried, so only one that went through.
            if (e.kind === 'tool_done' && s.structured.delete(e.toolUseId) && e.ok && !s.stopped) {
              s.stopped = true
              this.out({ kind: 'agent_stop', sessionId, agentId, ts: e.ts })
            }
          }
        },
        { tailBytes: catchUp ? AGENT_TAIL_BYTES : undefined },
      )
      await s.tailer.open()
      s.ready = true
      // a notification read with the main transcript's catch-up, before this slot existed
      await this.settle(sessionId, agentId, s, false)
    } else {
      await s.tailer.poll()
    }
  }

  /**
   * A notification said task `taskId` has finished. Most ids are not an agent of ours (a background
   * shell, a workflow run), and an agent's slot may not exist yet: on attach the main transcript is read
   * before any agent file. So every one is kept, and settle() judges the agent when its own transcript
   * has been read. The same notice comes two to four times; the latest one counts, because an agent
   * resumed after one notice ends with another.
   */
  private noteEnded(sessionId: string, taskId: string, ts: number): void {
    if (this.closed || !this.mains.has(sessionId)) return
    let m = this.ended.get(sessionId)
    if (!m) {
      m = new Map()
      this.ended.set(sessionId, m)
    }
    const prev = m.get(taskId)
    if (prev !== undefined && prev >= ts) return
    m.delete(taskId) // to the back of the line
    m.set(taskId, ts)
    if (m.size > ENDED_MAX) m.delete(m.keys().next().value!)
    const s = this.agents.get(sessionId)?.get(taskId)
    if (s?.ready) void this.settle(sessionId, taskId, s, true)
  }

  /**
   * Let an agent go that a notification said had finished — unless it has written anything since,
   * which means it was resumed (SendMessage) and is working again. `drain`: read what the agent wrote
   * before the notice first, so that goes out ahead of the stop, as it does before an end_turn.
   */
  private async settle(sessionId: string, agentId: string, s: AgentSlot, drain: boolean): Promise<void> {
    if (drain) await s.tailer?.poll()
    if (this.closed || this.agents.get(sessionId)?.get(agentId) !== s) return
    const at = this.ended.get(sessionId)?.get(agentId)
    if (at === undefined || !s.started || s.stopped || s.lastTs > at) return
    s.stopped = true
    s.endedBy = at
    this.out({ kind: 'agent_stop', sessionId, agentId, ts: at })
  }

  private emitStart(sessionId: string, agentId: string, s: AgentSlot): void {
    s.started = true
    const ev: DeskEvent = {
      kind: 'agent_start',
      sessionId,
      agentId,
      agentType: s.agentType,
      description: s.description || s.pendingFirstPrompt || agentId,
      toolUseId: s.toolUseId,
      depth: s.depth,
      background: s.background,
      ts: Date.now(),
    }
    this.out(ev)
  }
}
