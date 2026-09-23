import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { arrowInMenu, followFocus, rove, tabbables, trapTab } from './focus'

interface PopoverProps {
  /** what the trigger button shows */
  label: ReactNode
  /** extra classes for the trigger button (`pill`, `icon-btn`, …) */
  className?: string
  title?: string
  ariaLabel?: string
  disabled?: boolean
  width?: number
  /** the trigger's place in the Tab order: a tab strip takes its inactive tabs' `×` out of it */
  tabIndex?: number
  /** debug/e2e: the name `HAMSTER_CLICK` presses this trigger by (src/dev/debug.ts) */
  debugClick?: string
  /** told when the panel opens and when it closes, whichever way */
  onOpenChange?: (open: boolean) => void
  /** the panel body; a function gets a `close` callback */
  children: ReactNode | ((close: () => void) => ReactNode)
}

/**
 * The one popover in the app: opens under its trigger, closes on Esc or an outside click,
 * and flips to right-aligned when it would run off the window. It never flips upward, so what does
 * not fit under the trigger scrolls inside the panel instead of being cut off by the window edge.
 *
 * The panel is portalled to `<body>`: it is `position: fixed` and positioned in viewport pixels,
 * and a trigger inside a container-query box (`.desk-studio`, `.panes`) or under styles that reach
 * every descendant button (the studio's welcome card) would otherwise displace or restyle it. The
 * theme lives on `<html data-theme>`, so the panel keeps its tokens wherever it renders.
 *
 * The keyboard (src/widgets/focus.ts): opening moves the focus in — to the chosen row of a menu
 * inside (a `role="menu"` list, one Tab stop, ↑ ↓ between its rows), else to the first control —
 * Tab goes round inside the panel, and closing hands the focus back to the trigger whenever it was
 * in the panel. An outside click does not: that click put the focus where it wanted it.
 */
export function Popover({ label, className = '', title, ariaLabel, disabled, width, tabIndex, debugClick, onOpenChange, children }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  /** the focus has been moved in for this opening */
  const focused = useRef(false)
  const openChange = useRef(onOpenChange)
  openChange.current = onOpenChange

  const dismiss = (restore: boolean): void => {
    if (restore && panelRef.current?.contains(document.activeElement)) btnRef.current?.focus()
    setOpen(false)
  }
  const close = (): void => dismiss(true)

  // Placed again when the width changes, too: a panel that switches to a wider view of itself
  // (the session bar's `⋯` opening `지난 대화`) must not run off the window edge.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      focused.current = false
      return
    }
    const btn = btnRef.current
    const panel = panelRef.current
    if (!btn || !panel) return
    const r = btn.getBoundingClientRect()
    const w = panel.offsetWidth
    const left = r.left + w > window.innerWidth - 8 ? Math.max(8, r.right - w) : Math.max(8, r.left)
    setPos({ left, top: Math.round(r.bottom + 6) })
  }, [open, width])

  // Only once the panel is placed: until then it is `visibility: hidden`, and a hidden control
  // cannot take the focus — the call used to run in the same breath as the placing and did nothing.
  useEffect(() => {
    const panel = panelRef.current
    if (!open || !pos || !panel || focused.current) return
    focused.current = true
    let first: HTMLElement | null = null
    panel.querySelectorAll<HTMLElement>('[role="menu"]').forEach((m) => {
      const stop = rove(m)
      first ??= stop
    })
    ;(first ?? tabbables(panel)[0])?.focus()
  }, [open, pos])

  useEffect(() => {
    openChange.current?.(open)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || btnRef.current?.contains(target)) return
      dismiss(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setOpen(false)
      btnRef.current?.focus()
    }
    const onResize = (): void => dismiss(true)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
    // `dismiss` only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${className} ${open ? 'is-open' : ''}`}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-debug-click={debugClick}
        disabled={disabled}
        tabIndex={tabIndex}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="pop"
          role="dialog"
          aria-label={ariaLabel ?? title}
          onKeyDown={(e) => {
            if (!arrowInMenu(e)) trapTab(e, e.currentTarget)
          }}
          onFocus={(e) => followFocus(e.target)}
          style={{
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            width,
            // an explicit width wins over the stylesheet's 320px cap, but never the window
            maxWidth: width === undefined ? undefined : `min(${width}px, calc(100vw - 16px))`,
            visibility: pos ? 'visible' : 'hidden',
            maxHeight: `calc(100vh - ${pos?.top ?? 0}px - 8px)`,
            overflowX: 'hidden',
            overflowY: 'auto',
          }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>,
        document.body,
      )}
    </>
  )
}
