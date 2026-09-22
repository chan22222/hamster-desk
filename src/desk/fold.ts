// Switching the studio off and on (`prefs.folded`: the settings row and Ctrl+`) is a story
// rather than a cut. Off is a nuclear blast that levels the island and wipes out every hamster
// in the room (blast.ts); on is a construction site that raises the place again, hard hats and
// all (build.ts). This module is the clock behind both: which of the two is playing and since
// when, and the timelines each one reads its numbers off — with no three and no DOM, so the unit
// test can play both through in a millisecond.
//
// It is all pantomime, like the throw and the boss's rounds: the store never hears of it. The one
// piece of state is the phase and its start time, and that lives beside the preference rather
// than in it (App.tsx, through useFold.ts): the studio has to stay mounted for the whole blast
// after `folded` has already flipped to true, and nothing about that is worth saving to disk.
import { H_OFFICE, OFFICE, T, tileToWorld } from './office-world'

/**
 * `open` and `closed` are the two resting states — the studio shown or folded away. `blast` is
 * shown and blowing up on its way to `closed`; `build` is shown and going up on its way to `open`.
 */
export type FoldPhase = 'open' | 'blast' | 'build' | 'closed'

export interface FoldFx {
  phase: FoldPhase
  /** when the phase began, on the caller's clock (ms) */
  since: number
}

/** how long each story runs, seconds */
export const BLAST_S = 4.2
export const BUILD_S = 4.8

/** The resting state for a preference: what the studio shows when nothing is playing. */
export const foldAt = (folded: boolean, now = 0): FoldFx => ({ phase: folded ? 'closed' : 'open', since: now })

/**
 * The preference flipped. Off starts the blast from whatever was showing (an unfinished build
 * included); on starts the build, cutting an unfinished blast short. Flipping to the state the
 * studio is already in, or already heading for, changes nothing — a double flip in a row is one
 * story, not two. With reduced motion the studio just cuts to the resting state.
 */
export function foldFlip(fx: FoldFx, folded: boolean, now: number, reduced = false): FoldFx {
  if (reduced) return foldAt(folded, now)
  if (folded) return fx.phase === 'blast' || fx.phase === 'closed' ? fx : { phase: 'blast', since: now }
  return fx.phase === 'build' || fx.phase === 'open' ? fx : { phase: 'build', since: now }
}

/** ms until the playing phase settles, or null in a resting phase. */
export function foldRemaining(fx: FoldFx, now: number): number | null {
  const total = fx.phase === 'blast' ? BLAST_S : fx.phase === 'build' ? BUILD_S : null
  return total === null ? null : Math.max(0, fx.since + total * 1000 - now)
}

/** The playing phase has run its course: the blast leaves the studio folded, the build leaves it up. */
export function foldSettle(fx: FoldFx, now: number): FoldFx {
  if (fx.phase === 'blast') return { phase: 'closed', since: now }
  if (fx.phase === 'build') return { phase: 'open', since: now }
  return fx
}

/** whether the studio is on screen at all in this phase */
export const foldShown = (fx: FoldFx): boolean => fx.phase !== 'closed'

/** whether one of the two stories is playing */
export const foldPlaying = (fx: FoldFx): boolean => fx.phase === 'blast' || fx.phase === 'build'

/** seconds into the current phase */
export const foldAge = (fx: FoldFx, now: number): number => Math.max(0, (now - fx.since) / 1000)

// ---- easing ---------------------------------------------------------------------------------
const clamp01 = (k: number): number => (k < 0 ? 0 : k > 1 ? 1 : k)
export const easeOut = (k: number): number => 1 - (1 - clamp01(k)) ** 3
export const easeIn = (k: number): number => clamp01(k) ** 2
export const easeInOut = (k: number): number => {
  const x = clamp01(k)
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
}
/** overshoot: how far past 1 a slammed-down piece bounces before it settles (easeOutBack's c1) */
const BACK = 1.1
/** Penner's easeOutBack: reaches 1 a little early, overshoots by about 8 % and comes back to land on 1 exactly. */
export function easeOutBack(k: number): number {
  const x = clamp01(k) - 1
  return 1 + (BACK + 1) * x * x * x + BACK * x * x
}

// ---- where it all happens -------------------------------------------------------------------
/** ground zero, and the point the construction grows out from: the middle of the office deck */
export const CENTRE = { ...tileToWorld((OFFICE.W - 1) / 2, (OFFICE.D - 1) / 2), y: H_OFFICE }

