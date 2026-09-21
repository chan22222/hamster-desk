// Keeping one folder's git snapshot fresh, without asking git more often than it is worth.
//
// The active tab polls every ten seconds (a branch switch or a `git add` in the terminal below
// should show up on its own), and an edit landing is the one moment the numbers are certainly
// stale, so that re-reads after a short debounce. A tab nobody is looking at reads once, when it
// mounts: its chip has to say something, but it does not have to keep saying it.

import { useEffect, useRef } from 'react'
import type { GitInfo } from '@shared/events'
import { gitKey, sessionForTab, useDesk } from '../store'

const POLL_MS = 10_000
/** an edit rarely arrives alone; wait for the burst to finish before asking */
const EDIT_DEBOUNCE_MS = 1500

export function useGit(cwd: string, active: boolean): GitInfo | null {
  const info = useDesk((s) => s.git[gitKey(cwd)] ?? null)
  const setGit = useDesk((s) => s.setGit)
  // only the active tab tracks edits: an inactive one is not polling anyway
  const edits = useDesk((s) => (active ? sessionForTab(s, s.activeTab)?.edits.length ?? 0 : 0))
  const first = useRef(true)

  useEffect(() => {
    const bridge = window.desk
    if (!cwd || !bridge) return
    let alive = true
    const read = (): void => {
      void bridge.git.info(cwd).then((i) => {
        if (alive) setGit(cwd, i)
      })
    }
    read()
    if (!active) return () => { alive = false }
    const timer = setInterval(read, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [cwd, active, setGit])

  useEffect(() => {
    // the mount read above already covers the first value; this effect is for *changes*
    if (first.current) {
      first.current = false
      return
    }
    const bridge = window.desk
    if (!active || !cwd || !bridge) return
    let alive = true
    const timer = setTimeout(() => {
      void bridge.git.info(cwd).then((i) => {
        if (alive) setGit(cwd, i)
      })
    }, EDIT_DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [edits, active, cwd, setGit])

  return info
}
