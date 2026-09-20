// Browser-only dev mode (no Electron bridge): plays back src/dev/replay.json produced by `npm run replay`.
import type { DeskEvent } from '@shared/events'

export function startReplay(apply: (e: DeskEvent) => void): () => void {
  // Deterministic browser preview for art/layout review, without shells or live sessions.
  const demo = new URLSearchParams(window.location.search).get('studio-demo')
  if (demo !== null) {
    let cancelled = false
    void import('./demo').then(m => { if (!cancelled) m.seedStudioDemo(apply, Math.max(1, Math.min(48, Number(demo) || 8))) })
    return () => { cancelled = true }
  }
  let stopped = false
  const timers: number[] = []
  void fetch('/dev/replay.json')
    .then((r) => (r.ok ? (r.json() as Promise<DeskEvent[]>) : Promise.reject(new Error(String(r.status)))))
    .then((events) => {
      if (stopped || !events.length) return
      const sessionId = (events.find((e) => 'sessionId' in e) as { sessionId?: string } | undefined)?.sessionId ?? 'replay'
      apply({
        kind: 'session',
        sessionId,
        pid: 0,
        cwd: 'C:\\replay',
        name: 'replay',
        status: 'busy',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        version: 'replay',
        sessionKind: 'replay',
        mine: false,
        ptyId: null,
        transcriptPath: null,
      })
      // compress real time ×40, but never faster than 150 ms per event
      let clock = 0
      let prevTs: number | null = null
      for (const e of events) {
        const ts: number = 'ts' in e && typeof e.ts === 'number' ? e.ts : (prevTs ?? 0)
        const gap = prevTs === null ? 0 : Math.max(150, Math.min(4000, (ts - prevTs) / 40))
        prevTs = ts
        clock += gap
        timers.push(window.setTimeout(() => apply(e), clock))
      }
    })
    .catch((err) => console.warn('replay unavailable:', err))
  return () => {
    stopped = true
    timers.forEach((t) => clearTimeout(t))
  }
}
