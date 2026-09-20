import { EventEmitter } from 'node:events'
import { promises as fsp, watch, type FSWatcher } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { DeskEvent } from '../../shared/events'
import { Tailer } from './tail'
import { parseLine } from './parse'
import { classifyRelPath } from './paths'

// Transcripts embed tool results (screenshots as base64 can be MBs), so the catch-up window is generous.
const MAIN_TAIL_BYTES = 8_000_000
const AGENT_TAIL_BYTES = 1_000_000
const DEBOUNCE_MS = 30
const POLL_MS = 1500

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
    if (this.mains.has(sessionId)) return
    const path = join(this.dir, `${sessionId}.jsonl`)
    const tailer = new Tailer(path, (line) => this.emitAll(parseLine(line, { sessionId, agentId: null })), {
      tailBytes: opts.fromStart ? undefined : MAIN_TAIL_BYTES,
    })
    this.mains.set(sessionId, tailer)
    if (!this.agents.has(sessionId)) this.agents.set(sessionId, new Map())
    await tailer.open()
    await this.discoverAgents(sessionId, opts.fromStart === true)
  }

  untrack(sessionId: string): void {
    this.mains.get(sessionId)?.close()
    this.mains.delete(sessionId)
    const slots = this.agents.get(sessionId)
    if (slots) for (const s of slots.values()) s.tailer?.close()
    this.agents.delete(sessionId)
  }

  get trackedCount(): number {
    return this.mains.size
  }

  private lastTitle = new Map<string, string>()

  private emitAll(evs: DeskEvent[]): void {
    for (const e of evs) {
      if (e.kind === 'title') {
        if (this.lastTitle.get(e.sessionId) === e.title) continue
        this.lastTitle.set(e.sessionId, e.title)
      }
      this.emit('event', e)
    }
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
      }
      slots.set(agentId, s)
    }
    return s
  }

  private async touchAgent(sessionId: string, agentId: string, path: string, part: 'jsonl' | 'meta', catchUp: boolean): Promise<void> {
    const s = this.slot(sessionId, agentId)
    if (part === 'meta') {
      if (s.metaSeen) return
      let j: Record<string, unknown>
      try {
        j = JSON.parse(await fsp.readFile(path, 'utf8'))
      } catch {
        return // half-written; retried on the next change event
      }
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
          const evs = parseLine(line, ctx)
          for (const e of evs) {
            if (e.kind === 'prompt' && !s.description && !s.pendingFirstPrompt) {
              s.pendingFirstPrompt = e.text
            }
            if (e.kind === 'agent_stop') {
              s.stopped = true
            } else if (s.stopped && e.kind !== 'tool_done') {
              // the agent was resumed (SendMessage) → back to the desk
              s.stopped = false
              s.started = false
            }
            if (!s.started) this.emitStart(sessionId, agentId, s)
            this.emit('event', e)
          }
        },
        { tailBytes: catchUp ? AGENT_TAIL_BYTES : undefined },
      )
      await s.tailer.open()
    } else {
      await s.tailer.poll()
    }
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
    this.emit('event', ev)
  }
}
