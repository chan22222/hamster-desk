// Mini mode: a small always-on-top window with just the studio and a thin status line. Plan §3.10.
//
// Two rules this has to keep:
//  1. App.tsx already hides the normal layout (`.app.is-mini > .topbar, > .body`) and keeps it
//     mounted on purpose — a TerminalPane that unmounts kills its pty, and with it the claude
//     running in that shell. MiniShell must not try to hide or replace anything itself.
//  2. `DeskStudio` is a singleton renderer and must exist in exactly one place. App.tsx skips its
//     own studio while `mini` is on, so MiniShell is the one that renders
//     `<DeskStudio session={session} height={measured} />`.

import { useEffect, useRef, useState } from 'react'
import './mini.css'
import { DeskStudio } from '../desk/DeskStudio'
import { durationText } from '../notify/notifier'
import { t } from '../i18n'
import { shortName, useDesk, type SessionState } from '../store'
import type { TurnSummary } from '@shared/events'

/** how long a finished turn keeps the title line before the tab name comes back */
const TURN_SHOW_MS = 10_000

/** `lastTurn`, while it is still worth showing. Mini has no room for the toast card (§3.6). */
function useFreshTurn(turn: TurnSummary | null): TurnSummary | null {
  const [, tick] = useState(0)
  const at = turn?.at ?? 0
  useEffect(() => {
    if (!at) return
    const left = at + TURN_SHOW_MS - Date.now()
    if (left <= 0) return
    const id = setTimeout(() => tick((n) => n + 1), left)
    return () => clearTimeout(id)
  }, [at])
  if (!turn) return null
  return Date.now() - turn.at < TURN_SHOW_MS ? turn : null
}

export function MiniShell({ session }: { session: SessionState | null }) {
  const toggleMini = useDesk((s) => s.toggleMini)
  const prefs = useDesk((s) => s.prefs)
  const setPrefs = useDesk((s) => s.setPrefs)
  const workspaces = useDesk((s) => s.workspaces)
  const activeTab = useDesk((s) => s.activeTab)
  const ptyWaiting = useDesk((s) => s.ptyWaiting)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageH, setStageH] = useState(0)

  // the studio takes a height in pixels, and only the DOM knows what is left over above the bar
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const read = (): void => setStageH((h) => (h === el.clientHeight ? h : el.clientHeight))
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const ws = workspaces.find((w) => `ws:${w.id}` === activeTab) ?? null
  const title = shortName(session?.title || ws?.title || session?.info.name || 'Hamster Desk', 30)
  const working = session ? Object.values(session.hamsters).filter((h) => h.state !== 'idle' && h.state !== 'leaving').length : 0
  const waiting = Object.keys(ptyWaiting).length
  const pct = session?.status?.contextUsedPct ?? null
  const turn = useFreshTurn(session?.lastTurn ?? null)
  const sound = prefs.notify.sound

  return (
    <div className="mini-shell">
      <div ref={stageRef} className="mini-stage">
        <DeskStudio session={session} height={Math.max(1, stageH)} />
      </div>
      <div className="mini-bar">
        <span className={`mb-title ${turn ? 'is-turn' : ''}`} title={ws?.cwd || title}>
          {turn ? t().turnSummary(turn.files, turn.added, turn.removed, durationText(turn.durationMs)) : title}
        </span>
        <span className="mb-chips">
          <span className="mb-chip" title="일하는 중인 햄스터">
            작업 {working}
          </span>
          <span className={`mb-chip ${waiting > 0 ? 'is-wait' : ''}`} title="답을 기다리는 터미널">
            확인 {waiting}
          </span>
          {pct !== null && (
            <span className={`mb-chip ${pct >= 90 ? 'is-hot' : pct >= 70 ? 'is-warm' : ''}`} title="컨텍스트 사용률">
              {Math.round(pct)}%
            </span>
          )}
        </span>
        <button
          className="mb-btn"
          data-debug-click="mini-sound"
          aria-pressed={sound}
          title={sound ? '알림 소리 끄기' : '알림 소리 켜기'}
          onClick={() => setPrefs({ notify: { ...prefs.notify, sound: !sound } })}
        >
          {sound ? '🔔' : '🔕'}
        </button>
        <button className="mb-btn mb-exit" data-debug-click="mini-exit" onClick={toggleMini} title="원래 크기로 (Ctrl+Shift+M)" aria-label="원래 크기로">
          ⤢ 복귀
        </button>
      </div>
    </div>
  )
}
