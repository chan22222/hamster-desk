// The hamster. The rig grammar is the reference game's standing cat (voxel.js `buildCat` with
// biped = true) — a quadruped body stood upright, one limb geometry shared by both arms and both
// legs, a head group that never rotates — but the proportions are a rodent's, not a cat's: a short
// deep barrel of a torso, stubby legs, small round ears, cheek pouches, two front teeth and a
// blunt tail tuft instead of a mast.
//
// The body is authored in quadruped coordinates and then stood upright, so local +y becomes the
// back and local +z becomes up. Origin is between the feet, the hamster faces +z, and every part
// group is positioned so the animation code in DeskStudio can offset from the exported
// headY / armY / legY / tailY / bodyY.
import * as THREE from 'three'
import { VoxBuilder, W1, LEAF, type BoxOpt } from './builder'
import type { Skin, SkinAccessory } from '../skins'

export interface HamsterRig {
  group: THREE.Group
  bodyM: THREE.Mesh
  /** the tie hangs on the chest: sitting drops the torso and the tie has to come with it */
  tieG: THREE.Group
  headG: THREE.Group
  tailG: THREE.Group
  /** [arm L, arm R, leg L, leg R] — all four share one geometry, like the game's four cat legs */
  legs: THREE.Group[]
  headY: number
  armY: number
  legY: number
  tailY: number
  bodyY: number
}

// ---- rig constants ------------------------------------------------------------------------
// Every number below follows from three invariants, so changing a box means redoing this block:
//   feet on the floor    the limb geometry bottoms out at -11.6, so LEG_Y = 11.6
//   torso y 11.5..45.5   upright, a body box sits at BODY_Y + (its authoring z) and is as tall as
//                        its authoring depth (34) — centre 28.5 at authoring z -2 → BODY_Y = 30.5
//   a buried neck        the skull's underside (HEAD_Y - 1 = 41.5) sinks 4 into the torso top
export const HEAD_Y = 42.5
/** shoulders near the top of the torso; the arm boxes overlap its ±14 side by 1 */
export const ARM_Y = 42
export const LEG_Y = 11.6
export const TAIL_Y = 13
export const BODY_Y = 30.5
/** head-local y of the ear tips — the top of the silhouette */
export const EAR_TOP = 21.25
/** the tip of the ears */
export const HAMSTER_H = HEAD_Y + EAR_TOP
/** head-local y the chat feed and the thought glyph hang from: just clear of the ear tips */
export const FEED_ANCHOR = EAR_TOP + 3
/** the sit pose drops every part of the rig by this much inside its group (DeskStudio.poseRig) */
export const SIT_DROP = 12
/** the session's main hamster is built a tenth larger than a colleague */
export const MAIN_SCALE = 1.1

interface Palette {
  fur: number
  dark: number
  belly: number
  eye: number
  /** cheek blush — deliberately not skin-driven, so every fur colour keeps the same rosy cheeks */
  cheek: number
}

/**
 * Fur and back stripes keep the studio's hamster tan (skins.ts overrides them per model); the
 * belly, eye and cheek tones are fixed so the face reads the same under every skin.
 */
const BASE: Palette = {
  fur: 0xf6d19b,
  dark: 0xd99e58,
  belly: 0xf9e2c0,
  eye: 0x252a33,
  cheek: 0xf79a93,
}
/** fixed accent colours (inner ear, nose, incisors) — the same on every hamster */
const INNER_EAR = 0xe8a0b0
const NOSE = 0xd97a8a
const TOOTH = 0xfdfaf2

/**
 * Colour strings from skins.ts are either `#rrggbb` or CSS Color 4 `hsl(H S% L%)`, which
 * THREE.Color.setStyle rejects (it only accepts the comma form) — so parse them here.
 */
