import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface PopoverProps {
  /** what the trigger button shows */
  label: ReactNode
  /** extra classes for the trigger button (`pill`, `icon-btn`, …) */
  className?: string
  title?: string
  ariaLabel?: string
  disabled?: boolean
  width?: number
  /** debug/e2e: the name `HAMSTER_CLICK` presses this trigger by (src/dev/debug.ts) */
  debugClick?: string
  /** the panel body; a function gets a `close` callback */
  children: ReactNode | ((close: () => void) => ReactNode)
}

/**
 * The one popover in the app: opens under its trigger, closes on Esc or an outside click,
 * and flips to right-aligned when it would run off the window. It never flips upward, so what does
 * not fit under the trigger scrolls inside the panel instead of being cut off by the window edge.
 *
 * The panel is portalled to `<body>`: it is `position: fixed` and positioned in viewport pixels,
 * and a trigger inside a container-query box (`.desk-studio`) or under styles that reach every
 * descendant button (the studio's welcome card) would otherwise displace or restyle it. The theme
 * lives on `<html data-theme>`, so the panel keeps its tokens wherever it renders.
 */
export function Popover({ label, className = '', title, ariaLabel, disabled, width, debugClick, children }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = (): void => setOpen(false)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const btn = btnRef.current
    const panel = panelRef.current
    if (!btn || !panel) return
    const r = btn.getBoundingClientRect()
    const w = panel.offsetWidth
    const left = r.left + w > window.innerWidth - 8 ? Math.max(8, r.right - w) : Math.max(8, r.left)
    setPos({ left, top: Math.round(r.bottom + 6) })
    panel.querySelector<HTMLElement>('button, select, input, [tabindex]')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || btnRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setOpen(false)
      btnRef.current?.focus()
    }
    const onScroll = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScroll)
    }
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
