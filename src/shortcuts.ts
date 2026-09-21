// Every global shortcut in one place, so the terminal key handler has a single list to let
// through. Phase 0 holds only the one that already existed (Ctrl+B); Ctrl+T, Ctrl+Shift+W,
// Ctrl+1~9, Ctrl+`, Ctrl+Shift+M and Ctrl+F arrive with the terminal work — plan §3.9. Owner: B.

import { useEffect } from 'react'
import { useDesk } from './store'

export function useGlobalShortcuts(): void {
  useEffect(() => {
    // Ctrl+B: the sidebar, wherever the focus is (the terminal lets this one through)
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b') return
      e.preventDefault()
      const s = useDesk.getState()
      s.setPrefs({ showSidebar: !s.prefs.showSidebar })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
