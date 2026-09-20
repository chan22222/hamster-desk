// Props, in the reference game's grammar: `{ id: { fn(b, rnd), r, h, idle? } }` with the origin
// at the foot of the prop (y = 0) and +z as the front. The office pieces are new; the outdoor
// ones are ported box-for-box from the game's PROPS so the island reads like the same world.
//
// Scale: one floor tile is 64 units and a standing hamster is about 72 tall.
import { W1, L2, S3, type BoxSink } from './builder'

export interface PropDef {
  /** paint the prop into a sink; `rnd` is the world's deterministic PRNG */
  fn(b: BoxSink, rnd: () => number): void
  /** rough footprint radius, used for spacing when scattering */
  r: number
  /** rough height */
  h: number
  /** ambient breathing amplitude (ratio of height) applied when placed in the world */
  idle?: number
}

/** A box in some prop's local space — used to hand the desk's dynamic parts to the renderer. */
export interface LocalBox {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
}

// ---- desk geometry shared with DeskStudio ------------------------------------------------
// The hamster sits on the -z side and faces +z, so the monitor stands on the far (+z) edge with
// its screen turned back towards -z — i.e. a real monitor, with a picture on one face only. It is
// pushed left so it never hides the head from the default south-east camera; the keyboard, mug and
// light bar fill the rest of the top.
//
// The default camera is on the other side of the desk and sees the monitor's *back*, so the state
// colour has to reach it some other way: the light bar across the top of the bezel (visible from
// every angle, the way a real monitor's does) and the glow the screen spills on the desk top.
export const DESK_W = 120
export const DESK_D = 52
export const DESK_TOP = 40
/** monitor centre x — everything dynamic hangs off this */
const MON_X = -34
const MON_Z = 13

export const DESK_PARTS: { screen: LocalBox; keys: LocalBox; lamp: LocalBox; spill: LocalBox } = {
  // Inside the bezel (which spans MON_Z ± 1.8): the slab runs MON_Z − 2.0 … MON_Z + 1.2, so it
  // stands 0.2 proud on the hamster's side and is buried 0.6 on the camera's. No shared plane
  // either way, so nothing z-fights and the picture is on one face, like a real screen.
  screen: { x: MON_X, y: 62, z: MON_Z - 0.4, w: 44, h: 30, d: 3.2 },
  keys: { x: 2, y: 41.4, z: -13, w: 34, h: 2.5, d: 12 },
  // the status light bar across the top of the bezel: inside its 46 width, 0.4 proud front and
  // back, so the state colour reads from either side of the desk
  lamp: { x: MON_X, y: 79.4, z: MON_Z, w: 40, h: 2.4, d: 4.4 },
  spill: { x: MON_X, y: 40.6, z: -1, w: 54, h: 0.8, d: 24 },
}

// ---- the boss's desk: wider, two monitors, its own dynamic parts ---------------------------
// The lit (dynamic) monitor moves right to x -10 so the second, static one fits on its left; with
// the camera south-east of the room both stay clear of the head, which sits behind the desk at
// x 0. The keyboard is centred under the lit screen, in front of the chair.
export const BOSS_DESK_W = 160
const BMON_X = -10
const BMON2_X = -57

export const BOSS_DESK_PARTS: typeof DESK_PARTS = {
  screen: { x: BMON_X, y: 62, z: MON_Z - 0.4, w: 44, h: 30, d: 3.2 },
  keys: { x: 0, y: 41.4, z: -13, w: 34, h: 2.5, d: 12 },
  lamp: { x: BMON_X, y: 79.4, z: MON_Z, w: 40, h: 2.4, d: 4.4 },
  spill: { x: BMON_X, y: 40.6, z: -1, w: 54, h: 0.8, d: 24 },
}

const WOOD = 0xc79b61
const WOOD_D = 0xa87c48
const METAL = 0x455f5a
/** the boss's furniture is darker wood and dark leather */
const WALNUT = 0x8f6238
const WALNUT_D = 0x6e4826

/**
 * Monitor foot, neck and bezel — the lit slab and the light bar are dynamic parts. The top trim is
 * 36 wide so no face of it lands on a plane of the 40-wide light bar that sits over it.
 */
