// The studio's size against the window (src/App.tsx). The saved size (`prefs.deskW` / `deskH`, what
// the splitter was dragged to) is a wish: what the studio gets on screen is what is left of the
// column once the terminal has its minimum. Without that the defaults alone (sidebar 248 + studio
// 520 + splitter) took the whole column of a 760px window, and a 900px studio beside a 480px
// sidebar did it at 1280px — the terminal was a 0px strip. Below a floor the studio gives way too.
// styles.css says the same numbers for the frame before the column has been measured again.
//
// No DOM, no store: the splitters and the render both ask here (scripts/unit/layout.test.ts).

/** the splitters' range and their double-click default, per direction */
export const STUDIO_H = { min: 220, max: 700, def: 420 }
export const STUDIO_W = { min: 320, max: 900, def: 520 }
/** what the terminal keeps across (studio beside it) and down (studio above it) */
export const TERM_MIN = { w: 360, h: 180 }
/** the least the studio is squeezed to when even the terminal's minimum does not leave it more */
export const STUDIO_FLOOR = { w: 200, h: 120 }
export const SPLITTER = 8

type Axis = 'w' | 'h'

/** How much of a column `col` px long the studio may take — Infinity while unmeasured (0). */
export function studioRoom(axis: Axis, col: number): number {
  return col > 0 ? col - SPLITTER - TERM_MIN[axis] : Infinity
}

/** The studio's size on screen: the saved one as far as the room allows, and never under the floor. */
export function studioSize(axis: Axis, saved: number, col: number): number {
  return Math.max(STUDIO_FLOOR[axis], Math.min(saved, studioRoom(axis, col)))
}

/** What a splitter drag may set: the usual range, cut down to the room (and the floor under that). */
export function dragRange(axis: Axis, col: number): { lo: number; hi: number } {
  const range = axis === 'w' ? STUDIO_W : STUDIO_H
  const hi = Math.max(STUDIO_FLOOR[axis], Math.min(range.max, studioRoom(axis, col)))
  return { lo: Math.min(range.min, hi), hi }
}
