// Raise a notification — the app's own popup window, electron/toast-window.ts — when something in
// the store starts waiting for the user and the window is not the one they are looking at.
// Plan §3.1.
//
// Why a store subscription and not an event handler: `turn_end` is written by the store owner (C)
// and `ptyWaiting` by the same reducer, so watching the *result* keeps this file out of store.ts
// entirely — A never edits it. `Banner.tsx` imports this module, and App.tsx already renders a
// `<Banner/>`, so mounting the banner is what installs the watcher.
//
// Everything here is gated four ways, because a notification the user did not want is worse than
// no notification at all: the preference, the window not having focus, the age of the event (a
// renderer reload replays the whole backlog, R7) and a 5 s de-duplication per tag+terminal.

import soundUrl from '../assets/notify.wav?url'
import { formatDuration, t } from '../i18n'
import { shortName, useDesk, type SessionState } from '../store'
import type { NotifyRequest, NotifyResult } from '@shared/events'

/** ignore anything that happened longer ago than this — backlog replay, mostly */
const AGE_MS = 30_000
/** the same tag for the same terminal does not notify twice inside this window */
const DEDUP_MS = 5_000
/**
 * Turn notifications stay quiet for this long after boot. `waiting` carries its own timestamp and
 * is age-gated properly; a finished turn only has `lastTurn.at`, which the store fills in from the
 * event — and a `turn_end` replayed out of the backlog before the summary lands has neither. This
 * is the one gap, and it is exactly one renderer-startup wide.
 */
const ARM_MS = 1500
/** how long the in-app banner stays up when the popup window could not be made */
const BANNER_MS = 8_000

export interface BannerItem {
  id: number
  title: string
  body: string
  /** the tab to open when the banner is clicked */
  tab: string
  ptyId: number | null
  /** why the banner is here rather than the popup */
  reason: NotifyResult
}

// ---- the banner, as a tiny external store -------------------------------------------------
// The store belongs to C from Phase 1 on, so the one piece of state this feature needs lives here
// and `Banner.tsx` reads it with `useSyncExternalStore`.