function monitor(b: BoxSink, x: number, z: number, lit: boolean): void {
  b.box(x, 42, z, 26, 4, 14, 0x3b4550, S3)
  b.box(x, 50, z, 7, 16, 6, 0x49535e, S3)
  b.box(x, 62, z, 46, 32, 3.6, 0x2a323b)
  b.box(x, 78.4, z, 36, 1.6, 4, 0x3b4550)
  // A static monitor still needs a face, or it reads as a slab of bezel: a dim, sleeping screen,
  // set in the bezel exactly like the lit one so it too shows on the hamster's side only.
  if (!lit) b.box(x, 62, z - 0.4, 44, 30, 3.2, 0x1c2a2e)
}

export const PROPS: Record<string, PropDef> = {
  // ---- office -----------------------------------------------------------------------------
  bossDesk: {
    r: 82, h: 80,
    fn(b) {
      b.box(0, 37, 0, BOSS_DESK_W, 6, DESK_D, WALNUT, W1) // top, y 34..40
      b.box(0, 40.6, 0, BOSS_DESK_W - 8, 1.2, DESK_D - 8, 0xa87c48, W1) // inlay
      b.box(0, 22, 24, BOSS_DESK_W - 8, 24, 4, WALNUT_D, W1) // modesty panel (+z, faces the room)
      for (const sx of [-1, 1]) b.box(sx * 76, 17, 0, 6, 34, DESK_D - 4, WALNUT_D, W1) // side panels
      b.box(0, 12, 0, BOSS_DESK_W - 20, 3, 22, WALNUT_D, W1) // shelf under the top
      b.box(-60, 26, -6, 24, 16, 30, WALNUT_D, W1) // drawer pedestal on the left
      b.box(-60, 30, 9.4, 8, 1.6, 1.6, 0xe8c86a, { shade: 1.3 }) // drawer handle
      monitor(b, BMON_X, MON_Z, true)
      monitor(b, BMON2_X, MON_Z, false)
      // desk lamp on the right: base, stem, arm, shade with a warm underside
      b.box(62, 41.2, 8, 12, 2.4, 12, 0x3b4550, S3)
      b.box(62, 53, 8, 3, 22, 3, 0x49535e, S3)
      b.box(58, 63.6, 8, 12, 2.4, 3, 0x49535e, S3)
      b.box(52, 65.6, 8, 16, 7, 12, 0xe8c86a, { shade: 1.15 })
      b.box(52, 62.4, 8, 12, 0.8, 8, 0xfff1c0, { shade: 1.5 })
      b.box(48, 44, -4, 11, 8, 11, 0x2f6da8) // the boss's mug
      b.box(55.4, 44, -4, 3.4, 5, 3.4, 0x2f6da8)
      b.box(28, 41.2, 8, 24, 2.4, 17, 0xf2ece0, W1) // paper stack
      b.box(28, 42.6, 8, 20, 0.8, 13, 0xe2d9c6, W1)
      b.box(-70, 45, -8, 7, 10, 7, METAL, S3) // pen holder
      b.box(-71, 51.4, -9, 1.6, 6, 1.6, 0xd8434e)
      b.box(-68.6, 51.8, -7, 1.6, 6, 1.6, 0x4c8fd6)
    },
  },
  bossChair: {
    r: 17, h: 66,
    fn(b) {
      b.box(0, 15, 0, 30, 6, 30, 0x3b3a44) // seat, top at y 18
      b.box(0, 38, -15.5, 30, 40, 5, 0x3b3a44) // tall back, on the -z side (behind the hamster)
      b.box(0, 61.6, -15.5, 20, 8, 5.4, 0x4a4954) // headrest, sunk 0.4 into the back
      b.box(0, 18.6, -13.6, 26, 2, 2.4, 0x4a4954) // back trim
      for (const sx of [-1, 1]) {
        b.box(sx * 16.4, 26, -2, 4, 3, 20, 0x4a4954) // armrests
        b.box(sx * 16.4, 21.6, -2, 3, 6, 3, METAL, S3)
      }
      b.box(0, 12.4, 0, 22, 2, 22, METAL, S3) // under-seat plate
      b.box(0, 6, 0, 6, 12, 6, METAL, S3) // column
      // cross-shaped base: the z bars sit 0.2 higher so the two never share a top face where they cross
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) b.box(sx * 9, sz ? 1.8 : 1.6, sz * 9, sx ? 16 : 4, 3.2, sz ? 16 : 4, METAL, S3)
    },
  },
  bossRug: {
    r: 90, h: 2,
    fn(b) {
      b.box(0, 0.6, 0, 180, 1.2, 130, 0x8a5a4a)
      b.box(0, 1.0, 0, 188, 1.2, 118, 0x6e4a3e)
      b.box(0, 1.4, 0, 160, 1.2, 98, 0x9a6a58)
    },
  },
  desk: {
    r: 62, h: 80,
    fn(b) {
      b.box(0, 37, 0, DESK_W, 6, DESK_D, WOOD, W1) // top, y 34..40
      b.box(0, 40.6, 0, DESK_W - 8, 1.2, DESK_D - 8, 0xd8b088, W1) // lighter inlay
      b.box(0, 22, 24, DESK_W - 8, 24, 4, WOOD_D, W1) // modesty panel (+z, faces the room)
      for (const sx of [-1, 1]) b.box(sx * 56, 17, 0, 6, 34, DESK_D - 4, WOOD_D, W1) // side panels
      b.box(0, 12, 0, DESK_W - 20, 3, 22, 0xb98e57, W1) // shelf under the top
      // monitor: foot, neck, bezel. The lit slab itself is a dynamic part (DESK_PARTS.screen).
      b.box(MON_X, 42, MON_Z, 26, 4, 14, 0x3b4550, S3)
      b.box(MON_X, 50, MON_Z, 7, 16, 6, 0x49535e, S3)
      b.box(MON_X, 62, MON_Z, 46, 32, 3.6, 0x2a323b)
      b.box(MON_X, 78.4, MON_Z, 40, 1.6, 4, 0x3b4550) // top edge
      b.box(38, 44, -4, 11, 8, 11, 0xffd166) // mug
      b.box(45.4, 44, -4, 3.4, 5, 3.4, 0xffd166) // handle
      b.box(24, 41.2, 8, 24, 2.4, 17, 0xf2ece0, W1) // paper stack
      b.box(24, 42.6, 8, 20, 0.8, 13, 0xe2d9c6, W1)
    },
  },
  chair: {
    r: 15, h: 42,
    fn(b) {
      b.box(0, 15, 0, 26, 6, 26, 0x5c7a72) // seat, top at y 18
      b.box(0, 30, -13.5, 26, 24, 5, 0x5c7a72) // back, on the -z side (behind the hamster)
      b.box(0, 18.6, -11.6, 22, 2, 2.4, 0x6d8b82) // back trim
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 9, 6, sz * 9, 4, 12, 4, METAL, S3)
      b.box(0, 12.4, 0, 22, 2, 22, METAL, S3) // under-seat plate
    },
  },
  rug: {
    r: 60, h: 2,
    fn(b) {
      b.box(0, 0.6, 0, 120, 1.2, 120, 0x748a79)
      b.box(0, 1.0, 0, 128, 1.2, 108, 0x5f7566)
      b.box(0, 1.4, 0, 100, 1.2, 88, 0x7e9583)
    },
  },
  plant: {
    r: 15, h: 62, idle: 0.03,
    fn(b) {
      b.box(0, 9, 0, 24, 18, 24, 0xb5643f, S3) // terracotta pot
      b.box(0, 18.6, 0, 27, 4, 27, 0xc7714a, S3) // rim
      b.box(0, 21, 0, 21, 3, 21, 0x6b4526) // soil
      b.box(0, 30, 0, 6, 18, 6, 0x5a7a3c, W1) // stem
      b.box(0, 42, 0, 30, 14, 28, 0x3f9e4a, L2(2.2, 22))
      b.box(-5, 52, 3, 20, 10, 18, 0x4fae53, L2(2.2, 22))
      b.box(7, 55, -4, 14, 9, 13, 0x5abe63, L2(2.2, 22))
    },
  },
  cooler: {
    r: 13, h: 76,
    fn(b) {
      b.box(0, 22, 0, 26, 44, 24, 0xeef2ee) // white body
      b.box(0, 1.6, 0, 28, 3.2, 26, 0xbfc9c2, S3) // foot
      b.box(0, 30, 13.2, 14, 8, 2.4, 0x7f8f88) // taps recess
      b.box(-3.4, 30, 14.6, 3, 4.4, 3, 0x2f6da8)
      b.box(3.4, 30, 14.6, 3, 4.4, 3, 0xd8434e)
      b.box(0, 46.4, 0, 22, 5, 20, 0x9fb0a8) // collar
      b.box(0, 62, 0, 22, 26, 20, 0x79c4e8, { shade: 1.1 }) // bottle
      b.box(0, 74.4, 0, 9, 4, 9, 0x5aa6cc)
    },
  },
  printer: {
    r: 17, h: 46,
    fn(b) {
      b.box(0, 8, 0, 34, 16, 30, 0x617c76, S3) // base
      b.box(0, 22, 0, 32, 12, 28, 0x92a6a0, S3) // body
      b.box(0, 28.6, 0, 26, 2, 22, 0x516a64, S3) // lid seam
      b.box(0, 31.4, -4, 28, 4, 16, 0xf2ece0, W1) // paper out
      b.box(0, 33.2, 2, 22, 2, 14, 0xe4dccb, W1)
      b.box(11, 23, 14.4, 8, 3, 2, 0x2a3a36) // control strip
      b.box(-11, 23, 14.4, 3, 3, 2, 0x8fd18a, { shade: 1.4 })
    },
  },
  coffee: {
    r: 18, h: 64,
    fn(b) {
      b.box(0, 16, 0, 42, 4, 34, WOOD, W1) // little table
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 17, 7, sz * 13, 4, 14, 4, WOOD_D, W1)
      b.box(-8, 30, 0, 22, 24, 22, 0x3a4550, S3) // machine
      b.box(-8, 43.4, 0, 18, 3, 18, 0x505d69, S3)
      b.box(-8, 24, 11.4, 12, 8, 2, 0x8a3b32)
      b.box(-8, 19.4, 9, 8, 2, 8, 0xdad3c4)
      b.box(12, 20, -4, 9, 8, 9, 0xf2ece0) // two cups
      b.box(12, 20, 8, 9, 8, 9, 0xf2ece0)
    },
  },
  shelf: {
    r: 20, h: 96,
    fn(b) {
      // stands against the west wall: depth along z (2 tiles), the open face towards +x
      b.box(-9, 48, 0, 8, 96, 120, 0x8a5e33, W1) // back
      b.box(0, 2.4, 0, 26, 5, 120, 0x8a5e33, W1)
      for (const sy of [30, 58, 86]) b.box(0, sy, 0, 26, 4, 120, WOOD_D, W1)
      for (const sz of [-1, 1]) b.box(0, 48, sz * 58, 26, 96, 5, 0x8a5e33, W1)
      const books = [0xd8434e, 0xe8a33d, 0x4c8fd6, 0x64ad5e, 0xb07ad8, 0xdcd36a]
      let k = 0
      for (const sy of [16, 44, 72]) {
        for (let i = 0; i < 9; i++) {
          const h = 18 + ((k * 7) % 5)
          b.box(1, sy + h / 2 - 5, -52 + i * 12 + (k % 3), 16, h, 9, books[k % books.length], W1)
          k++
        }
      }
    },
  },
  // ---- wall pieces (authored facing +z; the west wall rotates them 90°) --------------------
  window: {
    r: 0, h: 0,
    fn(b) {
      // no glass pane: the wall has a real opening here, so the room looks out over the shore
      b.box(0, 33, 0.8, 130, 7, 6, 0xd4c8ad, W1) // frame: head, sill rail, jambs, mullion
      b.box(0, -33, 0.8, 130, 7, 6, 0xd4c8ad, W1)
      b.box(-61, 0, 0.8, 8, 74, 6, 0xd4c8ad, W1)
      b.box(61, 0, 0.8, 8, 74, 6, 0xd4c8ad, W1)
      b.box(0, 0, 0.8, 5, 66, 6, 0xd4c8ad, W1)
      b.box(0, -37.6, 2.4, 132, 5, 11, 0xc9bb9e, W1) // sill
    },
  },
  whiteboard: {
    r: 0, h: 0,
    fn(b) {
      b.box(0, 0, -1.6, 116, 62, 4, 0xf4efe4)
      b.box(0, 32, 0.4, 122, 6, 6, 0xb9c3b6, S3)
      b.box(0, -32, 0.4, 122, 6, 6, 0xb9c3b6, S3)
      b.box(-59, 0, 0.4, 6, 70, 6, 0xb9c3b6, S3)
      b.box(59, 0, 0.4, 6, 70, 6, 0xb9c3b6, S3)
      b.box(-24, 16, 0.9, 52, 4, 2, 0x4c8fd6) // scribbles
      b.box(-14, 6, 0.9, 72, 4, 2, 0x64ad5e)
      b.box(-30, -6, 0.9, 40, 4, 2, 0xd8434e)
      b.box(20, -2, 0.9, 30, 22, 2, 0xdfe7dd)
      b.box(-40, -24, 0.9, 12, 4, 2, 0x2a3a36)
    },
  },
  clock: {
    r: 0, h: 0,
    fn(b) {
      b.box(0, 0, -1, 26, 26, 4, 0xf2ece0)
      b.box(0, 0, 1.4, 30, 30, 3, 0x8a5e33, W1)
      b.box(0, 0, 1.2, 24, 24, 3.4, 0xfbf7ee)
      b.box(0, 3, 2.6, 2, 8, 1.4, 0x2a3a36)
      b.box(4, 0, 2.6, 9, 2, 1.4, 0xd8434e)
    },
  },
  poster: {
    r: 0, h: 0,
    fn(b) {
      b.box(0, 0, -1, 40, 54, 3, 0xf2ece0)
      b.box(0, 0, 0.8, 44, 58, 2.4, 0xb9a06a, W1)
      b.box(0, 12, 1.4, 30, 18, 1.6, 0x79c4e8)
      b.box(-6, -6, 1.4, 16, 12, 1.6, 0xe8a33d)
      b.box(8, -14, 1.4, 20, 5, 1.6, 0x64ad5e)
    },
  },
  door: {
    r: 0, h: 0,
    // authored around y = 0 at mid height: the placement lifts it so the jambs stand on the deck
    fn(b) {
      b.box(-36, 0, 0, 8, 118, 13, 0xd4c8ad, W1) // jambs
      b.box(36, 0, 0, 8, 118, 13, 0xd4c8ad, W1)
      b.box(0, 55, 0, 80, 8, 13, 0xd4c8ad, W1) // lintel
      b.box(30, -7, 26, 6, 104, 52, 0xa57746, W1) // leaf, swung open into the room
      b.box(30, -7, 26, 7, 88, 40, 0x9a6a3c, W1)
      b.box(27, -12, 46, 4, 6, 6, 0xe8c86a, { shade: 1.3 }) // handle
    },
  },
  // ---- outdoors (ported from the game's PROPS) ---------------------------------------------
  tree_m: {
    r: 24, h: 90, idle: 0.025,
    fn(b) {
      b.box(0, 20, 0, 14, 40, 14, 0x7c5330, W1)
      b.box(0, 52, 0, 62, 26, 62, 0x3f9e4a, L2(2.6, 30))
      b.box(0, 71, 0, 46, 16, 46, 0x4fae53, L2(2.6, 30))
      b.box(0, 84, 0, 26, 12, 26, 0x5abe63, L2(2.6, 30))
    },
  },
  tree_s: {
    r: 17, h: 50, idle: 0.04,
    fn(b) {
      b.box(0, 10, 0, 10, 20, 10, 0x7c5330, W1)
      b.box(0, 31, 0, 38, 24, 38, 0x5abe63, L2(2.8, 16))
      b.box(0, 45, 0, 24, 10, 24, 0x6cd275, L2(2.8, 16))
    },
  },
  bush: {
    r: 23, h: 34, idle: 0.05,
    fn(b) {
      b.box(0, 11, 0, 42, 22, 38, 0x3f9e4a, L2(1.8))
      b.box(-8, 28, 4, 24, 12, 22, 0x4fae53, L2(1.8))
      b.box(12, 27, -6, 16, 10, 16, 0x37944a, L2(1.8))
    },
  },
  rock: {
    r: 21, h: 30, idle: 0.055,
    fn(b) {
      b.box(0, 9, 0, 40, 18, 32, 0x9aa0a8, S3)
      b.box(-6, 22, 2, 24, 12, 20, 0xa8aeb6, S3)
      b.box(14, 5, -11, 14, 10, 12, 0x848a93, S3)
      b.box(0, 3.5, 0, 40.8, 5, 32.8, 0x878d96, S3)
      b.box(-8, 27.2, 3, 16, 2.4, 14, 0xbcc2ca, S3)
      b.box(-14, 18.3, -11.5, 7, 2, 6, 0xbcc2ca, S3)
      b.box(5, 11.5, 15.9, 3, 9, 1, 0x6e747d, S3)
      b.box(-18.1, 21, 5, 1, 8, 3, 0x6e747d, S3)
      b.box(20.2, 4, 6, 3, 8, 8, 0x8d939c, S3)
      b.box(12.5, 18.6, 4, 11, 2, 16, 0x5aa850, { mat: 2 })
      b.box(-10, 2.2, -16.3, 10, 3.6, 1, 0x5aa850, { mat: 2 })
    },
  },
  rock_s: {
    r: 12, h: 14, idle: 0.08,
    fn(b) {
      b.box(0, 6, 0, 22, 12, 18, 0x9aa0a8, S3)
      b.box(7, 11, 3, 10, 8, 8, 0xa8aeb6, S3)
      b.box(0, 2.2, 0, 22.8, 3.2, 18.8, 0x878d96, S3)
      b.box(6.5, 14.6, 3, 6, 1.6, 5, 0xbcc2ca, S3)
      b.box(-5, 12.2, -2, 8, 1.4, 8, 0xbcc2ca, S3)
      b.box(-3, 6.6, 8.9, 2.4, 4.8, 1, 0x6e747d, S3)
      b.box(-11, 8, 2, 1, 4, 6, 0x5aa850, { mat: 2 })
      b.box(10.3, 1.2, -7.8, 4, 2.4, 4, 0x8d939c, S3)
    },
  },
  stump: {
    r: 16, h: 21, idle: 0.07,
    fn(b) {
      b.box(0, 9, 0, 26, 18, 26, 0x8a5a35, W1)
      b.box(0, 16.4, 0, 27, 1.8, 27, 0x744a29, W1)
      b.box(-5, 8, 13.0, 5, 15, 0.9, 0x744a29, W1)
      b.box(13.0, 9.5, 3, 0.9, 13, 6, 0x744a29, W1)
      b.box(-8, 7, -13.0, 4, 12, 0.9, 0x744a29, W1)
      b.box(0, 19, 0, 22, 3, 22, 0xc89a62, W1)
      b.box(0, 19.6, 0, 12, 2.4, 12, 0xa87c48, W1)
      b.box(0, 20.5, 0, 5, 1.4, 5, 0x8a5e33, W1)
      b.box(-15, 3, 4, 8, 6, 8, 0x7d5030, W1)
      b.box(12, 3, -8, 8, 6, 8, 0x7d5030, W1)
      b.box(-15, 6.3, 6, 5, 1.4, 5, 0x45a049, { mat: 2 })
      b.box(-13.1, 12, -4, 1, 6, 9, 0x4fae53, { mat: 2 })
      b.box(-8, 20.7, 5, 5, 1.2, 5, 0x4fae53, { mat: 2 })
      b.box(13.3, 6.5, -6, 1.8, 1.2, 3, 0xd8a05c)
      b.box(13.4, 9.2, -5, 2.2, 1.2, 3.6, 0xc79055)
    },
  },
  log: {
    r: 24, h: 18, idle: 0.08,
    fn(b) {
      b.box(0, 8, 0, 46, 16, 18, 0x8a5a35, W1)
      b.box(0, 2, 0, 46.8, 3.2, 18.8, 0x6f4527, W1)
      b.box(-4, 11.5, 9, 30, 3, 0.8, 0x744a29, W1)
      b.box(6, 5.5, -9, 26, 3, 0.8, 0x744a29, W1)
      b.box(10, 9, -9.05, 3, 3, 1.1, 0x5f3c20, W1)
      b.box(-22, 8, 0, 4, 14, 16, 0xc89a62, W1)
      b.box(22, 8, 0, 4, 14, 16, 0xc89a62, W1)
      b.box(-24.2, 8, 0, 1.2, 10, 12, 0xa87c48, W1)
      b.box(24.2, 8, 0, 1.2, 10, 12, 0xa87c48, W1)
      b.box(4, 16.6, 0, 26, 2.4, 13, 0x4fae53, { mat: 2 })
      b.box(0, 14.6, 9.05, 14, 3.6, 1.1, 0x45a049, { mat: 2 })
      b.box(-15, 16.4, -2, 6, 1.8, 8, 0x45a049, { mat: 2 })
      b.box(14, 16.8, -3, 5, 3.6, 5, 0x744a29, W1)
      b.box(14, 18.7, -3, 3.8, 1.2, 3.8, 0xc89a62, W1)
    },
  },
  crate: {
    r: 21, h: 34, idle: 0.055,
    fn(b) {
      b.box(0, 16, 0, 34, 32, 34, 0xb3844e, W1)
      b.box(0, 8, 0, 34.8, 2.4, 34.8, 0x7d5631, W1)
      b.box(0, 24, 0, 34.8, 2.4, 34.8, 0x7d5631, W1)
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        b.box(sx * 15, 16, sz * 15, 6, 32.4, 6, 0x8a5e33, W1)
        b.box(sx * 15, 30.4, sz * 15, 6.8, 4.4, 6.8, 0x565b64, S3)
        b.box(sx * 15, 2.2, sz * 15, 6.8, 4, 6.8, 0x565b64, S3)
      }
      b.box(0, 30.4, 0, 35, 3.6, 35, 0x8a5e33, W1)
      b.box(0, 31.2, 0, 22, 2.8, 22, 0xd8ac6e, W1)
      b.box(0, 16, 17.4, 28, 5.6, 1.6, 0xcaa065, W1)
      b.box(17.4, 16, 0, 1.6, 5.6, 28, 0xcaa065, W1)
      b.box(-9, 2, 16, 9, 2.8, 4.4, 0x5fae54, { mat: 2 })
    },
  },
  barrel: {
    r: 17, h: 32, idle: 0.06,
    fn(b) {
      b.box(0, 3, 0, 30, 6, 30, 0x5c6069, S3)
      b.box(0, 25, 0, 30, 6, 30, 0x5c6069, S3)
      b.box(0, 14, 0, 27, 17, 27, 0xa06a3c, W1)
      b.box(-7, 14, 0, 5, 16.8, 27.8, 0xb1783f, W1)
      b.box(6, 13.9, 0, 5, 16.6, 27.8, 0x8f5c33, W1)
      b.box(0, 13.9, -7, 27.8, 16.6, 5, 0x8f5c33, W1)
      b.box(0, 14, 6, 27.8, 16.8, 5, 0xb1783f, W1)
      b.box(0, 14, 0, 28.6, 3, 28.6, 0x5c6069, S3)
      b.box(0, 25, 15.25, 3.2, 3.2, 1.4, 0x7a7f89, S3)
      b.box(0, 25, -15.25, 3.2, 3.2, 1.4, 0x7a7f89, S3)
      b.box(15.25, 3, 0, 1.4, 3.2, 3.2, 0x7a7f89, S3)
      b.box(-15.25, 3, 0, 1.4, 3.2, 3.2, 0x7a7f89, S3)
      b.box(0, 28.4, 0, 24, 3, 24, 0xc89a62, W1)
    },
  },
  flower_p: {
    r: 0, h: 0,
    fn(b) {
      b.box(0, 5, 0, 3, 10, 3, 0x3f9e4a, L2(2.0))
      b.box(0, 11.5, 0, 9, 5, 9, 0xd88ae0, { sway: 2.0, swayY0: 0 })
      b.box(0, 14.4, 0, 4, 2, 4, 0xf6e08a, { sway: 2.0, swayY0: 0 })
    },
  },
  flower_y: {
    r: 0, h: 0,
    fn(b) {
      b.box(0, 4, 0, 3, 8, 3, 0x3f9e4a, L2(2.0))
      b.box(0, 9.5, 0, 8, 4.6, 8, 0xf2d949, { sway: 2.0, swayY0: 0 })
      b.box(0, 12.2, 0, 3.6, 1.8, 3.6, 0xd07e2c, { sway: 2.0, swayY0: 0 })
    },
  },
  pebble: {
    r: 0, h: 0,
    fn(b) {
      b.box(-4, 2, 2, 8, 4, 6, 0xaeb4bc, S3)
      b.box(5, 1.5, -3, 6, 3, 5, 0x9aa0a8, S3)
      b.box(1, 1.2, 7, 4, 2.4, 4, 0xbfc5cc, S3)
    },
  },
  grass: {
    r: 0, h: 0,
    fn(b, rnd) {
      const g = [0x58b854, 0x6cc95f, 0x4aa84e]
      const n = 3
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (rnd ? rnd() : 0.5)
        b.box(Math.cos(a) * 4.5, 4 + i, Math.sin(a) * 3.5, 3, 8 + i * 3, 3, g[i % 3], L2(2.6))
      }
    },
  },
}

export type PropId = keyof typeof PROPS
