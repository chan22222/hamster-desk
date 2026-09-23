// How often the studio draws, and how well. The scene is never quite still — the sea moves and
// everybody breathes — so it is drawn continuously. Motion the eye follows gets every frame the
// display has: somebody walking, a hamster in the hand or in the air, the camera easing, a story
// playing, and the user working the studio — dragging, zooming, pointing, pressing keys. 0.1.19
// held that motion to 60 on the belief that more frames are wasted on it; on a 165 Hz screen 60
// lands on every third vsync (about 55) and the blast read as lag next to the old loop that drew
// them all (docs/design-notes.md › 스튜디오를 그리는 속도). The savings are where nobody follows
// anything: the office at rest (60 — the sea and the breathing), and a studio nobody is looking at
// closely — the window behind another app, or the always-on-top mini window that almost never has
// the focus — which goes down to 30 and 20, and to a cheaper picture.
//
// Pure: the render loop hands in what it knows and gets back a rate and a quality tier, so the
// unit test can walk the whole table without a window (scripts/unit/pace.test.ts).

export type Quality = 'full' | 'saver'

export interface PaceInput {
  /** the window has the focus (`document.hasFocus()`) */
  focused: boolean
  /** the studio is in the always-on-top mini window */
  mini: boolean
  /** something on screen moved the way the eye follows, last frame */
  lively: boolean
  /** the user worked the studio within the last `INPUT_HOLD_MS` */
  input: boolean
}

/**
 * Frames a second for each case; `Infinity` is every frame the display shows. Motion and input are
 * uncapped on purpose: any cap under the display's own rate is what the eye reads as lag there.
 */
export const FPS = { input: Infinity, lively: Infinity, calm: 60, backLively: 30, backCalm: 20 } as const

/** how long a pointer move, a wheel step or a key keeps the full rate on after it */
export const INPUT_HOLD_MS = 700

/** The rate to draw at. Input always gets the display's full rate, even in the mini window, so a drag never stutters. */
export function frameRate(p: PaceInput): number {
  if (p.input) return FPS.input
  if (!p.focused || p.mini) return p.lively ? FPS.backLively : FPS.backCalm
  return p.lively ? FPS.lively : FPS.calm
}

/**
 * Whether a frame is due, `elapsed` ms after the last one drawn. The browser's frames come on the
 * display's clock, so a budget of exactly 1000/fps would miss every other vsync on a 60 Hz screen
 * by a hair of jitter; a few ms of slack lands 60 on every frame and 30 on every second one there,
 * and never more than the display's own rate. `Infinity` is always due: the display's own rate.
 */
export const JITTER_MS = 4
export const frameDue = (elapsed: number, fps: number): boolean => elapsed >= 1000 / fps - JITTER_MS

/**
 * The picture's tier: full while the main window has the focus, the saver behind other apps and in
 * the mini window. `unfocusedFor` is how long the window has been without the focus: switching
 * tiers reallocates the drawing buffer and the shadow map, so a quick alt-tab and back is not worth
 * it — the saver only comes on after `SAVER_AFTER_MS`, and full comes back at once.
 */
export const SAVER_AFTER_MS = 1500
export function qualityFor(p: { mini: boolean; unfocusedFor: number }): Quality {
  return p.mini || p.unfocusedFor >= SAVER_AFTER_MS ? 'saver' : 'full'
}

/**
 * What each tier costs. The device pixel ratio is the big lever — a 200 % display at 2 draws
 * four times the pixels of 1, for a picture whose voxels are chunky anyway; 1.5 keeps the edges
 * clean. Then the sun's shadow map, the per-voxel normal tilt (vox/material.ts `setVoxBump`: off
 * skips its branch in every voxel fragment) and the sea's vertex grid.
 */
export const QUALITY = {
  full: { dpr: 1.5, shadow: 2048, bump: 1, sea: 224 },
  saver: { dpr: 1, shadow: 1024, bump: 0, sea: 112 },
} as const

/** the pixel ratio a tier draws at on a display of ratio `device` — never above the display's own */
export const pixelRatio = (q: Quality, device: number): number => Math.min(device > 0 ? device : 1, QUALITY[q].dpr)