let banner: BannerItem | null = null
let bannerSeq = 0
let bannerTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function subscribeBanner(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export const bannerSnapshot = (): BannerItem | null => banner

export function dismissBanner(): void {
  if (bannerTimer) {
    clearTimeout(bannerTimer)
    bannerTimer = null
  }
  if (!banner) return
  banner = null
  emit()
}

function showBanner(item: Omit<BannerItem, 'id'>): void {
  if (bannerTimer) clearTimeout(bannerTimer)
  banner = { ...item, id: ++bannerSeq }
  emit()
  bannerTimer = setTimeout(() => {
    bannerTimer = null
    banner = null
    emit()
  }, BANNER_MS)
  console.log(`[notify] banner ${item.reason} ${item.title}`)
}

// ---- opening what the notification points at ----------------------------------------------

/** The terminal behind a tab id, so the caret can go back where the answer has to be typed. */
function ptyOfTab(tab: string): number | null {
  const st = useDesk.getState()
  const ws = st.workspaces.find((w) => `ws:${w.id}` === tab)
  return ws?.ptyId ?? null
}

/** Bring the tab the notification is about to the front and put the caret in its terminal. */
export function openNotifyTarget(tab: string, ptyId?: number | null): void {
  if (!tab) return
  const st = useDesk.getState()
  st.setActiveTab(tab)
  const pty = ptyId ?? ptyOfTab(tab)
  if (pty !== null) st.requestTerminalFocus(pty)
}

// ---- wording -------------------------------------------------------------------------------

/** The name on the tab the notification points at. */
function tabLabel(sess: SessionState | null, tab: string): string {
  const st = useDesk.getState()
  const ws = st.workspaces.find((w) => `ws:${w.id}` === tab)
  return shortName(sess?.title || ws?.title || sess?.info.name || '터미널', 28)
}

/** What a waiting terminal is waiting about: the last thing said, else the prompt that started it. */
function waitingBody(sess: SessionState | null): string {
  const said = sess?.lastSaid?.trim() || sess?.lastPrompt?.trim() || ''
  return said ? shortName(said, 90) : t().notifyWaitingBody
}

function turnBody(sess: SessionState): string {
  const turn = sess.lastTurn
  if (!turn) return t().notifyTurnBody
  return t().turnSummary(turn.files, turn.added, turn.removed, formatDuration(turn.durationMs))
}

// ---- the gates -------------------------------------------------------------------------------

const sent = new Map<string, number>()

function allowed(key: string, now: number): boolean {
  const last = sent.get(key)
  if (last !== undefined && now - last < DEDUP_MS) return false
  sent.set(key, now)
  // the map only ever holds one entry per tag+terminal, but a long session churns through pty ids
  if (sent.size > 64) for (const [k, v] of sent) if (now - v > DEDUP_MS) sent.delete(k)
  return true
}

function focused(): boolean {
  try {
    return document.hasFocus()
  } catch {
    return true // no idea → assume the user is looking, and stay quiet
  }
}

function beep(): void {
  if (!useDesk.getState().prefs.notify.sound) return
  try {
    const audio = new Audio(soundUrl)
    audio.volume = 0.5
    void audio.play().catch(() => {
      /* autoplay policy, no output device — the popup is still there */
    })
  } catch {
    /* ignore */
  }
}

/** the palette on screen right now — App.tsx writes it on <html>; the popup is painted to match */
const painted = (): NotifyRequest['theme'] => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

/** Hand one notification to main, and fall back to the in-app banner when it cannot show it. */
function raise(req: Omit<NotifyRequest, 'theme'>, ptyId: number | null): void {
  beep()
  const bridge = window.desk
  if (!bridge) return
  void bridge.notify
    .show({ ...req, theme: painted() })
    .then((result) => {
      if (result === 'shown') return
      showBanner({ title: req.title, body: req.body, tab: req.tab, ptyId, reason: result })
    })
    .catch(() => showBanner({ title: req.title, body: req.body, tab: req.tab, ptyId, reason: 'failed' }))
}

// ---- watching the store ----------------------------------------------------------------------

let installed = false

export function installNotifier(): void {
  if (installed || !window.desk) return
  installed = true
  const armAt = Date.now() + ARM_MS

  const st0 = useDesk.getState()
  // Seed from what is already there: a terminal that was waiting before this module loaded, or a
  // session that already has turns, must not fire the moment the watcher starts.
  let prevWaiting = st0.ptyWaiting
  const prevTurns = new Map<string, number>(Object.entries(st0.sessions).map(([id, s]) => [id, s.turns]))

  useDesk.subscribe((s) => {
    const now = Date.now()
    const prefs = s.prefs.notify

    // (a) a terminal started waiting for an answer
    if (s.ptyWaiting !== prevWaiting) {
      for (const [key, w] of Object.entries(s.ptyWaiting)) {
        const ptyId = Number(key)
        const before = prevWaiting[ptyId]
        if (before && before.ts === w.ts && before.reason === w.reason) continue
        const on = w.reason === 'permission' ? prefs.permission : prefs.question
        if (!on || focused() || now - w.ts > AGE_MS) continue
        if (!allowed(`${w.reason}:${ptyId}`, now)) continue
        const ws = s.workspaces.find((x) => x.ptyId === ptyId)
        const tab = ws ? `ws:${ws.id}` : ''
        const sess = Object.values(s.sessions).find((x) => x.info.ptyId === ptyId) ?? null
        const label = tabLabel(sess, tab)
        raise(
          {
            title: w.reason === 'permission' ? t().notifyPermission(label) : t().notifyQuestion(label),
            body: waitingBody(sess),
            tag: w.reason,
            tab,
          },
          ptyId,
        )
      }
      prevWaiting = s.ptyWaiting
    }

    // (b) one of our own sessions finished a turn
    for (const [id, sess] of Object.entries(s.sessions)) {
      const before = prevTurns.get(id)
      prevTurns.set(id, sess.turns)
      if (before === undefined || sess.turns <= before) continue
      if (!prefs.turnEnd || !sess.info.mine || focused() || now < armAt) continue
      if (sess.lastTurn && now - sess.lastTurn.at > AGE_MS) continue
      const ptyId = sess.info.ptyId
      const ws = ptyId === null ? undefined : s.workspaces.find((x) => x.ptyId === ptyId)
      const tab = ws ? `ws:${ws.id}` : `session:${id}`
      if (!allowed(`turn:${ptyId ?? id}`, now)) continue
      raise({ title: t().notifyTurnEnd(tabLabel(sess, tab)), body: turnBody(sess), tag: 'turn', tab }, ptyId)
    }
    for (const id of [...prevTurns.keys()]) if (!s.sessions[id]) prevTurns.delete(id)
  })

  // a clicked popup card opens the tab it was about and puts the caret back in its terminal
  window.desk.notify.onClick((tab) => {
    dismissBanner()
    openNotifyTarget(tab)
  })
}

installNotifier()
