import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { runInTerminal, useDesk, type Workspace } from './store'
import { usePainted, type Painted } from './widgets/theme'
import { createSearchAddon, probeTermVerbose, searchOptions, termLog, type TermSearcher } from './term/search'
import { TermSearch } from './term/TermSearch'

// The terminal is dark in *both* themes: Claude Code paints this pane with its own palette, and a
// light background would swallow every dim colour it uses. Dark mode only deepens the background,
// so the pane stops being the one dark rectangle and simply matches the app around it (--term-bg).
// The cursor and the selection are the app's accent (styles.css --accent, the dark value in both
// because the pane is dark in both), not a colour of Claude Code's own.
const THEME: Record<Painted, Record<string, string>> = {
  light: {
    background: '#121814',
    foreground: '#dfe6da',
    cursor: '#e0855f',
    selectionBackground: '#b04f2c66',
    black: '#12181a',
    brightBlack: '#8b968d',
  },
  dark: {
    background: '#0e1310',
    foreground: '#e3eade',
    cursor: '#ea9a78',
    selectionBackground: '#c25d3766',
    black: '#0d120f',
    brightBlack: '#8f9a91',
  },
}

/** the font size range the `⋯` menu and Ctrl+= / Ctrl+− stay inside */
const FONT = { min: 10, max: 24, def: 14 }
export const clampFont = (n: number): number => Math.max(FONT.min, Math.min(FONT.max, Math.round(n) || FONT.def))

/** The desktop app owns the clipboard; the browser preview falls back to the async clipboard API. */
function writeClipboard(text: string): void {
  if (window.desk) window.desk.clipboard.writeText(text)
  else void navigator.clipboard?.writeText(text).catch(() => undefined)
}
async function readClipboard(): Promise<string> {
  if (window.desk) return window.desk.clipboard.readText()
  try {
    return (await navigator.clipboard?.readText()) ?? ''
  } catch {
    return ''
  }
}

/**
 * Combinations the window owns, which xterm must therefore not swallow.
 *
 * Returning false from the custom key handler only tells xterm to keep its hands off — the DOM
 * event carries on bubbling to `useGlobalShortcuts`, which is where each of these is actually
 * carried out. Ctrl+W is deliberately absent: both PSReadLine and Claude Code's input line use it
 * to delete the previous word, so closing a tab is Ctrl+Shift+W (plan §3.9, R6).
 */
function isWindowShortcut(e: KeyboardEvent): boolean {
  if (!e.ctrlKey || e.altKey) return false
  const key = e.key.toLowerCase()
  if (e.shiftKey) return key === 'w' || key === 'm' || key === '+'
  if (key === 'b' || key === 'f' || key === 't' || key === '`') return true
  if (key === '=' || key === '+' || key === '-' || key === '0') return true
  return key.length === 1 && key >= '1' && key <= '9'
}

