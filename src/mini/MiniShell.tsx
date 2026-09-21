// Mini mode: a small always-on-top window with just the studio and a thin status line.
// Placeholder body (not `null`) so the branch in App.tsx renders something visible while the real
// shell is built — plan §3.10. Owner: A.
//
// Two rules the real implementation has to keep:
//  1. App.tsx already hides the normal layout (`.app.is-mini > .topbar, > .body`) and keeps it
//     mounted on purpose — a TerminalPane that unmounts kills its pty, and with it the claude
//     running in that shell. MiniShell must not try to hide or replace anything itself.
//  2. `DeskStudio` is a singleton renderer and must exist in exactly one place. App.tsx skips its
//     own studio while `mini` is on, so MiniShell is the one that renders
//     `<DeskStudio session={session} height={measured} />`.

import { useDesk, type SessionState } from '../store'

export function MiniShell(_props: { session: SessionState | null }) {
  const toggleMini = useDesk((s) => s.toggleMini)
  return (
    <div className="mini-shell">
      <span>미니 모드</span>
      {/* the only way out until the real status line exists: mini hides the top bar and its ⋯ menu */}
      <button data-debug-click="mini-exit" onClick={toggleMini} title="원래 크기로">
        ⤢ 복귀
      </button>
    </div>
  )
}
