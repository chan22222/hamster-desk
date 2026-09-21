// Remember the open terminal tabs and put them back at the next start.
// Phase 0 keeps exactly the old behaviour (one tab, in the folder we left off in); the real
// restore — saved tabs, the active one, and the skips for debug runs — lands with the window
// work, plan §3.3. Owner: A.

import { lastCwd } from './sidebar/recent'
import { useDesk } from './store'

export async function restoreWorkspaces(home: string): Promise<void> {
  const st = useDesk.getState()
  if (st.workspaces.length > 0) return
  st.addWorkspace(lastCwd() || home)
}
