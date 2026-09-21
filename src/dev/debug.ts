// Debug/e2e hooks the renderer installs at boot. None of this is reachable in a packaged build:
// `electron/main.ts` only fills `debugEvents` / `debugClicks` when `app.isPackaged` is false.
//
// What they are for: a capture run has nobody looking at the screen and no claude session, so a
// claim like "this button opens that panel" or "a 92% context turns the tab red" can only be
// proven by driving the real UI and photographing the result. `HAMSTER_EVENTS` replays desk
// events into the store (no tokens, no CLI), `HAMSTER_CLICK` presses buttons by name.

import type { DeskBridge } from '../../electron/preload'
import type { DeskEvent } from '@shared/events'
import { useDesk } from '../store'

export type AppInfo = Awaited<ReturnType<DeskBridge['info']>>

/** the session id `"$sid"` stands for; every replayed event belongs to this one fake session */
export const DEBUG_SESSION = 'debug-session'

/** how long a click waits for its button to turn up before giving up */
const CLICK_TRIES = 12
const POLL_MS = 500

export function installDebugHooks(info: AppInfo): void {
  installClicks(info.debugClicks)
  installEvents(info.debugEvents)
}

// ---- HAMSTER_CLICK ------------------------------------------------------------------------

/**
 * Press `[data-debug-click="<name>"]` at `at` ms. The button often does not exist yet (a popover
 * has to be open first, a pty has to be bound), so each one polls for a few seconds and says on
 * stdout whether it found it — a capture that shows nothing then still tells you why.
 */
function installClicks(clicks: { name: string; at: number }[]): void {
  for (const c of clicks) {
    setTimeout(() => {
      let tries = 0
      const tick = (): void => {
        const el = document.querySelector<HTMLElement>(`[data-debug-click="${c.name}"]`)
        if (el) {
          el.click()
          console.log(`[debug] click ${c.name} ok`)
          return
        }
        if (++tries >= CLICK_TRIES) {
          console.log(`[debug] click ${c.name} missing`)
          return
        }
        setTimeout(tick, POLL_MS)
      }
      tick()
    }, Math.max(0, c.at))
  }
}

// ---- HAMSTER_EVENTS -----------------------------------------------------------------------

/** `{"kind":"debug:search","q":"needle"}` — not a desk event; it opens the terminal search box. */
interface DebugSearch {
  kind: 'debug:search'
  q?: string
}

function isDebugSearch(e: unknown): e is DebugSearch {
  return !!e && typeof e === 'object' && (e as { kind?: unknown }).kind === 'debug:search'
}

/**
 * Replace the three placeholders anywhere in the payload. They exist because the values are only
 * known once the app is up: the pty id is assigned at runtime, and a timestamp written into the
 * env var would already be stale by the time the window paints (every consumer has a 30 s age
 * gate, so a fixed `ts` would be ignored).
 */
function substitute(v: unknown, ptyId: number | null): unknown {
  if (typeof v === 'string') {
    if (v === '$sid') return DEBUG_SESSION
    if (v === '$pty') return ptyId
    if (v === '$now') return Date.now()
    return v
  }
  if (Array.isArray(v)) return v.map((x) => substitute(x, ptyId))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = substitute(val, ptyId)
    return out
  }
  return v
}

/** The first terminal's pty id, once the shell has actually been spawned (null if it never is). */
function waitForPty(): Promise<number | null> {
  return new Promise((resolve) => {
    let tries = 0
    const tick = (): void => {
      const id = useDesk.getState().workspaces[0]?.ptyId
      if (typeof id === 'number') return resolve(id)
      if (++tries >= CLICK_TRIES * 2) return resolve(null)
      setTimeout(tick, POLL_MS)
    }
    tick()
  })
}

/** the workspace a search request belongs to: the active tab, or the only one there is */
function activeWsId(): number | null {
  const st = useDesk.getState()
  const active = st.workspaces.find((w) => `ws:${w.id}` === st.activeTab)
  return active?.id ?? st.workspaces[0]?.id ?? null
}

/**
 * Announce the fake session the replayed events belong to. No watcher will ever report it, and
 * `apply` drops events for a session it has not seen, so this has to come first.
 */
function announceSession(ptyId: number | null): void {
  const st = useDesk.getState()
  const now = Date.now()
  st.apply({
    kind: 'session',
    sessionId: DEBUG_SESSION,
    pid: 0,
    cwd: st.workspaces[0]?.cwd ?? '',
    name: DEBUG_SESSION,
    status: 'busy',
    startedAt: now,
    updatedAt: now,
    version: '',
    sessionKind: 'debug',
    mine: true,
    ptyId,
    transcriptPath: null,
  })
}

function installEvents(events: DeskEvent[] | null): void {
  if (!events || events.length === 0) return
  void waitForPty().then((ptyId) => {
    announceSession(ptyId)
    // A pane that is unmounted and rebuilt mid-run (mini mode replaces the whole app) kills its
    // shell and spawns a new one with a new id. The fake session would then point at a terminal
    // that is gone and the tab would quietly lose it, so follow the first terminal instead.
    let bound = ptyId
    useDesk.subscribe((s) => {
      const id = s.workspaces[0]?.ptyId ?? null
      if (id === null || id === bound) return
      console.log(`[debug] pty rebind ${bound} -> ${id}`)
      bound = id
      announceSession(id)
    })
    for (const raw of events) {
      const e = substitute(raw, ptyId)
      if (isDebugSearch(e)) {
        const wsId = activeWsId()
        if (wsId !== null) useDesk.getState().requestTermSearch(wsId, e.q)
        continue
      }
      useDesk.getState().apply(e as DeskEvent)
    }
    console.log(`[debug] events ${events.length} pty=${ptyId}`)
  })
}