// ---- the blast ------------------------------------------------------------------------------
export const BLAST = {
  /** the flash is full white this soon and fades on this time constant */
  FLASH_IN: 0.06,
  FLASH_TAU: 0.28,
  /** the shockwave leaves ground zero a beat after the flash, this many world units a second */
  RING_AT: 0.12,
  RING_SPEED: 1100,
  /** and has faded out this long after it left */
  RING_LIFE: 2.0,
  /** how far behind the ring's front the ground opens and everything on it drops away */
  SINK_LAG: 60,
  /** the width of that front, world units, with this much per-tile raggedness */
  SINK_FRONT: 160,
  SINK_JITTER: 90,
  /** the camera starts shaking when the wave reaches it, and settles on this time constant */
  SHAKE_AT: 0.16,
  SHAKE_TAU: 0.75,
  /** shake amplitude as a share of the camera's distance, so it is the same size on screen at any zoom */
  SHAKE: 0.05,
  /** the fireball: how fast it grows, how big, and when it is gone */
  BALL_GROW: 1.1,
  BALL_R: 260,
  BALL_HOLD: 0.6,
  BALL_GONE: 1.6,
  /** the mushroom cloud starts a beat in, takes this long to stand full height, and thins out at the end */
  CLOUD_AT: 0.25,
  CLOUD_RISE: 1.6,
  CLOUD_H: 400,
  CLOUD_R0: 70,
  CLOUD_R1: 230,
  CLOUD_FADE_AT: 2.3,
  CLOUD_FADE: 1.2,
  /**
   * a hamster the wave has reached: flung up into the sky (a touch outward, so a crowd fans out),
   * still climbing when it is gone — sideways it left the frame before anyone saw it go
   */
  DOOM_OUT: 60,
  DOOM_UP: 1100,
  DOOM_G: 140,
  DOOM_S: 1.0,
  DOOM_SPIN: 14,
  /** the view cuts over to ground zero with the whole island in frame, under the flash, over this long */
  CAM_S: 0.7,
} as const

/**
 * The white-out over the whole studio: full from the very first frame (a flash has no fade-in,
 * and the first frame's clock can read 0), held for `FLASH_IN`, gone in about a second.
 */
export function flashAlpha(t: number): number {
  if (t < 0) return 0
  if (t <= BLAST.FLASH_IN) return 1
  const a = Math.exp(-(t - BLAST.FLASH_IN) / BLAST.FLASH_TAU)
  return a < 0.01 ? 0 : a
}

/** the shockwave's radius from ground zero at `t` (0 before it leaves) */
export const shockRadius = (t: number): number => Math.max(0, (t - BLAST.RING_AT) * BLAST.RING_SPEED)

/** how visible the ring drawn at that radius is */
export const ringAlpha = (t: number): number => (t < BLAST.RING_AT ? 0 : 1 - clamp01((t - BLAST.RING_AT) / BLAST.RING_LIFE))

/**
 * The camera's tremor, as an offset in world units for a camera `dist` from what it looks at.
 * Three incommensurate sines rather than dice, so a capture of a given frame is repeatable.
 */
export function shakeOffset(t: number, dist: number): { x: number; y: number; z: number } {
  if (t < BLAST.SHAKE_AT) return { x: 0, y: 0, z: 0 }
  const u = t - BLAST.SHAKE_AT
  const amp = BLAST.SHAKE * dist * Math.min(1, u / 0.12) * Math.exp(-u / BLAST.SHAKE_TAU)
  return { x: amp * Math.sin(t * 57), y: amp * 0.7 * Math.sin(t * 71 + 1), z: amp * Math.sin(t * 63 + 2) }
}

/** The fireball at ground zero: its radius, how solid it still is, and how far from white to ember it has cooled (0..1). */
export function fireball(t: number): { r: number; alpha: number; heat: number } {
  const r = 30 + (BLAST.BALL_R - 30) * easeOut(t / BLAST.BALL_GROW)
  const alpha = t < BLAST.BALL_HOLD ? 1 : 1 - clamp01((t - BLAST.BALL_HOLD) / (BLAST.BALL_GONE - BLAST.BALL_HOLD))
  return { r, alpha, heat: clamp01(t / BLAST.BALL_GONE) }
}

/**
 * The mushroom cloud: how tall the stem stands, how wide the cap has rolled out, how much of it is
 * still there (`body`, 1 → 0 as it thins away), and how far it has gone from fire to smoke (`smoke`).
 */