/** One embedded terminal per workspace. Hidden panes stay mounted so their scrollback survives tab switches. */
export function TerminalPane({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const bind = useDesk((s) => s.bindWorkspacePty)
  const fitRef = useRef<{ fit: () => void; focus: () => void } | null>(null)
  const termRef = useRef<XTerm | null>(null)
  const searchRef = useRef<TermSearcher | null>(null)
  const ptyIdRef = useRef<number | null>(null)
  const painted = usePainted()
  // the pane is built once per workspace, so the theme it started with is read from a ref
  const paintedRef = useRef(painted)
  paintedRef.current = painted

  // ---- the find box ------------------------------------------------------------------------
  // The overlay is stateless; the query lives here, next to the add-on that answers it.
  const [find, setFind] = useState({ open: false, q: '', cs: false, focusKey: 0 })
  const [hits, setHits] = useState({ index: 0, total: 0 })
  const openFind = (q?: string): void => setFind((s) => ({ open: true, q: q ?? s.q, cs: s.cs, focusKey: s.focusKey + 1 }))
  const closeFind = (): void => {
    setFind((s) => ({ ...s, open: false }))
    setHits({ index: 0, total: 0 })
    try {
      searchRef.current?.clearDecorations()
    } catch {
      /* nothing was decorated */
    }
    termRef.current?.clearSelection()
    fitRef.current?.focus()
  }
  /** the key handler is built once, so it reaches the current callbacks through a ref */
  const actionsRef = useRef<{ close: () => void; isOpen: () => boolean }>({ close: () => undefined, isOpen: () => false })
  actionsRef.current = { close: closeFind, isOpen: () => find.open }

  const runFind = (q: string, cs: boolean, how: 'next' | 'prev' | 'incremental'): void => {
    const addon = searchRef.current
    const term = termRef.current
    if (!addon || !term) return
    if (!q) {
      try {
        addon.clearDecorations()
      } catch {
        /* nothing was decorated */
      }
      term.clearSelection()
      setHits({ index: 0, total: 0 })
      return
    }
    try {
      if (how === 'prev') addon.findPrevious(q, searchOptions(cs, false))
      else addon.findNext(q, searchOptions(cs, how === 'incremental'))
    } catch (e) {
      termLog(`[term] search failed: ${String(e)}`)
    }
  }

  useEffect(() => {
    probeTermVerbose()
  }, [])

  useEffect(() => {
    const host = hostRef.current
    const bridge = window.desk
    if (!host) return
    const term = new XTerm({
      theme: THEME[paintedRef.current],
      fontFamily: '"Cascadia Mono", "D2Coding", "JetBrains Mono", Consolas, "Malgun Gothic", monospace',
      fontSize: clampFont(useDesk.getState().prefs.termFont),
      lineHeight: 1.15,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      windowsPty: { backend: 'conpty' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    try {
      term.loadAddon(new WebglAddon())
    } catch {
      /* canvas renderer fallback */
    }
    // The add-on is loaded behind a try: if it ever stops agreeing with the xterm it is bundled
    // with, the terminal still has to come up — the find box is the only thing that goes away.
    let offResults: { dispose(): void } | null = null
    try {
      const addon = createSearchAddon()
      term.loadAddon(addon)
      searchRef.current = addon
      offResults = addon.onDidChangeResults((r) => {
        setHits({ index: r.resultIndex >= 0 ? r.resultIndex + 1 : 0, total: r.resultCount })
        termLog(`[term] search ${r.resultIndex >= 0 ? r.resultIndex + 1 : 0}/${r.resultCount}`)
      })
    } catch (e) {
      searchRef.current = null
      termLog(`[term] search addon unavailable: ${String(e)}`)
    }

    // ---- copy / paste, the way Windows Terminal does it ------------------------------------
    const copySelection = (): boolean => {
      const sel = term.getSelection()
      if (!sel) return false
      writeClipboard(sel)
      term.clearSelection()
      return true
    }
    const paste = (): void => {
      void readClipboard().then((text) => {
        if (text) term.paste(text) // bracketed paste, so Claude Code sees one paste
      })
    }
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const key = e.key.toLowerCase()
      if (e.ctrlKey && !e.altKey) {
        // Ctrl+C copies when there is a selection, and interrupts when there is not
        if (key === 'c' && !e.shiftKey) return !copySelection()
        if (key === 'c' && e.shiftKey) {
          copySelection()
          return false
        }
        if (e.key === 'Insert') {
          copySelection()
          return false
        }
        if (key === 'v') {
          paste()
          return false
        }
      }
      if (e.shiftKey && e.key === 'Insert') {
        paste()
        return false
      }
      // the find box is open and the caret wandered back into the terminal: Esc still closes it
      if (e.key === 'Escape' && actionsRef.current.isOpen()) {
        actionsRef.current.close()
        return false
      }
      // everything the window owns keeps bubbling to `useGlobalShortcuts`
      if (isWindowShortcut(e)) return false
      return true
    })
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      if (!copySelection()) paste()
    }
    host.addEventListener('contextmenu', onContextMenu)

    const safeFit = (): void => {
      try {
        fit.fit()
      } catch {
        /* hidden */
      }
    }
    safeFit()
    fitRef.current = { fit: safeFit, focus: () => term.focus() }

    if (!bridge) {
      term.writeln('\x1b[2m(browser preview: no pty — replaying a recorded session on the desk above)\x1b[0m')
      return () => {
        host.removeEventListener('contextmenu', onContextMenu)
        offResults?.dispose()
        term.dispose()
      }
    }

    let id: number | null = null
    let disposed = false
    const offData = bridge.pty.onData((pid, data) => {
      if (pid === id) term.write(data)
    })
    const offExit = bridge.pty.onExit((pid, code) => {
      if (pid === id) term.writeln(`\r\n\x1b[2m[shell exited ${code}]\x1b[0m`)
    })
    const offType = bridge.onDebugType((pid, text) => {
      if (pid === id) term.input(text) // smoke tests: keystrokes through xterm
    })
    const onInput = term.onData((d) => {
      if (id !== null) bridge.pty.input(id, d)
    })
    void bridge.pty.create(term.cols, term.rows, ws.cwd, ws.profileId).then((info) => {
      if (disposed) {
        bridge.pty.kill(info.id)
        return
      }
      id = info.id
      ptyIdRef.current = info.id
      bind(ws.id, info.id, info.cwd)
      bridge.pty.resize(info.id, term.cols, term.rows)
      const first = ws.initialCommand ?? ws.runOnce
      // give the shell a moment to print its prompt before typing into it
      if (first) setTimeout(() => runInTerminal(info.id, first), 1200)
      if (visible) term.focus()
    })

    const ro = new ResizeObserver(() => {
      if (host.offsetParent === null) return // hidden tab
      safeFit()
      if (id !== null) bridge.pty.resize(id, term.cols, term.rows)
    })
    ro.observe(host)

    return () => {
      disposed = true
      ro.disconnect()
      host.removeEventListener('contextmenu', onContextMenu)
      onInput.dispose()
      offResults?.dispose()
      offData()
      offExit()
      offType()
      if (id !== null) bridge.pty.kill(id)
      ptyIdRef.current = null
      term.dispose()
    }
    // the pty lives as long as the pane; workspace identity never changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.id])

  useEffect(() => {
    if (!visible) return
    const t = setTimeout(() => {
      fitRef.current?.fit()
      fitRef.current?.focus()
    }, 30)
    return () => clearTimeout(t)
  }, [visible])

  // Something outside the pane ran a command in this terminal (the welcome card, an update tab):
  // put the caret back here so the next keystroke goes to the program that just started.
  const focusReq = useDesk((s) => s.focusTerminal)
  useEffect(() => {
    if (!focusReq || focusReq.ptyId !== ws.ptyId) return
    fitRef.current?.focus()
  }, [focusReq, ws.ptyId])

  // follow the app's theme: only the background really moves, but it has to match --term-bg or the
  // pane draws a seam against the surface behind it
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = THEME[painted]
  }, [painted])

  // Font size. Changing it changes how many columns fit, so the pty has to be told — otherwise the
  // program inside keeps wrapping at the old width.
  const termFont = useDesk((s) => s.prefs.termFont)
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const n = clampFont(termFont)
    if (term.options.fontSize === n) return
    term.options.fontSize = n
    fitRef.current?.fit()
    const id = ptyIdRef.current
    if (id !== null) window.desk?.pty.resize(id, term.cols, term.rows)
    termLog(`[term] font ${n}px cols=${term.cols} rows=${term.rows}`)
  }, [termFont])

  // Ctrl+F from outside the pane, and the debug hook's `{"kind":"debug:search"}`
  const searchReq = useDesk((s) => s.searchRequest)
  useEffect(() => {
    if (!searchReq || searchReq.wsId !== ws.id) return
    openFind(searchReq.q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchReq, ws.id])

  // The one place a query turns into a search: typing it, and being handed one from outside.
  // `focusKey` is in the deps on purpose — asking for the box again with the same word is a request
  // to search again, and the scrollback it is searching has usually grown since last time.
  useEffect(() => {
    if (!find.open) return
    runFind(find.q, find.cs, 'incremental')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find.open, find.q, find.cs, find.focusKey])

  return (
    <div className="term-wrap" style={{ display: visible ? 'flex' : 'none' }}>
      <div ref={hostRef} className="term-host" />
      {find.open && searchRef.current && (
        <TermSearch
          q={find.q}
          caseSensitive={find.cs}
          index={hits.index}
          total={hits.total}
          focusKey={find.focusKey}
          onQuery={(q) => setFind((s) => ({ ...s, q }))}
          onCase={(cs) => setFind((s) => ({ ...s, cs }))}
          onNext={() => runFind(find.q, find.cs, 'next')}
          onPrev={() => runFind(find.q, find.cs, 'prev')}
          onClose={closeFind}
        />
      )}
    </div>
  )
}
