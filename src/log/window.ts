// A long list in a short box: only the rows in view, and a few hundred pixels either side, are
// rendered. The two sidebar lists (the bubble log, the changed files) keep up to 500 rows each,
// and rendering every one of them again on every event of a busy session was what made the app
// slower the longer it ran — tens of milliseconds a batch, on the one thread the terminals type on.
//
// The rows that are not rendered are stood in for by an empty block above the rendered ones and
// one below, sized from each row's height as last measured (a row never seen yet counts as high as
// most rows are). A rendered row is still an ordinary block in the flow, so one that opens in place
// simply is taller, and is measured again once it is. The two blocks are siblings of the rows'
// element, not padding on it: the browser keeps what is being read in place while new rows come in
// above it (scroll anchoring), and it stops doing that when the padding of an element around the
// row it keeps in place changes — which, with padding, was every time the window moved. The blocks
// themselves are never what it keeps in place (`.rows-gap`, log.css): after a jump (the scrollbar
// dragged) the view shows nothing but the block below, and when the rows there were rendered and
// that block moved down, the browser followed it — thousands of pixels past where the view was put.
// With the blocks left out, though, after a jump it picks the list itself, which never moves: it
// picks from where things were at the last layout, and there were no rows there then. So a render
// that lands on rows nothing of which was rendered before (a jump) moves the box by a pixel and
// back, and the browser picks again, from the rows now laid out. The rows for a view the box was
// scrolled to are rendered in the scroll event itself, so a dragged scrollbar shows no blank frame.
//
// Nothing here reads the layout after a render, but for that jump: the rows are measured by a
// ResizeObserver, which is told the sizes once the browser has laid them out anyway, and the
// scroll position is read when the box scrolls or changes size. A read right after the render
// would make the browser lay out the whole window then and there, for every event.
//
// The keyboard: ↑ ↓ Home End move between the rows (each row's first button), rendered or not.
// A row that has the focus and is scrolled out of the window is taken out of the page, and the
// focus would go with it to nowhere; the list holds it instead, keys go on from that row, and the
// row gets it back once it is rendered again.

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { debugClick } from '../store'
import { listStep } from '../widgets/focus'

/** how far past either edge of the view rows are still rendered, in px */
const OVERSCAN = 320
/** a scroll shorter than this keeps the rendered rows (the overscan still covers it) */
const RESYNC = 96
/** a row's height before any has been measured: a one-line row of the bubble log */
const FIRST_GUESS = 26
/** the view assumed for the first render, before the box has been measured */
const FIRST_VIEW = 480

export interface RowSpan {
  /** the first row rendered */
  start: number
  /** one past the last row rendered */
  end: number
  /** how high the rows above `start` are together, in px */
  before: number
  /** and the rows from `end` on */
  after: number
}

/**
 * The rows that cover `[top, bottom)` of a list, given each row's height. Both are measured from
 * the list's own top edge, so a view scrolled past it has a positive `top`. There is always at
 * least one row rendered (if there is one at all), so there is always one to measure. `keep` is a
 * row that must be rendered wherever the view is (one being scrolled to): the span stretches to it.
 */
export function rowSpan(heights: readonly number[], top: number, bottom: number, keep = -1): RowSpan {
  const n = heights.length
  let y = 0
  let start = 0
  while (start < n && y + heights[start] <= top) y += heights[start++]
  if (start === n && n > 0) y -= heights[--start]
  let end = start
  while (end < n && (end === start || y < bottom)) y += heights[end++]
  if (keep >= 0 && keep < n) {
    start = Math.min(start, keep)
    end = Math.max(end, keep + 1)
  }
  let before = 0
  for (let i = 0; i < start; i++) before += heights[i]
  let after = 0
  for (let i = end; i < n; i++) after += heights[i]
  return { start, end, before, after }
}

/** the height most measured rows have (`tally`: height → how many rows), or the first guess */
export function typicalHeight(tally: ReadonlyMap<number, number>): number {
  let best = FIRST_GUESS
  let most = 0
  for (const [h, n] of tally) {
    if (n > most) {
      best = h
      most = n
    }
  }
  return best
}

