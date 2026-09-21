// Window placement: restore the last bounds, remember new ones, and the mini-mode resize.
// Plan §3.3 (tab/window restore) and §3.10 (mini mode). Owner: A.
//
// The stored placement lives in ~/.hamster-desk/ui.json under `window`, beside the renderer's own
// settings — not in the Electron profile, which this app splits per run mode (electron/main.ts).
//
// `fitBounds` and `miniPlacement` are pure and exported for scripts/unit/window-state.test.ts, so
// `electron` is required lazily: a plain node test can import this file without an Electron runtime.

import type { BrowserWindow, Rectangle } from 'electron'
import type { WindowState } from '../shared/events'
import { loadUi, saveUi } from './ui-store'

/** the normal window's floor, mirrored from `createWindow` */
export const MIN_SIZE = { width: 760, height: 480 }
/** mini mode: the window size, and the floor it needs before it can get there */
export const MINI_SIZE = { width: 480, height: 360 }
export const MINI_MIN_SIZE = { width: 320, height: 220 }
/** gap between the mini window and the corner of the work area */
export const MINI_MARGIN = 12

/** a saved placement is only worth restoring if this much of it lands on a screen that exists */
const MIN_VISIBLE = { width: 100, height: 100 }

const capture = (): boolean => !!process.env.HAMSTER_CAPTURE
const tag = (line: string): void => {
  if (capture()) console.log(line)
}

/** `electron`'s screen module, or null when this file is imported outside an Electron runtime. */
function screenModule(): typeof import('electron').screen | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('electron') as Partial<typeof import('electron')>
    return mod.screen ?? null
  } catch {
    return null
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** How much of `a` and `b` overlap. */
function overlap(a: Rectangle, b: Rectangle): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  }
}

/**
 * Turn whatever `ui.json` holds under `window` into a placement worth using, or `null` for
 * "just open at the default size".
 *
 * Rejected, rather than patched up:
 *  - anything that is not four finite numbers (a hand-edited or half-written file),
 *  - a size below the window's own minimum — it could never have come from this app, and forcing
 *    the minimum back on it would put the window somewhere the user never left it,
 *  - a rectangle that no longer meets a screen (the laptop left its docking station): less than
 *    100×100 visible means the title bar is out of reach.
 */
export function fitBounds(saved: unknown, workArea: Rectangle): WindowState | null {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null
  const s = saved as Record<string, unknown>
  const x = num(s.x)
  const y = num(s.y)
  const width = num(s.width)
  const height = num(s.height)
  if (x === null || y === null || width === null || height === null) return null
  if (width < MIN_SIZE.width || height < MIN_SIZE.height) return null
  const vis = overlap({ x, y, width, height }, workArea)
  if (vis.width < MIN_VISIBLE.width || vis.height < MIN_VISIBLE.height) return null
  return { x, y, width, height, maximized: s.maximized === true }
}

/** Where the mini window sits: the bottom-right corner of the work area, `MINI_MARGIN` clear of it. */
export function miniPlacement(workArea: Rectangle, size = MINI_SIZE, margin = MINI_MARGIN): { x: number; y: number } {
  return {
    x: Math.round(workArea.x + workArea.width - size.width - margin),
    y: Math.round(workArea.y + workArea.height - size.height - margin),
  }
}

/** The stored window placement, once it has been checked against the screens that exist now. */
export function readWindowState(): WindowState | null {
  const saved = loadUi().window
  if (!saved || typeof saved !== 'object') return null
  const s = saved as Record<string, unknown>
  const probe: Rectangle = {
    x: num(s.x) ?? 0,
    y: num(s.y) ?? 0,
    width: num(s.width) ?? MIN_SIZE.width,
    height: num(s.height) ?? MIN_SIZE.height,
  }
  const screen = screenModule()
  if (!screen) return null
  let workArea: Rectangle
  try {
    workArea = screen.getDisplayMatching(probe).workArea
  } catch {
    return null
  }
  const fitted = fitBounds(saved, workArea)
  // field order matches `currentState`, so an untouched window compares equal and is not re-saved
  if (fitted) lastWritten = JSON.stringify(fitted)
  if (fitted) tag(`[bounds] restored ${fitted.width}x${fitted.height}@${fitted.x},${fitted.y}${fitted.maximized ? ' maximized' : ''}`)
  else tag('[bounds] default')
  return fitted
}

// ---- remembering where the window is ------------------------------------------------------

const SAVE_DEBOUNCE_MS = 500

