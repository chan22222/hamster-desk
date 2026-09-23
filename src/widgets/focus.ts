// Keyboard plumbing for everything that opens over the page: the popovers (src/widgets/Popover.tsx),
// the menus inside them, the sidebar's file menu and the two modal dialogs (the account question,
// the update prompt). One set of rules, so a key does the same thing wherever the focus is:
//
//   - Tab stays inside whatever is open. A popover's panel is portalled to the end of <body>, so
//     Tab used to walk off its end into nothing and leave it open; behind a veil it walked into
//     the page the veil is covering.
//   - A list with role="menu" is one Tab stop, and ↑ ↓ Home End move inside it (WAI-ARIA's menu
//     pattern: a roving tabindex).
//   - Whatever took the focus gives it back when it closes.

import { useEffect, type RefObject } from 'react'

/** the part of a keyboard event these helpers read — a DOM event and a React one both have it */
interface KeyLike {
  key: string
  shiftKey: boolean
  target: EventTarget | null
  preventDefault(): void
}

const TABBABLE = 'button, [href], input, select, textarea, [tabindex]'
const MENU_ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'

/** On screen and usable: `display: none` leaves no boxes, and a disabled control takes no focus. */
function usable(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
}

/**
 * Where a key moves the focus in a row of `n` things wrapping at both ends (a menu, the tab strip),
 * from `i` (-1: from outside it). `axis` says which arrows count. Null: not a moving key.
 */
export function wrapStep(key: string, i: number, n: number, axis: 'v' | 'h' = 'v'): number | null {
  if (n <= 0) return null
  const next = axis === 'v' ? 'ArrowDown' : 'ArrowRight'
  const prev = axis === 'v' ? 'ArrowUp' : 'ArrowLeft'
  if (key === 'Home') return 0
  if (key === 'End') return n - 1
  if (key === next) return i < 0 ? 0 : (i + 1) % n
  if (key === prev) return i < 0 ? n - 1 : (i - 1 + n) % n
  return null
}

/**
 * The same in a list under a search box (recent projects, the file browser, past conversations):
 * it stops at the bottom, and ↑ off the first row is -1 — back up into the box.
 */
export function listStep(key: string, i: number, n: number): number | null {
  if (n <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return n - 1
  if (key === 'ArrowDown') return Math.min(n - 1, i + 1)
  if (key === 'ArrowUp') return Math.max(-1, i - 1)
  return null
}

/** Where Tab (or Shift+Tab) goes among `n` stops from `i` (-1: from none of them), going round. */
export function tabStep(shift: boolean, i: number, n: number): number {
  if (shift) return i <= 0 ? n - 1 : i - 1
  return i < 0 || i >= n - 1 ? 0 : i + 1
}

/** What Tab reaches inside `root`, in document order. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.tabIndex >= 0 && usable(el))
}

/** Tab and Shift+Tab wrap around inside `root` instead of leaving it. True when the key was Tab. */
export function trapTab(e: KeyLike, root: HTMLElement): boolean {
  if (e.key !== 'Tab') return false
  e.preventDefault()
  const list = tabbables(root)
  if (list.length === 0) return true
  list[tabStep(e.shiftKey, list.indexOf(document.activeElement as HTMLElement), list.length)].focus()
  return true
}

function menuItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(MENU_ITEM)].filter(usable)
}

/**
 * Give a menu its one Tab stop — `to`, else the checked item, else the first — and take it from
 * every other item. Returns the stop.
 */
export function rove(menu: HTMLElement, to?: HTMLElement): HTMLElement | null {
  const items = menuItems(menu)
  const stop = to ?? items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0] ?? null
  for (const el of menu.querySelectorAll<HTMLElement>(MENU_ITEM)) el.tabIndex = el === stop ? 0 : -1
  return stop
}

/**
 * The focus went to a menu item some other way (a click on a row that leaves the menu open, like
 * a delegation preset): the Tab stop goes with it, or Tab would start again from the old one.
 */
export function followFocus(target: EventTarget | null): void {
  if (!(target instanceof HTMLElement) || !target.matches(MENU_ITEM)) return
  const menu = target.closest<HTMLElement>('[role="menu"]')
  if (menu && target.tabIndex !== 0) rove(menu, target)
}

/** ↑ ↓ Home End inside a role="menu" list move to the neighbouring item, wrapping at the ends. True when it moved. */
export function arrowInMenu(e: KeyLike): boolean {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return false
  const from = e.target instanceof HTMLElement ? e.target : null
  const menu = from?.closest<HTMLElement>('[role="menu"]')
  if (!from || !menu) return false
  const items = menuItems(menu)
  const j = wrapStep(e.key, items.indexOf(from.closest<HTMLElement>(MENU_ITEM) as HTMLElement), items.length)
  if (j === null) return false
  e.preventDefault()
  rove(menu, items[j])?.focus()
  return true
}

/**
 * Open modals, newest last. Only the top one keeps Tab: the account question can open over the
 * update prompt, and two traps answering the same key would hand the focus back and forth.
 */
const traps: HTMLElement[] = []

/** true while `root` is the modal on top (a key meant for the one underneath is not its business) */
export function isTopTrap(root: HTMLElement | null): boolean {
  return !!root && traps[traps.length - 1] === root
}

/**
 * A modal's focus: it moves in when `on` turns true (unless something inside already has it — an
 * `autoFocus`), Tab cannot leave, and when `on` turns false or the modal goes away the focus
 * returns to where it was before — unless it has meanwhile been sent somewhere on purpose.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, on: boolean): void {
  useEffect(() => {
    const root = ref.current
    if (!on || !root) return
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    traps.push(root)
    if (!root.contains(document.activeElement)) tabbables(root)[0]?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (isTopTrap(root)) trapTab(e, root)
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      traps.splice(traps.indexOf(root), 1)
      const now = document.activeElement
      if (before?.isConnected && (!now || now === document.body || root.contains(now))) before.focus()
    }
  }, [on, ref])
}