/**
 * A capture run presses list rows by position (`log-<n>`, `file-<n>`: docs/development.md), so only
 * a run that asked for clicks names them. A position changes for every row whenever one is added
 * above it, and rendering every row again for an attribute nobody reads is what the window and
 * the memoized rows are there to stop.
 */
export const debugRows = (): boolean => debugClick() !== null

/** the control a row is moved to, and pressed, by the keyboard: its first button */
const mainOf = (row: Element): HTMLElement | null => row.querySelector('button')

/** what to do with a row asked for (it may have to be scrolled to, and rendered, first) */
type Then = 'show' | 'focus' | 'press'

/** scroll the row into view, the least that will do; and focus it, or focus and press it */
function settle(row: Element, then: Then): void {
  const main = mainOf(row)
  if (then !== 'show') main?.focus({ preventScroll: true })
  if (then === 'press') main?.click()
  row.scrollIntoView({ block: 'nearest' })
}

/** the nearest ancestor that scrolls vertically (in the sidebar, the section's `.side-rows`) */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if (y === 'auto' || y === 'scroll') return p
  }
  return null
}

export interface RowWindow extends RowSpan {
  /** goes on the element whose children are the rendered rows: one element per row, in order */
  ref: (el: HTMLDivElement | null) => void
  /** scroll the row with this key into view, whether it is rendered or not */
  reveal: (key: string) => void
  /** give row `i` the keyboard focus, scrolling to it (and rendering it) first if it is not in view */
  focusRow: (i: number) => void
}

/**
 * Window a list whose rows are named by `keys`, in display order. Render `rows.slice(start, end)`
 * as the children of the element `ref` goes on, right after an empty block `before` px high and
 * right before one `after` px high. `above` is where ↑ on the first row goes (a search box over
 * the list); without it, ↑ stops there.
 */
