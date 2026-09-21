// Window placement: restore the last bounds, remember new ones, and the mini-mode resize.
// Stub: the real implementation lands with the window work — see the plan, §3.3 and §3.10. Owner: A.

import type { BrowserWindow } from 'electron'
import type { WindowState } from '../shared/events'

/** The stored window placement, once it has been checked against the screens that exist now. */
export function readWindowState(): WindowState | null {
  return null
}

/** Enter (or leave) mini mode; returns the state the window actually ended up in. */
export function setMini(_win: BrowserWindow | null, _on: boolean): boolean {
  return false
}

/** Start remembering this window's size and position (debounced, skipped while mini). */
export function attachWindowStateSaver(_win: BrowserWindow): void {
  /* stub */
}
