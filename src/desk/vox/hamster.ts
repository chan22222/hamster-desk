// The hamster itself: the reference game's standing cat, box for box (voxel.js `buildCat` with
// biped = true). Body, head, limb and tail geometry and the assembly offsets are copied verbatim —
// the only additions are the palette hook (fur/dark come from the model skin), a small necktie in
// the agent's colour, and the head accessories that mark the model family.
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

export const HEAD_Y = 48.5
export const ARM_Y = 48
export const LEG_Y = 14
export const TAIL_Y = 15
export const BODY_Y = 33.5
/** the tip of the ears: head group y 48.5 + ear top (19 + 4), for glyphs and bubbles */
export const HAMSTER_H = HEAD_Y + 23

interface Palette {
  fur: number
  dark: number
  belly: number
  eye: number
}

/**
 * Fur and back stripes keep the studio's hamster tan (skins.ts overrides them per model); the
 * belly and eye tones are the game's cat palette so the face reads exactly like the game's.
 */
const BASE: Palette = {
  fur: 0xf6d19b,
  dark: 0xd99e58,
  belly: 0xf9e2c0,
  eye: 0x252a33,
}
/** the game's fixed accent colours (inner ear, nose) — the same on every cat */
const INNER_EAR = 0xe8a0b0
const NOSE = 0xd97a8a

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
  const body = new VoxBuilder()
  body.box(0, 22, -2, 26, 20, 40, P.fur)
  // belly: not the whole underside, only the chest-to-belly panel (13×20) — once upright it is
  // the middle of the front (y 24.5..44.5, half the width), not the entire face of the torso
  body.box(0, 13.5, 1, 13, 5, 20, P.belly)
  body.box(0, 20, 17.5, 14, 12, 4, P.belly)
  body.box(0, 32.5, -8, 26.6, 3.4, 6, P.dark)
  body.box(0, 32.5, -17, 26.6, 3.4, 5, P.dark)

  // ---- head (its own group, never rotated: +y up, +z forward) ----
  const head = new VoxBuilder()
  head.box(0, 8, 3, 22, 18, 18, P.fur)
  head.box(-7, 19, 0, 6, 8, 4, P.fur)
  head.box(7, 19, 0, 6, 8, 4, P.fur)
  head.box(-7, 18, 1.2, 3, 4, 3, INNER_EAR)
  head.box(7, 18, 1.2, 3, 4, 3, INNER_EAR)
  head.box(-5.5, 10, 12.3, 4.4, 5.4, 1.6, P.eye)
  head.box(5.5, 10, 12.3, 4.4, 5.4, 1.6, P.eye)
  head.box(0, 4.5, 12.6, 10, 6, 2.4, P.belly)
  head.box(0, 6.8, 13.6, 3.2, 2.4, 1.6, NOSE)

  // ---- one limb geometry, shared by both arms and both legs ----
  const leg = new VoxBuilder()
  // the fur column's bottom face is lifted 0.4 into the paw box so the two never share a plane
  leg.box(0, -6.8, 0, 7.5, 13.6, 7.5, P.fur)
  leg.box(0, -12.5, 0, 7.9, 3, 7.9, P.belly)

  // ---- tail: the cat's mast, tipped with the dark colour ----
  const tail = new VoxBuilder()
  tail.box(0, 7, -2, 5, 15, 5, P.fur)
  tail.box(0, 15.5, -2, 5.4, 4, 5.4, P.dark)

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
 * The belly panel it hangs over spans y 24.5..44.5 with its front face at z 10.5, so the tie floats
 * a hair in front of it and never shares a plane. There is no collar — nothing rings the neck.
 */
function tieGeo(tint: number): THREE.BufferGeometry {
  const b = new VoxBuilder()
  b.box(0, 44.6, 11.8, 5, 3.4, 2.4, tint) // knot
  b.box(0, 37.2, 11.6, 4, 11.4, 2.0, tint) // body
  b.box(0, 30.6, 11.6, 5, 2.4, 2.0, darken(tint, 0.85)) // tip
  return b.build()
}