export function useRowWindow(keys: readonly string[], above?: () => void): RowWindow {
  /** the element holding the rows; state, so the box it scrolls in is looked up once it exists */
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const el = useRef<HTMLDivElement | null>(null)
  const box = useRef<HTMLElement | null>(null)
  /** each row's height as last measured; the rows that have left the list are dropped now and then */
  const heights = useRef(new Map<string, number>())
  /** how many of those are of each height; the most common is what a row not measured yet counts as */
  const tally = useRef(new Map<number, number>())
  /** the rows being measured: each rendered row element, and the key it is rendered under */
  const watched = useRef(new Map<Element, string>())
  const rowsObserver = useRef<ResizeObserver | null>(null)
  /** the part of the list in view, in px from its top edge */
  const [view, setView] = useState({ top: 0, height: FIRST_VIEW })
  /** bumped when a height changed: the padding, and maybe which rows are in view, move with it */
  const [, setMeasured] = useState(0)
  /** a row asked for before it was rendered: kept rendered until it has been seen to */
  const pending = useRef<{ key: string; then: Then } | null>(null)
  /** the rows the last render put on the page */
  const shown = useRef({ start: 0, end: 0 })
  /** the row the keyboard focus is on, or is held for while that row is out of the window */
  const focused = useRef<string | null>(null)

  const guess = typicalHeight(tally.current)
  const hs = keys.map((k) => heights.current.get(k) ?? guess)
  const keep = pending.current ? keys.indexOf(pending.current.key) : -1
  const span = rowSpan(hs, view.top - OVERSCAN, view.top + view.height + OVERSCAN, keep)
  /** the render the handlers below act on */
  const latest = useRef({ keys, hs, start: span.start, before: span.before, above, view })

  /**
   * Read how far the box is scrolled; a new view (a render) only once it has moved far enough.
   * `now`: rendered before this returns (from the scroll event, see the top of the file).
   */
  const sync = useCallback((now = false): void => {
    const b = box.current
    if (!b || !el.current) return
    // the list begins at the block above the rows' element
    const top = b.getBoundingClientRect().top - el.current.getBoundingClientRect().top + latest.current.before
    const height = b.clientHeight
    const v = latest.current.view
    if (Math.abs(v.top - top) < RESYNC && v.height === height) return
    const next = { top, height }
    latest.current.view = next
    if (now) flushSync(() => setView(next))
    else setView(next)
  }, [])

  /** scroll to row `i` and see to it (`then`), rendering it first if it is not in the window */
  const bring = useCallback(
    (i: number, then: Then): void => {
      const b = box.current
      const host = el.current
      const { keys, hs, start, before } = latest.current
      if (!b || !host || i < 0 || i >= keys.length) return
      const row = i >= start ? host.children[i - start] : undefined
      if (row) {
        settle(row, then)
        return
      }
      // scroll to where it will be, the way `nearest` would; it is kept rendered (`pending`) and
      // seen to after the render — rendered now, like a scroll's, with its real height
      let y = 0
      for (let j = 0; j < i; j++) y += hs[j]
      const at = host.getBoundingClientRect().top - before - b.getBoundingClientRect().top + y
      if (at < 0) b.scrollTop += at
      else b.scrollTop += at + hs[i] - b.clientHeight
      pending.current = { key: keys[i], then }
      flushSync(() => {
        sync()
        setMeasured((n) => n + 1)
      })
    },
    [sync],
  )

  /** a row was measured (`h`), or has left the list (null) */
  const note = useCallback((key: string, h: number | null): void => {
    const old = heights.current.get(key)
    if (old === h) return
    const t = tally.current
    if (old !== undefined) {
      const n = (t.get(old) ?? 1) - 1
      if (n > 0) t.set(old, n)
      else t.delete(old)
    }
    if (h === null) heights.current.delete(key)
    else {
      heights.current.set(key, h)
      t.set(h, (t.get(h) ?? 0) + 1)
    }
  }, [])

  // The box scrolls or changes size (a dragged section, a resized window); a rendered row changes
  // size (it opened, a diff loaded under it, the sidebar got narrower) or is measured for the first
  // time. A first measurement that says what was guessed changes nothing, and renders nothing.
  useLayoutEffect(() => {
    const b = host && scrollerOf(host)
    if (!host || !b) return
    el.current = host
    box.current = b
    const rows = new ResizeObserver((entries) => {
      const was = typicalHeight(tally.current)
      let moved = false
      for (const e of entries) {
        const key = watched.current.get(e.target)
        if (key === undefined) continue
        const h = e.borderBoxSize[0]?.blockSize ?? e.contentRect.height
        if (h !== (heights.current.get(key) ?? was)) moved = true
        note(key, h)
      }
      if (moved || typicalHeight(tally.current) !== was) setMeasured((n) => n + 1)
    })
    const resized = new ResizeObserver(() => sync())
    const scrolled = (): void => sync(true)
    rowsObserver.current = rows

    /** the rendered row an element is in */
    const rowOf = (t: EventTarget | null): Element | null => {
      let n = t instanceof Node ? t : null
      while (n && n.parentNode !== host) n = n.parentNode
      return n instanceof Element ? n : null
    }
    const focusIn = (e: FocusEvent): void => {
      if (e.target === host) return // held for a row: still that row
      const row = rowOf(e.target)
      focused.current = row ? (watched.current.get(row) ?? null) : null
    }
    const focusOut = (e: FocusEvent): void => {
      // the list is a place to hold the focus, not a Tab stop of its own
      if (e.target === host) host.removeAttribute('tabindex')
      // another window: the focus comes back to where it was
      if (!document.hasFocus()) return
      const to = e.relatedTarget
      if (to instanceof Node && host.contains(to)) return
      if (to) {
        focused.current = null
        return
      }
      // To nothing: a click on something that takes no focus — or the row taken out of the page,
      // scrolled out of the window, which is when the list is to hold the focus for it.
      const from = e.target
      queueMicrotask(() => {
        if (from instanceof Node && from.isConnected) focused.current = null
      })
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const { keys } = latest.current
      let i: number
      if (e.target === host) {
        i = focused.current === null ? -1 : keys.indexOf(focused.current)
        // Enter on the list is Enter on the row it holds the focus for
        if ((e.key === 'Enter' || e.key === ' ') && i >= 0) {
          e.preventDefault()
          bring(i, 'press')
          return
        }
      } else {
        const row = rowOf(e.target)
        if (!row || mainOf(row) !== e.target) return
        i = keys.indexOf(watched.current.get(row) ?? '')
      }
      const j = listStep(e.key, i, keys.length)
      if (j === null) return
      e.preventDefault()
      if (j >= 0) bring(j, 'focus')
      else latest.current.above?.()
    }

    b.addEventListener('scroll', scrolled, { passive: true })
    host.addEventListener('focusin', focusIn)
    host.addEventListener('focusout', focusOut)
    host.addEventListener('keydown', onKey)
    resized.observe(b)
    sync()
    return () => {
      b.removeEventListener('scroll', scrolled)
      host.removeEventListener('focusin', focusIn)
      host.removeEventListener('focusout', focusOut)
      host.removeEventListener('keydown', onKey)
      resized.disconnect()
      rows.disconnect()
      rowsObserver.current = null
      watched.current = new Map()
      el.current = null
      box.current = null
    }
  }, [host, note, sync, bring])

  // after every render: measure the rows that were just rendered, and let go of the ones gone
  useLayoutEffect(() => {
    latest.current = { keys, hs, start: span.start, before: span.before, above, view }
    // a jump: none of the rows rendered now was rendered before — have the browser pick again what
    // to keep in place while rows come in above (see the top of the file)
    const was = shown.current
    shown.current = { start: span.start, end: span.end }
    const b = box.current
    // (the rows first: reading `scrollTop` right after a render lays the page out, so only on a jump)
    if (b && span.end > span.start && (span.start >= was.end || span.end <= was.start) && b.scrollTop > 0) {
      const t = b.scrollTop
      b.scrollTop = t - 1
      b.scrollTop = t
    }
    const rows = rowsObserver.current
    if (rows && el.current) {
      const now = new Map<Element, string>()
      const children = el.current.children
      for (let k = 0; k < children.length && span.start + k < keys.length; k++) {
        now.set(children[k], keys[span.start + k])
        if (!watched.current.has(children[k])) rows.observe(children[k])
      }
      for (const c of watched.current.keys()) if (!now.has(c)) rows.unobserve(c)
      watched.current = now
    }
    // the log is capped, so rows keep leaving it; what was measured of them goes now and then
    if (heights.current.size > keys.length * 2 + 64) {
      const live = new Set(keys)
      for (const k of [...heights.current.keys()]) if (!live.has(k)) note(k, null)
    }
    const host = el.current
    const p = pending.current
    if (p && host) {
      // the render the scroll asked for: the row is there, and `nearest` can use its real height
      pending.current = null
      const i = keys.indexOf(p.key)
      const row = i >= span.start ? host.children[i - span.start] : undefined
      if (row) settle(row, p.then)
    }
    const f = focused.current
    if (f !== null && host) {
      const i = keys.indexOf(f)
      const row = i >= span.start && i < span.end ? host.children[i - span.start] : undefined
      const active = document.activeElement
      if (i < 0) focused.current = null // the row has left the list: nothing to hold the focus for
      else if (!row && (active === null || active === document.body)) {
        // scrolled out of the window, and the focus went with it: the list holds it, unscrolled
        host.tabIndex = -1
        host.focus({ preventScroll: true })
      } else if (row && active === host) mainOf(row)?.focus({ preventScroll: true })
    }
  })

  const reveal = useCallback((key: string): void => bring(latest.current.keys.indexOf(key), 'show'), [bring])
  const focusRow = useCallback((i: number): void => bring(i, 'focus'), [bring])

  return { ref: setHost, ...span, reveal, focusRow }
}