export function mushroom(t: number): { stem: number; cap: number; body: number; smoke: number } {
  const u = easeOut((t - BLAST.CLOUD_AT) / BLAST.CLOUD_RISE)
  return {
    stem: BLAST.CLOUD_H * u,
    cap: BLAST.CLOUD_R0 + (BLAST.CLOUD_R1 - BLAST.CLOUD_R0) * u,
    body: t < BLAST.CLOUD_AT ? 0 : 1 - clamp01((t - BLAST.CLOUD_FADE_AT) / BLAST.CLOUD_FADE),
    smoke: clamp01((t - BLAST.CLOUD_AT) / 1.5),
  }
}

/** A hamster `age` seconds after the wave reached it: how far out and up it has been thrown, what is left of it, and its tumble. */
export function doomAt(age: number): { out: number; up: number; scale: number; spin: number } {
  const a = Math.max(0, age)
  return {
    out: BLAST.DOOM_OUT * a,
    up: Math.max(0, BLAST.DOOM_UP * a - BLAST.DOOM_G * a * a),
    scale: 1 - clamp01(a / BLAST.DOOM_S),
    spin: BLAST.DOOM_SPIN * a,
  }
}

// ---- the construction -----------------------------------------------------------------------
export const BUILD = {
  /** the site grows out from the middle: each tile of distance is this much later */
  PER_TILE: 0.085,
  /** and the top of the tallest thing (this high above the deck) comes this much after its foot */
  LAG_H: 150,
  LAG: 0.45,
  /** per-tile raggedness, so the tiles slam down one by one rather than as a wave */
  JITTER: 0.2,
  /** how long one piece takes to rise, and how far below its place it starts */
  RISE: 0.55,
  DROP: 260,
  /** a hamster drops onto its tile this much after the floor is there, and takes this long to fall from this high */
  LAND_AFTER: 0.25,
  FALL_S: 0.45,
  FALL_H: 420,
  /** the hard hats come off and everybody sits down at this second; the phase runs on while the dust settles */
  HAMMER_END: 4.0,
  /** the site is watched from the story's view (ground zero, whole island); the camera eases home over this window */
  CAM_AT: 2.6,
  CAM_S: 1.4,
} as const

/** the pane shrinks away over the blast's last half second, and grows in over the build's first (App.tsx, styles.css `.is-story`) */
export const PANE_S = 0.5

/** the uniform values that mean "nothing playing": the shader adds exactly nothing for them */
export const BUILD_REST = 1e4
export const BLAST_REST = -1e5

/**
 * Per-tile raggedness, 0..1. Integer arithmetic on the tile index, so the shader (vox/material.ts
 * `VX_FOLD_GLSL`) gets bit-for-bit the same number and the dust lands when the tile does.
 */
export const tileJitter = (tx: number, ty: number): number => ((((tx * 7 + ty * 13) % 17) + 17) % 17) / 17

/** seconds into the build before the point (x, y, z) starts to rise */
export function buildDelay(x: number, y: number, z: number): number {
  const d = Math.hypot(x - CENTRE.x, z - CENTRE.z) / T
  const lag = Math.min(BUILD.LAG_H, Math.max(0, y)) / BUILD.LAG_H
  return d * BUILD.PER_TILE + lag * BUILD.LAG + tileJitter(Math.floor(x / T), Math.floor(z / T)) * BUILD.JITTER
}

/** when the floor of the tile at (x, z), whose top is at `h`, is in place (its overshoot has landed) */
export const landTime = (x: number, z: number, h: number): number => buildDelay(x, h, z) + BUILD.RISE

/**
 * How far below its place a point of the world sits, for `build` seconds into a construction
 * and a shockwave `blast` units out from ground zero (`BUILD_REST` / `BLAST_REST` when neither is
 * on). Negative while a rising piece overshoots. The vertex shader computes exactly this for every
 * voxel; this copy moves the handful of things that are not in the chunk geometry (the desks' lit
 * parts, the wall prints) and times the dust.
 */
export function foldLift(x: number, y: number, z: number, build: number, blast: number): number {
  const k = clamp01((build - buildDelay(x, y, z)) / BUILD.RISE)
  let lift = (1 - easeOutBack(k)) * BUILD.DROP
  const jit = tileJitter(Math.floor(x / T), Math.floor(z / T))
  const d = Math.hypot(x - CENTRE.x, z - CENTRE.z)
  const s = clamp01((blast - d - BLAST.SINK_LAG - jit * BLAST.SINK_JITTER) / BLAST.SINK_FRONT)
  lift += s * s * BUILD.DROP
  return lift
}

