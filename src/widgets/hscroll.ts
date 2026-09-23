// A one-line strip that can hold more than fits: the tabs in the top bar, the session bar. Their
// scrollbars are hidden (a 10px bar under a 36px tab row would be most of the row), which used to
// leave no sign at all that anything was past the edge — `/compact`, `/clear` and `지난 대화` simply
// were not there in a narrow column. So:
//   - a vertical wheel scrolls the strip sideways (nothing else here scrolls vertically), and
//   - `data-fade-l` / `data-fade-r` are set while there is more that way, for styles.css to fade
//     that end out.
// Data attributes rather than classes: React rewrites `className` whenever its string changes (the
// session bar's `is-waiting`) and would wipe classes set from here; it leaves these alone.

import { useEffect, type RefObject } from 'react'

export function useHScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (): void => {
      const rest = el.scrollWidth - el.clientWidth - el.scrollLeft
      if (el.scrollLeft > 1) el.dataset.fadeL = ''
      else delete el.dataset.fadeL
      if (rest > 1) el.dataset.fadeR = ''
      else delete el.dataset.fadeR
    }
    const onWheel = (e: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth) return
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (!d) return
      el.scrollLeft += d
      e.preventDefault()
    }
    // the strip's own size changes with the window; its content's with every tab, label and chip
    const ro = new ResizeObserver(update)
    const watch = (): void => {
      ro.disconnect()
      ro.observe(el)
      for (const c of el.children) ro.observe(c)
      update()
    }
    const mo = new MutationObserver(watch)
    watch()
    mo.observe(el, { childList: true })
    el.addEventListener('scroll', update, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      mo.disconnect()
      el.removeEventListener('scroll', update)
      el.removeEventListener('wheel', onWheel)
    }
  }, [ref])
}

/** Scroll `box` sideways just enough that `el` is in it, clear of the fades at either end. */
export function revealIn(box: HTMLElement, el: Element | null, margin = 24): void {
  if (!el) return
  const b = box.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  if (r.left < b.left + margin) box.scrollLeft -= b.left + margin - r.left
  else if (r.right > b.right - margin) box.scrollLeft += r.right - (b.right - margin)
}
