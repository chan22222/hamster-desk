// The card that sums a finished turn up: "파일 3 · +120 −40 · 2분 10초", and the last thing the
// hamster said. It appears in the bottom-right corner of the column when a turn ends and takes
// itself away after a few seconds (the store books that, so it also happens while mini mode has
// this component unmounted).

import { useDesk } from '../store'
import { t } from '../i18n'
import { formatDuration } from './turn'
import { IconClose } from '../widgets/icons'
import './log.css'

export function TurnToast() {
  const toast = useDesk((s) => s.toast)
  // mini mode is 480×360 of studio: the thin status bar carries `lastTurn` instead of a card
  const mini = useDesk((s) => s.mini)
  const setToast = useDesk((s) => s.setToast)
  const setActiveTab = useDesk((s) => s.setActiveTab)
  const setPrefs = useDesk((s) => s.setPrefs)

  if (!toast || mini) return null

  const line = t().turnSummary(toast.files, toast.added, toast.removed, formatDuration(toast.durationMs))

  return (
    <div className="turn-toast" role="status">
      <button
        className="tt-main"
        data-debug-click="toast"
        title="이 턴이 바꾼 파일 보기"
        onClick={() => {
          // what the card is a summary *of* is the changed-file list; open it where it lives
          setActiveTab(toast.tab)
          setPrefs({ showSidebar: true, showLog: true })
          setToast(null)
        }}
      >
        <span className="tt-line">{line}</span>
        {toast.said && <span className="tt-said">{toast.said}</span>}
      </button>
      <button className="tt-x" aria-label="닫기" title="닫기" onClick={() => setToast(null)}>
        <IconClose size={12} />
      </button>
    </div>
  )
}
