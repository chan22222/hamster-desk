// The studio's world: a seeded voxel island with the office deck raised one step above it.
// Built the way the reference game builds its islands (world.js `_buildIsland`): a lobed blob,
// two smoothing passes, per-tile floor boxes with hidden inner faces, dirt columns down the
// cliffs, then scattered props — all from one LCG so every run produces the identical place.
//
// Pure data: it only touches THREE.BufferGeometry and THREE.Color, never a Mesh, a Material or
// the DOM, so the node test can build the whole world and measure it.
import * as THREE from 'three'
import { VoxBuilder, W1, S3, type BoxOpt, type BoxSink, type HideFaces } from './builder'
import { PROPS, DESK_PARTS, BOSS_DESK_PARTS, SIGN_H, SIGN_L_H, SIGN_L_W, SIGN_W, type LocalBox } from './props'
import { OFFICE, OFFICE_TILE, H_OFFICE, T, tileToWorld } from '../office-world'

export const COLS = 40
export const ROWS = 34
export const WORLD_W = COLS * T
export const WORLD_D = ROWS * T
export const WATER_Y = -22
export const SEED = 20260920
export const CHUNK = T * 8
/** the two walls rise this far above the deck */
export const WALL_H = 120
/** north-wall fixtures, as office tile columns: each is centred on the tile's east edge */
export const WINDOWS = [3, 11, 18]
export const WHITEBOARDS = [7, 15]

export type WorldBox = LocalBox

/**
 * A framed picture on a wall. The voxel frame and backing are in the chunks; the picture itself is
 * a textured plane the renderer hangs at exactly this spot (src/desk/signs.ts) — the one thing in
 * the room the world builder cannot make, because it needs an Image and a Material.
 */
export interface WallSign {
  id: 'spritfy-north' | 'spritfy-west'
  /** centre of the picture surface, already offset in front of the frame's backing */
  x: number
  y: number
  z: number
  w: number
  h: number
  /** which way the picture faces, in the props' 90° steps: 0 = +z (north wall), 1 = +x (west wall) */
  rot: 0 | 1 | 2 | 3
}

export interface DeskParts {
  slot: number
  screen: WorldBox
  keys: WorldBox
  lamp: WorldBox
  spill: WorldBox
}

export interface StudioWorld {
  chunks: { key: string; static: THREE.BufferGeometry | null; sway: THREE.BufferGeometry | null }[]
  heights: number[][]
  land: boolean[][]
  /** minimap tile colours — the colour actually painted on that tile, 0 for water */
  mapColors: number[][]
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  deskParts: DeskParts[]
  /** world positions of the scattered trees, for tests and for keeping the deck clear */
  trees: { x: number; z: number }[]
  /** framed pictures whose surface the renderer textures (the frames are already in the chunks) */
  signs: WallSign[]
  boxCount: number
}

// office footprint in world tiles
const OI0 = OFFICE_TILE.i
const OI1 = OFFICE_TILE.i + OFFICE.W - 1
const OJ0 = OFFICE_TILE.j
const OJ1 = OFFICE_TILE.j + OFFICE.D - 1
// world-unit edges of the deck
const OX0 = OFFICE_TILE.i * T
const OX1 = (OFFICE_TILE.i + OFFICE.W) * T
const OZ0 = OFFICE_TILE.j * T
const OZ1 = (OFFICE_TILE.j + OFFICE.D) * T

const GRASS_PALS = [
  [0x6ec25e, 0x79ca66, 0x64b856],
  [0x66bb58, 0x70c460, 0x5eb050],
  [0x74c866, 0x7ed06e, 0x6abc5c],
]
const SAND = [0xe6d59e, 0xddca90]
const DECK = [0xd8b088, 0xcaa276]
const DIRT = 0x9a7752
const FOAM = 0xc4e9f5
const WALL = 0xe6dcc6
const WAINSCOT = 0x819078
const TRIM = 0xd4c8ad

const DOT_FONT: Record<string, string[]> = {
  S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
}

