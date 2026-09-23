import type { DeskEvent } from '../shared/events'

/**
 * The desk events main has sent, numbered, so a renderer that mounts (or reloads) after the watcher
 * already streamed the catch-up can replay them and skip what it has (src/App.tsx `take`).
 *
 * A ring of the last `max` events — plus what the ring must not forget. A catch-up of a few long
 * sessions (up to 8 MB of transcript each) is more than 4000 events, and the oldest to go were the
 * ones everything else hangs on: a session's own `session` event — the store drops whatever arrives
 * for a session it has not seen, so the session never showed up at all — its title and model, the
 * status line, the versions. The latest of each is pinned, and whatever of that the ring has already
 * dropped goes in front of a replay, in the order it happened. A session's *first* `session` event
 * is pinned next to its latest: while the latest is still in the ring, the first is what makes the
 * session exist before the ring's events for it arrive.
 *
 * Pure (no electron), so scripts/unit can drive it.
 */

export interface SeqEvent {
  seq: number
  ev: DeskEvent
}

export class EventBacklog {
  private seq = 0
  private readonly ring: SeqEvent[] = []
  /** per session: its first and latest `session`, title, cost, status line, each hamster's model, the sub-agents still at work */
  private readonly bySession = new Map<string, Map<string, SeqEvent>>()
  /** app-wide: the newest status line with rate limits per account, the usage windows per account, the versions */
  private readonly global = new Map<string, SeqEvent>()

  /**
   * `sessionsMax`: status-line files of sessions long gone (outside the app too) would otherwise pile
   * up in the pins; one that was never live goes first.
   */
  constructor(
    private readonly max = 4000,
    private readonly sessionsMax = 500,
  ) {}

  /** Number the event, keep it, and hand back what to send. */
  push(ev: DeskEvent): SeqEvent {
    const item = { seq: ++this.seq, ev }
    this.ring.push(item)
    if (this.ring.length > this.max) this.ring.splice(0, this.ring.length - this.max)
    this.pin(item)
    return item
  }

  /** Everything after `after`: what the ring has dropped of the pinned events first, then the ring. */
  replay(after: number): SeqEvent[] {
    const ringStart = this.ring[0]?.seq ?? this.seq + 1
    const early = new Map<number, SeqEvent>()
    const take = (item: SeqEvent): void => {
      if (item.seq < ringStart && item.seq > after) early.set(item.seq, item)
    }
    for (const m of this.bySession.values()) {
      const latest = m.get('session')
      for (const [key, item] of m) if (key !== 'first' || !latest || latest.seq >= ringStart) take(item)
    }
    for (const item of this.global.values()) take(item)
    const front = [...early.values()].sort((a, b) => a.seq - b.seq)
    return [...front, ...this.ring.filter((b) => b.seq > after)]
  }

  private of(sessionId: string): Map<string, SeqEvent> {
    let m = this.bySession.get(sessionId)
    if (m) return m
    m = new Map()
    this.bySession.set(sessionId, m)
    if (this.bySession.size > this.sessionsMax) {
      let drop: string | undefined
      for (const [id, x] of this.bySession) {
        if (!x.has('session')) {
          drop = id
          break
        }
      }
      this.bySession.delete(drop ?? (this.bySession.keys().next().value as string))
    }
    return m
  }

  private pin(item: SeqEvent): void {
    const e = item.ev
    switch (e.kind) {
      case 'session': {
        const m = this.of(e.sessionId)
        if (!m.has('first')) m.set('first', item)
        m.set('session', item)
        return
      }
      case 'session_gone':
        this.bySession.delete(e.sessionId)
        return
      case 'title':
      case 'cost':
        this.of(e.sessionId).set(e.kind, item)
        return
      case 'model':
        this.of(e.sessionId).set(`model:${e.agentId ?? ''}`, item)
        return
      // a sub-agent while it works; its model goes with it, or a replay would bring a finished one back
      case 'agent_start':
        this.of(e.sessionId).set(`agent:${e.agentId}`, item)
        return
      case 'agent_stop': {
        const m = this.bySession.get(e.sessionId)
        m?.delete(`agent:${e.agentId}`)
        m?.delete(`model:${e.agentId}`)
        return
      }
      case 'status': {
        this.of(e.sessionId).set('status', item)
        // the gauges show the newest snapshot with rate limits per account (src/store.ts 'status')
        if (e.fiveHour || e.sevenDay) {
          const key = `usage:${e.profileId ?? ''}`
          const had = this.global.get(key)?.ev
          if (!had || had.kind !== 'status' || had.ts <= e.ts) this.global.set(key, item)
        }
        return
      }
      case 'usage_windows':
        this.global.set(`usage_windows:${e.profileId}`, item)
        return
      case 'version':
      case 'app_update':
        this.global.set(e.kind, item)
        return
    }
  }
}
