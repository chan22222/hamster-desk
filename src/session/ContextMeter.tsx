// How much of the context window this session has used. Stub: plan §3.2. Owner: B.

import type { SessionState } from '../store'

/** the small percentage that rides along in the tab label */
export function TabContext(_props: { session: SessionState | null }) {
  return null
}

/** the wider meter the session bar shows */
export function ContextMeter(_props: { session: SessionState | null }) {
  return null
}