/**
 * A hamster on the site: how high above its tile it is (falling in from the sky until the floor
 * has landed), whether it has landed yet, and whether it is still at work. `land` is the tile's
 * `landTime`.
 */
export function builder(t: number, land: number): { height: number; landed: boolean; working: boolean; here: boolean } {
  const left = land + BUILD.LAND_AFTER - t // seconds until it hits the ground
  const u = clamp01(1 - left / BUILD.FALL_S)
  return { height: left <= 0 ? 0 : (1 - easeIn(u)) * BUILD.FALL_H, landed: left <= 0, working: t < BUILD.HAMMER_END, here: left <= BUILD.FALL_S }
}

/**
 * How much of the story's own view the camera shows: 0 = the studio's camera as it is, 1 = ground
 * zero in the middle, a little wider (`storyBounds`, `storyScale`). The blast moves over under the
 * flash and stays there; the build starts there and eases home before the hats come off.
 * Transient: the camera state never changes, so the view after a story is the view before it.
 *
 * `from` is where the view already was when this story began — what the story it cut short was
 * showing — so a switch flicked back and forth carries the view on from wherever it is instead
 * of snapping to the start of each story's curve. Left out, a blast starts from the studio's own
 * view and a build (a fresh mount) from the story's.
 */
export function storyMix(phase: FoldPhase, t: number, from = phase === 'build' ? 1 : 0): number {
  if (phase === 'blast') return from + (1 - from) * easeInOut(t / BLAST.CAM_S)
  if (phase === 'build') return from * (1 - easeInOut((t - BUILD.CAM_AT) / BUILD.CAM_S))
  return 0
}

export interface PlanBounds { minX: number; maxX: number; minZ: number; maxZ: number }

/** tiles of sea the story's frame shows around the deck */
export const STORY_MARGIN = 1
/**
 * The story's zoom is the studio's own, pulled out by `STORY_ZOOM_OUT` — a little wider than the
 * view the user had, ground zero in the middle — but never closer than `STORY_MAX_SCALE` (the
 * cloud has to fit) and never farther than `STORY_CLOSE` × the deck fit (the pane is wide and
 * short, so a plain fit is ruled by the deck's depth and leaves the office the size of a coin).
 * `STORY_DROP` puts ground zero that share of the pane below the middle: room for the cloud above.
 */
export const STORY_ZOOM_OUT = 0.5
export const STORY_MAX_SCALE = 1.1
export const STORY_CLOSE = 1.6
export const STORY_DROP = 0.15

/** the story's zoom for a studio that was at `scale`, given the deck fit `fit` (see above) */
export const storyScale = (scale: number, fit: number): number => Math.min(STORY_MAX_SCALE, Math.max(fit * STORY_CLOSE, scale * STORY_ZOOM_OUT))

/**
 * The story's frame: the office deck with a little sea around it, ground zero in the middle. Not
 * the whole island — the wave and the cloud both play out over the deck, and the wave leaving
 * the frame for the sea is the point.
 */
export function storyBounds(): PlanBounds {
  const a = tileToWorld(-STORY_MARGIN, -STORY_MARGIN)
  const b = tileToWorld(OFFICE.W - 1 + STORY_MARGIN, OFFICE.D - 1 + STORY_MARGIN)
  return { minX: Math.min(a.x, b.x) - T / 2, maxX: Math.max(a.x, b.x) + T / 2, minZ: Math.min(a.z, b.z) - T / 2, maxZ: Math.max(a.z, b.z) + T / 2 }
}

export interface ViewPoint { tx: number; tz: number; scale: number }

/** `k` of the way from one view to another: straight across the ground, and between the zooms on a log scale so the move reads even. */
export function blendView(from: ViewPoint, to: ViewPoint, k: number): ViewPoint {
  const u = clamp01(k)
  return { tx: from.tx + (to.tx - from.tx) * u, tz: from.tz + (to.tz - from.tz) * u, scale: from.scale * (to.scale / from.scale) ** u }
}

/** Whether the pane should be at zero size now: the blast's last `PANE_S`, and while closed. The build grows it from its first frame. */
export function paneShut(phase: FoldPhase, t: number): boolean {
  if (phase === 'closed') return true
  if (phase === 'blast') return t >= BLAST_S - PANE_S
  return false
}