export function buildStudioWorld(): StudioWorld {
  let seed = SEED
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  // deterministic integer hash — ground patches and sand tones, independent of the PRNG stream
  const ih = (x: number, y: number): number => {
    let n = (x * 374761393 + y * 668265263) | 0
    n = ((n ^ (n >>> 13)) * 1274126177) | 0
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296
  }

  let boxCount = 0
  const chunkMap = new Map<string, { g: VoxBuilder; sw: VoxBuilder }>()
  const chunkAt = (x: number, z: number): { g: VoxBuilder; sw: VoxBuilder } => {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`
    let c = chunkMap.get(key)
    if (!c) {
      c = { g: new VoxBuilder(), sw: new VoxBuilder() }
      chunkMap.set(key, c)
    }
    return c
  }
  const g: BoxSink = {
    box: (x, y, z, w, h, d, col, opt) => {
      boxCount++
      chunkAt(x, z).g.box(x, y, z, w, h, d, col, opt)
    },
  }
  const sw: BoxSink = {
    box: (x, y, z, w, h, d, col, opt) => {
      boxCount++
      chunkAt(x, z).sw.box(x, y, z, w, h, d, col, opt)
    },
  }

  // ---- 1. the island blob ------------------------------------------------------------------
  const lobes = Array.from({ length: 12 }, () => 0.75 + rnd() * 0.5)
  const blob = { x: 20, y: 16.5, r: 14.5 }
  const inBlob = (tx: number, ty: number): boolean => {
    const dx = tx - blob.x, dy = ty - blob.y
    const d = Math.hypot(dx, dy)
    if (d > blob.r * 1.5) return false
    const ang = Math.atan2(dy, dx) + Math.PI
    const f = (ang / (2 * Math.PI)) * lobes.length
    const i0 = Math.floor(f) % lobes.length
    const i1 = (i0 + 1) % lobes.length
    const t = f - Math.floor(f)
    return d < blob.r * (lobes[i0] * (1 - t) + lobes[i1] * t)
  }

  const land: boolean[][] = Array.from({ length: ROWS }, () => new Array<boolean>(COLS).fill(false))
  for (let ty = 3; ty < ROWS - 3; ty++) for (let tx = 3; tx < COLS - 3; tx++) land[ty][tx] = inBlob(tx, ty)
  const lat = (x: number, y: number): boolean => y >= 0 && y < ROWS && x >= 0 && x < COLS && land[y][x]
  // trim spits and fill single-tile holes so the coastline reads as one shape
  for (let pass = 0; pass < 2; pass++) {
    const toLand: [number, number][] = []
    const toWater: [number, number][] = []
    for (let ty = 3; ty < ROWS - 3; ty++) for (let tx = 3; tx < COLS - 3; tx++) {
      const c = (lat(tx, ty - 1) ? 1 : 0) + (lat(tx, ty + 1) ? 1 : 0) + (lat(tx - 1, ty) ? 1 : 0) + (lat(tx + 1, ty) ? 1 : 0)
      if (land[ty][tx]) { if (c < 2) toWater.push([tx, ty]) }
      else if (c >= 4) toLand.push([tx, ty])
    }
    toWater.forEach(([x, y]) => { land[y][x] = false })
    toLand.forEach(([x, y]) => { land[y][x] = true })
  }
  // ---- 2. the office plus a two-tile apron is always solid ground --------------------------
  for (let ty = OJ0 - 2; ty <= OJ1 + 2; ty++) for (let tx = OI0 - 2; tx <= OI1 + 2; tx++) {
    if (ty >= 0 && ty < ROWS && tx >= 0 && tx < COLS) land[ty][tx] = true
  }

  const nearWaterD = (tx: number, ty: number): number => {
    let nw = 9
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!lat(tx + dx, ty + dy)) nw = Math.min(nw, Math.max(Math.abs(dx), Math.abs(dy)))
    }
    return nw
  }
  const inOffice = (tx: number, ty: number): boolean => tx >= OI0 && tx <= OI1 && ty >= OJ0 && ty <= OJ1

  // ---- 3. heights: the office deck is one step up, plus one small mesa out in the grass -----
  const heights: number[][] = Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0))
  const mesa = (() => {
    for (let tries = 0; tries < 400; tries++) {
      const tx = 5 + Math.floor(rnd() * (COLS - 10))
      const ty = 5 + Math.floor(rnd() * (ROWS - 10))
      if (!lat(tx, ty) || nearWaterD(tx, ty) <= 2) continue
      if (tx >= OI0 - 6 && tx <= OI1 + 6 && ty >= OJ0 - 6 && ty <= OJ1 + 6) continue
      return { tx, ty, r: 3, n: Array.from({ length: 10 }, () => 0.8 + rnd() * 0.4) }
    }
    return null
  })()
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    if (!land[ty][tx]) continue
    if (inOffice(tx, ty)) { heights[ty][tx] = H_OFFICE; continue }
    if (!mesa || nearWaterD(tx, ty) <= 2) continue
    const dx = tx - mesa.tx, dy = ty - mesa.ty
    const d = Math.hypot(dx, dy)
    if (d > mesa.r * 1.2) continue
    const ang = Math.atan2(dy, dx) + Math.PI
    const f = (ang / (2 * Math.PI)) * mesa.n.length
    const i0 = Math.floor(f) % mesa.n.length
    const i1 = (i0 + 1) % mesa.n.length
    const t = f - Math.floor(f)
    const rw = mesa.r * (mesa.n[i0] * (1 - t) + mesa.n[i1] * t)
    if (d >= rw) continue
    const lv = Math.max(1, Math.floor((rw - d) / 1.05) + 1)
    heights[ty][tx] = Math.min(24, lv * 24)
  }
  const hAt = (tx: number, ty: number): number => (lat(tx, ty) ? heights[ty][tx] : 0)

  // ---- 4. ground tiles ---------------------------------------------------------------------
  const mapColors: number[][] = Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0))
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const cx = (tx + 0.5) * T, cz = (ty + 0.5) * T
    if (!land[ty][tx]) {
      // foam band on water tiles that touch the shore, just above the wave crests
      if (lat(tx - 1, ty) || lat(tx + 1, ty) || lat(tx, ty - 1) || lat(tx, ty + 1)) {
        g.box(cx, -16.6, cz, T, 2, T, FOAM, { shade: 1 })
      }
      continue
    }
    minX = Math.min(minX, tx * T); maxX = Math.max(maxX, (tx + 1) * T)
    minZ = Math.min(minZ, ty * T); maxZ = Math.max(maxZ, (ty + 1) * T)
    const coast = !(lat(tx - 1, ty) && lat(tx + 1, ty) && lat(tx, ty - 1) && lat(tx, ty + 1))
    let color: number
    if (inOffice(tx, ty)) {
      // wood deck in two tones, clumped in 4x4 patches so the planks read as boards
      color = ih(tx >> 2, ty >> 2) < 0.55 ? DECK[0] : DECK[1]
    } else if (coast) {
      color = ih(tx, ty) < 0.5 ? SAND[0] : SAND[1]
    } else {
      const p = ih(tx >> 2, ty >> 2)
      const pal = p < 0.55 ? GRASS_PALS[0] : p < 0.8 ? GRASS_PALS[1] : GRASS_PALS[2]
      color = pal[Math.floor(rnd() * pal.length)]
    }
    const hgt = heights[ty][tx]
    mapColors[ty][tx] = color
    // faces a taller-or-equal neighbour hides forever are skipped: fewer triangles, and no
    // coplanar seams for the depth test to speckle
    const covered = (nx: number, ny: number): boolean => lat(nx, ny) && heights[ny][nx] >= hgt
    const hide: HideFaces = {
      nx: covered(tx - 1, ty),
      px: covered(tx + 1, ty),
      nz: covered(tx, ty - 1),
      pz: covered(tx, ty + 1),
    }
    g.box(cx, hgt - 5, cz, T, 10, T, color, { shade: 0.965 + rnd() * 0.07, mat: 4, hide })
    const mn = Math.min(hAt(tx - 1, ty), hAt(tx + 1, ty), hAt(tx, ty - 1), hAt(tx, ty + 1))
    if (hgt > mn) g.box(cx, (hgt + mn) / 2 - 10, cz, T, hgt - mn, T, DIRT, { shade: 0.9 + rnd() * 0.12, mat: 3 })
    if (coast) g.box(cx, -38, cz, T, 56, T, DIRT, { shade: 0.9 + rnd() * 0.12, mat: 3 })
  }

  // ---- 5. props -----------------------------------------------------------------------------
  // rot: 0..3 = 90° steps; -1 picks one from the PRNG. Rotation turns the box footprint too.
  const put = (id: string, px: number, pz: number, py: number, rot = -1): void => {
    const def = PROPS[id]
    if (!def) return
    const phase = rnd() * Math.PI * 2
    const idle = def.idle || 0
    const R = rot < 0 ? Math.floor(rnd() * 4) : rot
    const off: BoxSink = {
      box: (x, y, z, w, h, d, c, o: BoxOpt = {}) => {
        let rx = x, rz = z, rw = w, rd = d
        if (R === 1) { rx = z; rz = -x; rw = d; rd = w }
        else if (R === 2) { rx = -x; rz = -z }
        else if (R === 3) { rx = -z; rz = x; rw = d; rd = w }
        const anim = idle || o.sway
        const sink = anim ? sw : g
        sink.box(px + rx, py + y, pz + rz, rw, h, rd, c,
          anim ? { ...o, phase, swayY0: py + (o.swayY0 ?? 0), breath: o.breath ?? idle, breathY0: py } : o)
      },
    }
    def.fn(off, rnd)
  }

  // ---- 5a. the office shell ------------------------------------------------------------------
  const deck = H_OFFICE
  const doorZ = tileToWorld(OFFICE.door.i, OFFICE.door.j).z
  const WIN_Y0 = deck + 41
  const WIN_Y1 = deck + 111
  /**
   * A wall with holes in it. The windows are real openings rather than painted glass: from the
   * default camera you look straight through them at the shore and the sea, which is the only way
   * the island shows up at all from inside a room with two tall walls.
   */
  const buildWall = (axis: 'x' | 'z', a0: number, a1: number, fixed: number, openings: { at: number; width: number; y0: number; y1: number }[]): void => {
    const slab = (s0: number, s1: number, y0: number, y1: number, color: number, thick: number): void => {
      if (s1 - s0 <= 0.01 || y1 - y0 <= 0.01) return
      const c = (s0 + s1) / 2, len = s1 - s0, cy = (y0 + y1) / 2, hh = y1 - y0
      if (axis === 'x') g.box(c, cy, fixed, len, hh, thick, color, S3)
      else g.box(fixed, cy, c, thick, hh, len, color, S3)
    }
    const top = deck + WALL_H
    const solid = (s0: number, s1: number): void => {
      slab(s0, s1, deck, top, WALL, 12)
      slab(s0, s1, deck, deck + 40, WAINSCOT, 13.2) // wainscoting, proud of the plaster
    }
    let cursor = a0
    for (const o of [...openings].sort((p1, q1) => p1.at - q1.at)) {
      solid(cursor, o.at - o.width / 2)
      slab(o.at - o.width / 2, o.at + o.width / 2, deck, o.y0, WALL, 12)
      if (o.y0 > deck + 40) slab(o.at - o.width / 2, o.at + o.width / 2, deck, deck + 40, WAINSCOT, 13.2)
      slab(o.at - o.width / 2, o.at + o.width / 2, o.y1, top, WALL, 12)
      cursor = o.at + o.width / 2
    }
    solid(cursor, a1)
    slab(a0, a1, top - 6, top, TRIM, 13.6)
  }
  // north wall (the j = 0 edge) and west wall (the i = 0 edge); the other two sides stay open so
  // the camera can look into the room
  buildWall('x', OX0, OX1, OZ0 + 6, WINDOWS.map((i) => ({ at: (OFFICE_TILE.i + i + 1) * T, width: 128, y0: WIN_Y0, y1: WIN_Y1 })))
  buildWall('z', OZ0, OZ1, OX0 + 6, [{ at: doorZ, width: 64, y0: deck, y1: deck + 118 }])
  put('door', OX0 + 6, doorZ, deck + 59, 1)
  // three steps down to the grass outside the door
  for (let s = 0; s < 3; s++) g.box(OX0 - 20 - s * 40, 20 - s * 8, doorZ, 40, 8, 96, 0xa57746, W1)

  const WALL_IN_Z = OZ0 + 13 // inner face of the north wall, plus a hair
  const WALL_IN_X = OX0 + 13
  for (const i of WINDOWS) put('window', (OFFICE_TILE.i + i + 1) * T, WALL_IN_Z, deck + 76, 0)
  for (const i of WHITEBOARDS) put('whiteboard', (OFFICE_TILE.i + i + 1) * T, WALL_IN_Z, deck + 76, 0)
  put('clock', WALL_IN_X, tileToWorld(0, 2.6).z, deck + 92, 1)
  for (const j of [4.8, 12, 16]) put('poster', WALL_IN_X, tileToWorld(0, j).z, deck + 76, 1)

  // The Spritfy print: the north wall's bay between the second window and the second whiteboard,
  // east of the boss's desk. The bay right behind the boss is where the main hamster's speech
  // bubbles stack, so a picture there would spend its life under them; this one is in the default
  // close-up (at its right edge) and in full view whenever colleagues widen the framing, and
  // nothing stands in front of it — the plant beside the boss's desk is under the window.
  // Its top lines up with the window heads and whiteboards (deck + 111).
  const signX = (OFFICE_TILE.i + 14) * T
  const signY = deck + 78
  put('signFrame', signX, WALL_IN_Z, signY, 0)
  // The second print, larger, on the west wall between the door and the poster at j 12 — the
  // one stretch of that wall with nothing hung on it. The close-up on a lone boss never shows the
  // west wall at all, but every wider framing does, on the left: colleagues at 117 % and 84 %, and
  // the corridor a new colleague walks in along. Seen from further away than the north print, it
  // is a size up (1.4×), with its top on the same line as the window heads; the cooler and the
  // plant standing in front of this bay only ever cover the wainscot below it from this camera,
  // and the corridor and the lobby are a tile out from the wall.
  const signWZ = tileToWorld(0, 9.4).z
  const signWY = deck + 111 - 3 - SIGN_L_H / 2
  put('signFrameL', WALL_IN_X, signWZ, signWY, 1)
  const signs: WallSign[] = [
    { id: 'spritfy-north', x: signX, y: signY, z: WALL_IN_Z + 0.85, w: SIGN_W, h: SIGN_H, rot: 0 },
    { id: 'spritfy-west', x: WALL_IN_X + 0.85, y: signWY, z: signWZ, w: SIGN_L_W, h: SIGN_L_H, rot: 1 },
  ]

  // desks, chairs, rugs — slot 0 is the boss's set along the north wall, the rest the staff grid
  const deskParts: DeskParts[] = []
  OFFICE.slots.forEach((slot, k) => {
    const boss = k === 0
    const dx = (OFFICE_TILE.i + slot.i + 1) * T
    const dz = (OFFICE_TILE.j + slot.j + 0.5) * T
    put(boss ? 'bossRug' : 'rug', dx, dz, deck + 0.2, 0)
    put(boss ? 'bossDesk' : 'desk', dx, dz, deck, 0)
    const seat = tileToWorld(slot.chair.i, slot.chair.j)
    put(boss ? 'bossChair' : 'chair', seat.x, seat.z, deck, 0)
    const parts = boss ? BOSS_DESK_PARTS : DESK_PARTS
    const w = (b: LocalBox): WorldBox => ({ x: dx + b.x, y: deck + b.y, z: dz + b.z, w: b.w, h: b.h, d: b.d })
    deskParts.push({ slot: k, screen: w(parts.screen), keys: w(parts.keys), lamp: w(parts.lamp), spill: w(parts.spill) })
  })

  // the fixtures inherited from the 2D office, at the same tile coordinates (the coffee table
  // moved west so the boss's corner is not crowded)
  put('shelf', WALL_IN_X + 4, tileToWorld(0, 1.8).z, deck, 0)
  for (const [id, pi, pj] of [['cooler', 0.6, 8.5], ['coffee', 5.5, 0.7], ['printer', 16, 0.7]] as [string, number, number][]) {
    const p = tileToWorld(pi, pj)
    put(id, p.x, p.z, deck, 0)
  }
  // plants: the room's corners, plus one either side of the boss's desk
  const bossI = OFFICE.slots[0].i + 0.5, bossJ = OFFICE.slots[0].j
  for (const [pi, pj] of [[2.6, 0.8], [OFFICE.W - 1.5, 0.8], [0.8, 11], [OFFICE.W - 1.5, OFFICE.D - 2.5], [bossI - 2, bossJ], [bossI + 2, bossJ]]) {
    const p = tileToWorld(pi, pj)
    put('plant', p.x, p.z, deck, 0)
  }

  // ---- 5b. STUDIO in dot letters on the deck by the door -----------------------------------
  {
    const word = 'STUDIO'
    const s = 6
    const x0 = OX0 + 64
    for (let ci = 0; ci < word.length; ci++) {
      const rows = DOT_FONT[word[ci]]
      const lx = x0 + ci * (3 * s + s)
      for (let r = 0; r < 5; r++) {
        let c = 0
        while (c < 3) {
          if (rows[r][c] !== '#') { c++; continue }
          let run = 1
          while (c + run < 3 && rows[r][c + run] === '#') run++
          // horizontal runs are merged into one box — two boxes in the same plane would z-fight
          g.box(lx + (c + run / 2) * s, deck + 1, doorZ - 15 + r * s + s / 2, run * s, 1.6, s, 0x8a5e33, W1)
          c += run
        }
      }
    }
  }

  // ---- 5c. scattered nature ------------------------------------------------------------------
  const inner: { tx: number; ty: number }[] = []
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    if (!land[ty][tx]) continue
    if (tx >= OI0 - 1 && tx <= OI1 + 1 && ty >= OJ0 - 1 && ty <= OJ1 + 1) continue
    let ok = true
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!lat(tx + dx, ty + dy)) { ok = false; break }
    if (ok) inner.push({ tx, ty })
  }
  const placed: { x: number; z: number }[] = []
  const tooClose = (px: number, pz: number, d: number): boolean => placed.some((q) => Math.hypot(q.x - px, q.z - pz) < d)
  const pick = (): { tx: number; ty: number } | undefined => inner[Math.floor(rnd() * inner.length)]
  const scatter = (ids: string[], want: number, gap: number, log?: { x: number; z: number }[]): void => {
    for (let i = 0, tries = 0; i < want && tries < want * 16; tries++) {
      const c = pick()
      if (!c) break
      const px = (c.tx + 0.5) * T, pz = (c.ty + 0.5) * T
      if (tooClose(px, pz, gap)) continue
      put(ids[Math.floor(rnd() * ids.length)], px, pz, hAt(c.tx, c.ty))
      placed.push({ x: px, z: pz })
      log?.push({ x: px, z: pz })
      i++
    }
  }
  // Densities run higher than the game's: the strip of island left around the office deck is only
  // a few tiles wide, and at the original ratios it came out bare.
  const trees: { x: number; z: number }[] = []
  scatter(['tree_s', 'tree_m', 'tree_m'], Math.min(40, Math.floor(inner.length * 0.22)), T * 1.9, trees)
  scatter(['rock', 'rock_s', 'stump', 'log', 'bush', 'crate', 'barrel'], Math.min(25, Math.floor(inner.length * 0.16)), T * 1.5)
  scatter(['pebble', 'flower_p', 'flower_y'], Math.min(40, Math.floor(inner.length * 0.30)), T * 0.9)
  // three flower patches — a scatter alone never clumps, and clumps are what reads as a meadow
  for (let ci = 0; ci < 3; ci++) {
    const c = pick()
    if (!c) break
    const cxp = (c.tx + 0.5) * T, czp = (c.ty + 0.5) * T
    if (tooClose(cxp, czp, T * 2.2)) continue
    const n = 6 + Math.floor(rnd() * 6)
    for (let k = 0; k < n; k++) {
      const px = cxp + (rnd() - 0.5) * T * 3.2, pz = czp + (rnd() - 0.5) * T * 3.2
      const ftx = Math.floor(px / T), fty = Math.floor(pz / T)
      if (!lat(ftx, fty) || (ftx >= OI0 - 1 && ftx <= OI1 + 1 && fty >= OJ0 - 1 && fty <= OJ1 + 1)) continue
      put(rnd() < 0.5 ? 'flower_p' : 'flower_y', px, pz, hAt(ftx, fty))
    }
    placed.push({ x: cxp, z: czp })
  }
  const gWant = Math.min(260, inner.length * 2)
  for (let i = 0; i < gWant; i++) {
    const c = inner[Math.floor(rnd() * inner.length)]
    if (!c) break
    const px = (c.tx + 0.2 + rnd() * 0.6) * T, pz = (c.ty + 0.2 + rnd() * 0.6) * T
    const gy = hAt(c.tx, c.ty)
    const phase = rnd() * Math.PI * 2
    const off: BoxSink = {
      box: (x, y, z, w, h, d, cl, o: BoxOpt = {}) => sw.box(px + x, gy + y, pz + z, w, h, d, cl, { ...o, phase, swayY0: gy + (o.swayY0 ?? 0) }),
    }
    PROPS.grass.fn(off, rnd)
  }

  // ---- 6. finish the chunk geometry ---------------------------------------------------------
  const chunks = [...chunkMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, c]) => ({
      key,
      static: c.g.isEmpty ? null : c.g.build(),
      sway: c.sw.isEmpty ? null : c.sw.build(),
    }))

  return {
    chunks,
    heights,
    land,
    mapColors,
    bounds: { minX, maxX, minZ, maxZ },
    deskParts,
    trees,
    signs,
    boxCount,
  }
}

/** Centre of the water plane — the component builds the actual mesh. */
export const WATER_CENTER = { x: WORLD_W / 2, z: WORLD_D / 2 }
