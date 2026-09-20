import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { useDesk, type Workspace } from './store'

// The one dark surface in a light app: Claude Code paints this pane with its own palette, and a
// light background would swallow every dim colour it uses.
const THEME = {
  background: '#121814',
  foreground: '#dfe6da',
  cursor: '#7fd4a3',
  selectionBackground: '#3f7a5a66',
  black: '#12181a',
  brightBlack: '#8b968d',
}

const CR = String.fromCharCode(13)

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

/** One embedded terminal per workspace. Hidden panes stay mounted so their scrollback survives tab switches. */
export function TerminalPane({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const bind = useDesk((s) => s.bindWorkspacePty)
  const fitRef = useRef<{ fit: () => void; focus: () => void } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    const bridge = window.desk
    if (!host) return
    const term = new XTerm({
      theme: THEME,
      fontFamily: '"Cascadia Mono", "D2Coding", "JetBrains Mono", Consolas, "Malgun Gothic", monospace',
      fontSize: 14,
      lineHeight: 1.15,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      windowsPty: { backend: 'conpty' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try {
      term.loadAddon(new WebglAddon())
    } catch {
      /* canvas renderer fallback */
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
        if (key === 'b' && !e.shiftKey) return false // the window uses Ctrl+B for the sidebar
      }
      if (e.shiftKey && e.key === 'Insert') {
        paste()
        return false
      }
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
    void bridge.pty.create(term.cols, term.rows, ws.cwd).then((info) => {
      if (disposed) {
        bridge.pty.kill(info.id)
        return
      }
      id = info.id
      bind(ws.id, info.id, info.cwd)
      bridge.pty.resize(info.id, term.cols, term.rows)
      if (ws.initialCommand) setTimeout(() => bridge.pty.input(info.id, ws.initialCommand + CR), 1200)
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
      offData()
      offExit()
      offType()
      if (id !== null) bridge.pty.kill(id)
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

  return <div ref={hostRef} className="term-host" style={{ display: visible ? 'block' : 'none' }} />
}