// Head space: the skull is 22 wide (x ±11), its top is y 17 and its front face z 12; the ears
// stand at x ±7, y 15..23, z -2..2. Everything below sits 0.2..0.4 into the skull or in front of
// the ears, so nothing intersects an ear or lands on one of its faces.
function buildAccessory(kind: SkinAccessory): THREE.BufferGeometry | null {
  if (kind === 'none') return null
  const h = new VoxBuilder()
  const gold: BoxOpt = { shade: 1.25 }
  if (kind === 'crown') {
    // A ring of four rails perched on the front half of the skull, between the ears and the brow,
    // so the fur shows through the middle and the ears stay clear.
    h.box(0, 18.6, 10.4, 15, 3.6, 2.6, 0xf5c231, gold)
    h.box(0, 18.6, 4.4, 15, 3.6, 2.6, 0xf5c231, gold)
    h.box(-6.2, 18.6, 7.4, 2.6, 3.6, 8.6, 0xf5c231, gold)
    h.box(6.2, 18.6, 7.4, 2.6, 3.6, 8.6, 0xf5c231, gold)
    h.box(-5.2, 21.2, 7.4, 3, 3, 3, 0xf5c231, gold)
    h.box(5.2, 21.2, 7.4, 3, 3, 3, 0xf5c231, gold)
    h.box(0, 21.2, 10.8, 3, 3, 3, 0xf5c231, gold)
    h.box(0, 21.2, 4.0, 3, 3, 3, 0xf5c231, gold)
    h.box(0, 18.8, 12.0, 2.6, 2.2, 1.4, 0xd8434e, { shade: 1.5 }) // jewel over the brow
  } else if (kind === 'glasses') {
    // lenses 0.2 in front of the eyes (eye front face z 13.1), rims a little further out
    const frame = 0x3a3330
    for (const sx of [-1, 1]) {
      h.box(sx * 5.5, 10, 13.7, 6.4, 6.4, 0.8, 0xd7ecf8, { shade: 1.3 }) // lens
      h.box(sx * 5.5, 13.4, 14.1, 8, 1.2, 1.2, frame) // rim: top, bottom, outer, inner
      h.box(sx * 5.5, 6.6, 14.1, 8, 1.2, 1.2, frame)
      h.box(sx * 8.9, 10, 14.1, 1.2, 8, 1.2, frame)
      h.box(sx * 2.1, 10, 14.1, 1.2, 8, 1.2, frame)
      h.box(sx * 10.9, 10, 10.5, 1.6, 1.4, 7, frame) // temple arm back along the skull
    }
    h.box(0, 10, 14.1, 3.4, 1.2, 1.2, frame) // bridge
  } else if (kind === 'headphones') {
    // band over the front half of the skull (in front of the ears), cups 0.4 into the sides
    const band = 0x33383f
    h.box(0, 18.6, 6, 18, 3, 5, band)
    h.box(-10, 16.5, 6, 3.2, 6, 5, band)
    h.box(10, 16.5, 6, 3.2, 6, 5, band)
    for (const sx of [-1, 1]) h.box(sx * 13.6, 12, 4, 6, 8, 5, band)
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
  // across the back). Torso spans y 11.5..51.5 / z -10.5..9.5; the head's underside (47.5) sinks
  // 4 into the top of it so the neck reads as joined.
  bodyM.rotation.x = -Math.PI / 2
  bodyM.position.set(0, BODY_Y, 21.5)
  group.add(bodyM)
  const tieG = new THREE.Group()
  tieG.add(mk(geos.tie))
  group.add(tieG)

  const headG = new THREE.Group()
  // z = -1: two ahead of the torso's middle (-3), the game's slight forward lean of the head
  headG.position.set(0, HEAD_Y, -1)
  headG.add(mk(geos.head))
  if (geos.accessory) headG.add(mk(geos.accessory))
  group.add(headG)

  const legs: THREE.Group[] = []
  // arms (shoulder y 48, overlapping the ±13 torso by 0.75) then legs (hip y 14)
  for (const [lx, ly, lz] of [[-16, ARM_Y, 0], [16, ARM_Y, 0], [-6, LEG_Y, 0], [6, LEG_Y, 0]]) {
    const g = new THREE.Group()
    g.position.set(lx, ly, lz)
    g.add(mk(geos.leg))
    group.add(g)
    legs.push(g)
  }

  const tailG = new THREE.Group()
  tailG.position.set(0, TAIL_Y, -9)
  tailG.rotation.x = -0.5 // rising at a slant behind the back
  tailG.add(mk(geos.tail))
  group.add(tailG)

  if (main) group.scale.setScalar(1.1)
  return { group, bodyM, tieG, headG, tailG, legs, headY: HEAD_Y, armY: ARM_Y, legY: LEG_Y, tailY: TAIL_Y, bodyY: BODY_Y }
}