let miniActive = false
/** what the window looked like before mini mode took it over */
let preMini: { bounds: Rectangle; maximized: boolean; onTop: boolean } | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** the placement that is already in ui.json, as JSON — writing the same thing again is skipped */
let lastWritten: string | null = null

/** `saveUi({ window })`, unless that is exactly what the file already holds. */
function writeState(state: WindowState): void {
  const key = JSON.stringify(state)
  if (key === lastWritten) return
  lastWritten = key
  saveUi({ window: state })
}

/** Mini mode is on, so `win:alwaysOnTop(false)` from the renderer must not un-pin the window. */
export const isMini = (): boolean => miniActive

/** A capture run drives the window itself; letting it write would trash the real placement. */
const savingOff = (): boolean => capture()

function currentState(win: BrowserWindow): WindowState {
  // getNormalBounds is the un-maximized rectangle, which is the one worth restoring to
  const b = win.getNormalBounds()
  return { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() }
}

function saveNow(win: BrowserWindow): void {
  if (savingOff() || miniActive) return
  if (win.isDestroyed() || win.isMinimized()) return
  writeState(currentState(win))
}

/** Start remembering this window's size and position (debounced, skipped while mini). */
export function attachWindowStateSaver(win: BrowserWindow): void {
  const schedule = (): void => {
    if (savingOff() || miniActive) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      saveNow(win)
    }, SAVE_DEBOUNCE_MS)
  }
  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  // Closing with the X button destroys the window *before* main's shutdown() runs, and by then
  // there is nothing left to measure — `close` is the last moment the bounds can still be read.
  win.on('close', () => persistWindowState(win))
  win.on('closed', () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
  })
}

/**
 * Write the placement out now, on the way to quitting. While mini mode is on the window is a
 * 480×360 box in a corner, which is not what the user wants back next time — the bounds it had
 * before mini took over are.
 */
export function persistWindowState(win: BrowserWindow | null): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (savingOff() || !win || win.isDestroyed()) return
  if (miniActive) {
    if (preMini) {
      const b = preMini.bounds
      writeState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: preMini.maximized })
    }
    return
  }
  saveNow(win)
}

// ---- mini mode ----------------------------------------------------------------------------

/**
 * Enter (or leave) mini mode; returns the state the window actually ended up in.
 *
 * `setMinimumSize` has to go first: the window is created with a 760×480 floor and `setSize`
 * would silently clamp against it. On the way out the floor goes back up *before* the old bounds
 * are restored, for the same reason in reverse.
 *
 * Always-on-top is forced while mini is on; leaving does not put it back — the renderer's
 * `alwaysOnTop(mini || prefs.onTop)` effect re-sends the preference on the next frame.
 */
export function setMini(win: BrowserWindow | null, on: boolean): boolean {
  if (!win || win.isDestroyed()) return false
  if (on === miniActive) return miniActive
  if (on) {
    preMini = { bounds: win.getNormalBounds(), maximized: win.isMaximized(), onTop: win.isAlwaysOnTop() }
    if (saveTimer) {
      // a pending save would land *after* the shrink and store the mini box as the real placement
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (win.isMaximized()) win.unmaximize()
    const screen = screenModule()
    const workArea = screen ? screen.getDisplayMatching(win.getBounds()).workArea : null
    win.setMinimumSize(MINI_MIN_SIZE.width, MINI_MIN_SIZE.height)
    const spot = workArea ? miniPlacement(workArea) : null
    if (spot) win.setBounds({ ...spot, ...MINI_SIZE })
    else win.setSize(MINI_SIZE.width, MINI_SIZE.height)
    win.setAlwaysOnTop(true, 'floating')
    miniActive = true
    // the size the window really has now, not the one that was asked for: a floor that did not
    // move would show up here as 760x480
    const now = win.getBounds()
    tag(`[mini] on ${now.width}x${now.height} saved=${preMini.bounds.width}x${preMini.bounds.height}`)
    return true
  }
  miniActive = false
  win.setMinimumSize(MIN_SIZE.width, MIN_SIZE.height)
  const back = preMini
  preMini = null
  if (back) {
    win.setBounds(back.bounds)
    if (back.maximized) win.maximize()
    // the renderer re-sends `mini || prefs.onTop` right after this; putting back what was there
    // means a lost or reordered message cannot leave a full-size window pinned above everything
    win.setAlwaysOnTop(back.onTop, 'floating')
  }
  const now = win.getBounds()
  tag(`[mini] off ${now.width}x${now.height}`)
  return false
}