export function parseColor(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const hex = value.trim()
  if (hex.startsWith('#')) {
    const body = hex.slice(1)
    if (body.length === 3) return parseInt(body[0] + body[0] + body[1] + body[1] + body[2] + body[2], 16)
    if (body.length === 6) return parseInt(body, 16)
    return fallback
  }
  const m = hex.match(/^hsla?\(\s*([-\d.]+)\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%/i)
  if (m) {
    const c = new THREE.Color()
    c.setHSL(((Number(m[1]) % 360) + 360) % 360 / 360, Number(m[2]) / 100, Number(m[3]) / 100)
    return c.getHex()
  }
  return fallback
}

/** Multiply a hex colour towards black (used for the tip of the tie). */
export function darken(color: number, k: number): number {
  const r = Math.round(((color >> 16) & 0xff) * k)
  const g = Math.round(((color >> 8) & 0xff) * k)
  const b = Math.round((color & 0xff) * k)
  return (r << 16) | (g << 8) | b
}

interface Geos {
  body: THREE.BufferGeometry
  head: THREE.BufferGeometry
  leg: THREE.BufferGeometry
  tail: THREE.BufferGeometry
  tie: THREE.BufferGeometry
  accessory: THREE.BufferGeometry | null
}

const cache = new Map<string, Geos>()

// Overlapping boxes are always offset by ~0.4 so two faces never land on the exact same plane —
// coplanar faces z-fight and flicker as the camera moves (the same rule the game follows).
function buildGeos(skin: Skin, tint: string, key: string): Geos {
  const hit = cache.get(key)
  if (hit) return hit
  const P: Palette = {
    ...BASE,
    fur: parseColor(skin.colors.f, BASE.fur),
    dark: parseColor(skin.colors.d, BASE.dark),
  }
  const tintC = parseColor(tint, 0xc98a45)

  // ---- body (quadruped coordinates: +y up, +z forward; stood upright by the caller) ----
  // Upright a box lands at y = BODY_Y + (its authoring z) and z = 21.5 - (its authoring y), so the
  // authoring depth becomes the standing height and the authoring height the front-to-back
  // thickness. 28 wide × 22 thick × 34 tall: a short round rodent barrel, not a cat's tube.
  const body = new VoxBuilder()
  body.box(0, 22, -2, 28, 22, 34, P.fur) // x ±14, y 11.5..45.5, z -11.5..10.5
  // belly: not the whole underside, only the chest-to-belly panel — upright it is the middle of
  // the front (y 20.5..41.5, half the width), standing 1 proud of the torso's z 10.5 face
  body.box(0, 12.5, 0.5, 15, 5, 21, P.belly)
  body.box(0, 20, 14.5, 16, 12, 4, P.belly) // chest rest under the chin, y 43..47
  // two bands across the shortened back, straddling its z -11.5 face and clear of the tail tuft
  body.box(0, 33.5, 1.5, 28.6, 3.4, 6, P.dark) // y 29..35
  body.box(0, 33.5, -7.5, 28.6, 3.4, 5, P.dark) // y 20.5..25.5

  // ---- head (its own group, never rotated: +y up, +z forward) ----
  const head = new VoxBuilder()
  head.box(0, 8, 3, 22, 18, 18, P.fur) // skull: x ±11, y -1..17, z -6..12
  // ears: low and round rather than the cat's tall triangles — a wide base under a smaller cap,
  // kept 0.3 inside the skull's x ±11 so no side face lands on the skull's own plane
  for (const sx of [-1, 1]) {
    head.box(sx * 7.2, 17.5, 0, 7, 5, 6, P.fur) // base, y 15..20
    head.box(sx * 7.2, 20, 0, 5, 2.5, 4.5, P.fur) // cap, y 18.75..21.25
    head.box(sx * 7.2, 17.5, 2.2, 4, 3, 3, INNER_EAR) // 0.7 proud of the ear's front face
  }
  // cheek pouches: the rodent tell. They bulge 1.5 past the skull's sides, with a fixed blush
  for (const sx of [-1, 1]) {
    head.box(sx * 10.5, 5.5, 5, 4, 8, 11, P.belly) // x 8.5..12.5, y 1.5..9.5, z -0.5..10.5
    head.box(sx * 12.8, 5.5, 6, 1.2, 3.4, 6, P.cheek)
  }
  head.box(-5.5, 10, 12.3, 4.4, 5.4, 1.6, P.eye)
  head.box(5.5, 10, 12.3, 4.4, 5.4, 1.6, P.eye)
  head.box(0, 4.5, 12.6, 10, 6, 2.4, P.belly) // muzzle
  head.box(0, 6.8, 13.6, 3.2, 2.4, 1.6, NOSE)
  // two incisors under the nose, 0.3 proud of the muzzle
  head.box(-1.2, 3.2, 13.6, 1.8, 2.2, 1, TOOTH)
  head.box(1.2, 3.2, 13.6, 1.8, 2.2, 1, TOOTH)

  // ---- one limb geometry, shared by both arms and both legs ----
  // Short: 11.6 from hip to sole. The column reaches 1 above its pivot so the hip stays buried in
  // the torso (whose underside is at y 11.5) through the whole walk swing.
  const leg = new VoxBuilder()
  leg.box(0, -4.5, 0, 8, 11, 8, P.fur) // y -10..1
  leg.box(0, -10.1, 0, 8.4, 3, 8.4, P.belly) // paw, y -11.6..-8.6

  // ---- tail: a blunt tuft on the rump, not the cat's mast ----
  const tail = new VoxBuilder()
  tail.box(0, 3.5, -2, 6, 6, 6, P.dark)
  tail.box(0, 6.5, -2, 4, 2.5, 4, P.fur)

  const geos: Geos = {
    body: body.build(),
    head: head.build(),
    leg: leg.build(),
    tail: tail.build(),
    tie: tieGeo(tintC),
    accessory: buildAccessory(skin.accessory),
  }
  cache.set(key, geos)
  return geos
}

/**
 * A small necktie on the chest, in body-group (upright) space rather than on the body mesh: the
 * body mesh is the part that gets rotated upright, while these coordinates are already upright.
 * The belly panel it hangs over spans y 20.5..41.5 with its front face at z 11.5, so the tie floats
 * a hair in front of it and never shares a plane. There is no collar — nothing rings the neck.
 */
function tieGeo(tint: number): THREE.BufferGeometry {
  const b = new VoxBuilder()
  b.box(0, 39.6, 12.8, 5, 3.4, 2.4, tint) // knot, right under the chin
  b.box(0, 32.4, 12.6, 4, 11.4, 2.0, tint) // body
  b.box(0, 25.8, 12.6, 5, 2.4, 2.0, darken(tint, 0.85)) // tip
  return b.build()
}

// Head space: the skull is 22 wide (x ±11), its top is y 17 and its front face z 12. The round
// ears stand at x ±7.2, y 15..21.25, z -3..3, with the pink inner ear reaching z 3.7; the cheek
// pouches fill x 8.5..12.5, y 1.5..9.5 (blush out to x 13.4, y 7.2). Everything below sits either
// in front of z 3.7 or clear of those blocks in y, so nothing intersects an ear or a pouch.
function buildAccessory(kind: SkinAccessory): THREE.BufferGeometry | null {
  if (kind === 'none') return null
  const h = new VoxBuilder()
  const gold: BoxOpt = { shade: 1.25 }
  if (kind === 'crown') {
    // A ring of four rails perched on the front half of the skull, between the ears and the brow,
    // so the fur shows through the middle. The back rail moved forward to z 5.3 to clear the
    // inner ear, which now pokes out to z 3.7.
    h.box(0, 18.6, 10.4, 15, 3.6, 2.6, 0xf5c231, gold)
    h.box(0, 18.6, 5.3, 15, 3.6, 2.6, 0xf5c231, gold)
    h.box(-6.2, 18.6, 7.85, 2.6, 3.6, 7.7, 0xf5c231, gold)
    h.box(6.2, 18.6, 7.85, 2.6, 3.6, 7.7, 0xf5c231, gold)
    h.box(-5.2, 21.2, 7.85, 3, 3, 3, 0xf5c231, gold)
    h.box(5.2, 21.2, 7.85, 3, 3, 3, 0xf5c231, gold)
    h.box(0, 21.2, 10.8, 3, 3, 3, 0xf5c231, gold)
    h.box(0, 21.2, 5.3, 3, 3, 3, 0xf5c231, gold)
    h.box(0, 18.8, 12.0, 2.6, 2.2, 1.4, 0xd8434e, { shade: 1.5 }) // jewel over the brow
  } else if (kind === 'glasses') {
    // lenses 0.2 in front of the eyes (eye front face z 13.1), rims a little further out; the
    // temple arms ride at y 10.6, just above the cheek pouches (whose top is y 9.5)
    const frame = 0x3a3330
    for (const sx of [-1, 1]) {
      h.box(sx * 5.5, 10, 13.7, 6.4, 6.4, 0.8, 0xd7ecf8, { shade: 1.3 }) // lens
      h.box(sx * 5.5, 13.4, 14.1, 8, 1.2, 1.2, frame) // rim: top, bottom, outer, inner
      h.box(sx * 5.5, 6.6, 14.1, 8, 1.2, 1.2, frame)
      h.box(sx * 8.9, 10, 14.1, 1.2, 8, 1.2, frame)
      h.box(sx * 2.1, 10, 14.1, 1.2, 8, 1.2, frame)
      h.box(sx * 10.9, 10.6, 10.5, 1.6, 1.4, 7, frame) // temple arm back along the skull
    }
    h.box(0, 10, 14.1, 3.4, 1.2, 1.2, frame) // bridge
  } else if (kind === 'headphones') {
    // band, posts and cups all live at z ≥ 4, in front of the ears (which stop at z 3.7); the cups
    // start at y 10, above the cheek pouches, and bite 0.4 into the skull's sides
    const band = 0x33383f
    h.box(0, 18.6, 6.5, 18, 3, 5, band)
    h.box(-10, 16.5, 6.5, 3.2, 6, 5, band)
    h.box(10, 16.5, 6.5, 3.2, 6, 5, band)
    for (const sx of [-1, 1]) h.box(sx * 13.6, 13.5, 7.5, 6, 7, 6, band)
  } else if (kind === 'leaf') {
    // a sprout in front of the ears, 0.2 into the skull
    h.box(0, 18.6, 5, 2.2, 3.6, 2.2, 0x6e4a33, W1)
    h.box(2.6, 21.4, 6.4, 9, 2.2, 6, 0x5fae54, LEAF)
    h.box(7.4, 22.6, 6.4, 4, 2, 4, 0x6ec25e, LEAF)
  }
  return h.isEmpty ? null : h.build()
}

export interface HamsterOptions {
  skin: Skin
  /** agent tint — the tie colour */
  tint: string
  /** the session's main hamster gets a slightly bigger frame */
  main: boolean
}

export function buildHamster({ skin, tint, main }: HamsterOptions, material: THREE.Material): HamsterRig {
  const key = `${skin.family}|${skin.accessory}|${tint}|${main}`
  const geos = buildGeos(skin, tint, key)

  const group = new THREE.Group()
  const mk = (geo: THREE.BufferGeometry): THREE.Mesh => {
    const m = new THREE.Mesh(geo, material)
    m.castShadow = true
    m.receiveShadow = true // without it a hamster in shade stays lit and floats off the deck
    return m
  }
  const bodyM = mk(geos.body)
  // stand the quadruped body up (-90° → the belly faces forward, the back stripes become bands
  // across the back). Torso spans y 11.5..45.5 / z -11.5..10.5; the head's underside (41.5) sinks
  // 4 into the top of it so the short neck reads as joined.
  bodyM.rotation.x = -Math.PI / 2
  bodyM.position.set(0, BODY_Y, 21.5)
  group.add(bodyM)
  const tieG = new THREE.Group()
  tieG.add(mk(geos.tie))
  group.add(tieG)

  const headG = new THREE.Group()
  // z = -1: half a unit ahead of the torso's middle (-0.5), the game's slight forward lean
  headG.position.set(0, HEAD_Y, -1)
  headG.add(mk(geos.head))
  if (geos.accessory) headG.add(mk(geos.accessory))
  group.add(headG)

  const legs: THREE.Group[] = []
  // arms (shoulder y 42, overlapping the ±14 torso by 1) then legs (hip y 11.6, soles on the floor)
  for (const [lx, ly, lz] of [[-17, ARM_Y, 0], [17, ARM_Y, 0], [-6, LEG_Y, 0], [6, LEG_Y, 0]]) {
    const g = new THREE.Group()
    g.position.set(lx, ly, lz)
    g.add(mk(geos.leg))
    group.add(g)
    legs.push(g)
  }

  const tailG = new THREE.Group()
  tailG.position.set(0, TAIL_Y, -9)
  tailG.rotation.x = -0.5 // the tuft still rises a little behind the rump
  tailG.add(mk(geos.tail))
  group.add(tailG)

  if (main) group.scale.setScalar(MAIN_SCALE)
  return { group, bodyM, tieG, headG, tailG, legs, headY: HEAD_Y, armY: ARM_Y, legY: LEG_Y, tailY: TAIL_Y, bodyY: BODY_Y }
}
