// Mini mode: a small always-on-top window with just the studio and a thin status line.
// Placeholder body (not `null`) so the `mini ?` branch in App.tsx renders something visible while
// the real shell is built — plan §3.10. Owner: A.

import type { SessionState } from '../store'

export function MiniShell(_props: { session: SessionState | null }) {
  return <div className="mini-shell">미니 모드</div>
}
