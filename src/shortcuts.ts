// Every global shortcut in one place, so the terminal key handler has a single list to let through
// (`isWindowShortcut` in src/Terminal.tsx) — plan §3.9. Owner: B.
//
// They all run on a window `keydown`. The terminal is the awkward part: xterm would otherwise send
// Ctrl+T straight to the shell, so its custom handler returns false for these and the event carries
// on bubbling up to here. That means there is exactly one implementation of each shortcut, and it
// behaves the same whether the caret is in the terminal, the sidebar or nowhere at all.
//
// Ctrl+W is *not* one of them: PSReadLine and Claude Code's input line both use it to delete the
// previous word, so closing a tab is Ctrl+Shift+W (plan §3.9, R6).

import { useEffect } from 'react'
import { clampFont } from './Terminal'
import { lastCwd, rememberRecent, setLastCwd } from './sidebar/recent'
import { useDesk } from './store'
import { probeTermVerbose, termLog } from './term/search'

/** the home folder, for a Ctrl+T pressed before any terminal has ever been opened */
let home = ''

/** Text the user is typing into: Ctrl+F belongs to that box, not to the terminal. */
function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && !el.isContentEditable) return false
  // xterm's hidden textarea is where every terminal keystroke lands; it is not a text box
  return !el.classList?.contains('xterm-helper-textarea')
}

/** The workspace tab that is open right now, if the active tab is a workspace at all. */
function activeWorkspace() {
  const s = useDesk.getState()
  return s.workspaces.find((w) => `ws:${w.id}` === s.activeTab) ?? null
}

function newTab(): void {
  const s = useDesk.getState()
  const dir = activeWorkspace()?.cwd || s.workspaces[s.workspaces.length - 1]?.cwd || lastCwd() || home
  if (!dir) return
  setLastCwd(dir)
  rememberRecent(dir)
  s.addWorkspace(dir)
  logTabs('ctrl+t')
}

/** capture runs only: say what the tab strip looks like now, since nobody is watching it */
function logTabs(what: string): void {
  const s = useDesk.getState()
  termLog(`[shortcut] ${what} tabs=${s.workspaces.length} active=${s.activeTab ?? 'none'} first=ws:${s.workspaces[0]?.id ?? '-'}`)
}

/**
 * Close the active tab. A terminal with a claude in it is not closed behind the user's back: the
 * tab's own × already asks first, so the shortcut opens that popover instead of pulling the rug.
 */
function closeTab(): void {
  const s = useDesk.getState()
  const ws = activeWorkspace()
  if (!ws) return
  const busy = ws.ptyId !== null && Object.values(s.sessions).some((x) => x.info.ptyId === ws.ptyId)
  if (busy) {
    const x = document.querySelector<HTMLElement>('.tab.active .tab-x')
    if (x) {
      x.click()
      termLog('[shortcut] ctrl+shift+w asked first (a claude is running in this tab)')
      return
    }
  }
  s.removeWorkspace(ws.id)
  logTabs('ctrl+shift+w')
}

function bumpFont(delta: number | 'reset'): void {
  const s = useDesk.getState()
  const next = delta === 'reset' ? 14 : clampFont(s.prefs.termFont + delta)
  if (next === s.prefs.termFont) return
  s.setPrefs({ termFont: next })
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    if (!home) void window.desk?.info().then((i) => (home = i.home))
    probeTermVerbose()

    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      const s = useDesk.getState()
      const key = e.key.toLowerCase()

      // Mini mode hides the tabs, the terminal and the sidebar (they stay mounted behind it), so the
      // only shortcut that still means anything there is the one that leaves it.
      if (s.mini && !(e.shiftKey && key === 'm')) return

      if (e.shiftKey) {
        if (key === 'w') {
          e.preventDefault()
          closeTab()
          return
        }
        if (key === 'm') {
          e.preventDefault()
          s.toggleMini()
          return
        }
        // Ctrl+Shift+= is how a lot of keyboards produce Ctrl++
        if (key === '+') {
          e.preventDefault()
          bumpFont(1)
        }
        return
      }

      switch (key) {
        case 'b': // the sidebar, wherever the focus is (the terminal lets this one through)
          e.preventDefault()
          s.setPrefs({ showSidebar: !s.prefs.showSidebar })
          return
        case 't':
          e.preventDefault()
          newTab()
          return
        case 'f':
          if (inEditable(e.target)) return
          if (!s.workspaces.length) return
          e.preventDefault()
          s.requestTermSearch(activeWorkspace()?.id ?? s.workspaces[0].id)
          return
        case '`':
          e.preventDefault()
          s.setPrefs({ folded: !s.prefs.folded })
          termLog(`[shortcut] ctrl+\` folded=${!s.prefs.folded}`)
          return
        case '=':
        case '+':
          e.preventDefault()
          bumpFont(1)
          return
        case '-':
          e.preventDefault()
          bumpFont(-1)
          return
        case '0':
          e.preventDefault()
          bumpFont('reset')
          return
        default:
          break
      }

      // Ctrl+1 … Ctrl+9: the nth terminal tab
      if (key.length === 1 && key >= '1' && key <= '9') {
        const ws = s.workspaces[Number(key) - 1]
        if (!ws) return
        e.preventDefault()
        s.setActiveTab(`ws:${ws.id}`)
        logTabs(`ctrl+${key}`)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
