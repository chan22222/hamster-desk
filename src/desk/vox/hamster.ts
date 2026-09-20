// The hamster itself: a biped voxel rig assembled exactly like the reference game's standing cat
// (voxel.js buildCat with biped = true). The body is authored in quadruped coordinates and then
// stood upright, so local +y becomes the back and local +z becomes up — accessories written in
// body space keep working whichever way the mesh is turned.
//
// Origin is between the feet, the hamster faces +z, and every part group is positioned so the
// animation code in DeskStudio can offset from the exported headY / armY / legY / tailY / bodyY.
import * as THREE from 'three'
import { VoxBuilder, W1, LEAF, type BoxOpt } from './builder'
import type { Skin, SkinAccessory } from '../skins'

export interface HamsterRig {
  group: THREE.Group
  bodyM: THREE.Mesh
  /** the scarf rides the body: sitting drops the torso and the collar has to come with it */
  scarfG: THREE.Group
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
/** roughly the top of the ears, for glyphs and bubbles */
export const HAMSTER_H = 72

interface Palette {
  fur: number
  dark: number
  belly: number
  eye: number
  nose: number
  innerEar: number
  cheek: number
}

/** Inherited from the old pixel palette so the studio still reads as the same hamster. */
const BASE: Palette = {
  fur: 0xf6d19b,
  dark: 0xd99e58,
  belly: 0xfff6e9,
  eye: 0x221812,
  nose: 0xe8848f,
  innerEar: 0xf6b3b8,
  cheek: 0xf79a93,
}

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

/** Multiply a hex colour towards black (used for the knot of the scarf). */
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
  scarf: THREE.BufferGeometry
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
  body.box(0, 22, -2, 28, 22, 38, P.fur) // chunky: hamsters are round, not lean like the cat
  body.box(0, 13.2, 1, 15, 5, 20, P.belly) // belly panel (the front once upright)
  body.box(0, 20, 16.5, 16, 12, 4, P.belly) // chest bib under the chin
  body.box(0, 33.4, -8, 28.6, 3.4, 6, P.dark) // saddle bands across the back
  body.box(0, 33.4, -16, 28.6, 3.4, 5, P.dark)

  // ---- head (its own group, never rotated: +y up, +z forward) ----
  const head = new VoxBuilder()
  head.box(0, 8, 3, 22, 18, 20, P.fur)
  head.box(0, 17.2, 1, 18, 3, 15, P.dark) // darker fur over the crown, 0.7 proud of the skull
  for (const sx of [-1, 1]) {
    head.box(sx * 11, 4.5, 4, 5, 10, 12, P.belly) // cheek pouch, stuffed
    head.box(sx * 13.6, 4.5, 5, 1.2, 3.4, 6, P.cheek) // blush on the outside of the pouch
    // round ears: two stacked boxes instead of the cat's triangle, with a pink inner shell
    head.box(sx * 8, 18.6, 0, 8, 5, 7, P.dark)
    head.box(sx * 8, 21.6, 0, 5.6, 3.2, 5, P.dark)
    head.box(sx * 8, 19.4, 2.4, 4, 5.4, 3.6, P.innerEar)
    head.box(sx * 5.5, 10, 13.3, 4, 5, 1.6, P.eye)
    head.box(sx * 6.4, 11.6, 14.3, 1.2, 1.2, 1.2, 0xffffff, { shade: 1.6 }) // catch light
  }
  head.box(0, 5, 13.2, 12, 7, 3, P.belly) // snout
  head.box(0, 7.4, 15.1, 4, 2.6, 2, P.nose)
  head.box(-1.2, 4.2, 14.9, 1.8, 2.2, 1, 0xfdfaf2) // front teeth
  head.box(1.2, 4.2, 14.9, 1.8, 2.2, 1, 0xfdfaf2)

  // ---- one limb geometry, shared by both arms and both legs ----
  const leg = new VoxBuilder()
  // the fur column's bottom face is lifted 0.4 into the paw box so the two never share a plane
  leg.box(0, -6.8, 0, 8, 13.6, 8, P.fur)
  leg.box(0, -12.4, 0, 8.4, 3, 8.4, P.belly)

  // ---- tail: a short hamster stub, not the cat's mast ----
  const tail = new VoxBuilder()
  tail.box(0, 2.4, 0, 5, 5, 5, P.dark)
  tail.box(0, 5.4, 0, 3.4, 2.2, 3.4, P.fur)

  const geos: Geos = {
    body: body.build(),
    head: head.build(),
    leg: leg.build(),
    tail: tail.build(),
    scarf: scarfGeo(tintC),
    accessory: buildAccessory(skin.accessory),
  }
  cache.set(key, geos)
  return geos
}

/**
 * The scarf lives in body-group space (the game's `scarf.fnB`), not on the body mesh: the body
 * mesh is the part that gets rotated upright, while these coordinates are already upright.
 */
function scarfGeo(tint: number): THREE.BufferGeometry {
  const b = new VoxBuilder()
  // Wider than the head, so it shows as a ring around the neck, but shallower than the snout —
  // a collar as deep as the game's would swallow the face from this camera.
  b.box(0, 48.6, 0, 33, 6, 23, tint)
  b.box(0, 45.6, 12, 13, 5, 3.4, tint) // knot on the chest
  b.box(4, 39.5, 12, 6, 10, 3.4, darken(tint, 0.82)) // the end hanging down
  b.box(4, 34.3, 12, 6, 2, 3.4, 0xf0e6d8)
  return b.build()
}

function buildAccessory(kind: SkinAccessory): THREE.BufferGeometry | null {
  if (kind === 'none') return null
  const h = new VoxBuilder()
  const gold: BoxOpt = { shade: 1.25 }
  if (kind === 'crown') {
    // The game's crown is a filled disc, which from this camera turns into a gold plate covering
    // the whole skull. A ring of four rails leaves the fur showing through the middle instead.
    h.box(0, 18.8, 9.8, 17, 3.6, 2.6, 0xf5c231, gold)
    h.box(0, 18.8, -3.8, 17, 3.6, 2.6, 0xf5c231, gold)
    h.box(-7.2, 18.8, 3, 2.6, 3.6, 11, 0xf5c231, gold)
    h.box(7.2, 18.8, 3, 2.6, 3.6, 11, 0xf5c231, gold)
    h.box(-6, 21.4, 3, 3, 3, 3, 0xf5c231, gold)
    h.box(6, 21.4, 3, 3, 3, 3, 0xf5c231, gold)
    h.box(0, 21.4, 8.4, 3, 3, 3, 0xf5c231, gold)
    h.box(0, 21.4, -2.4, 3, 3, 3, 0xf5c231, gold)
    h.box(0, 19.0, 11.4, 2.6, 2.2, 1.4, 0xd8434e, { shade: 1.5 })
  } else if (kind === 'glasses') {
    const frame = 0x3a3330
    for (const sx of [-1, 1]) {
      h.box(sx * 5.7, 10, 14.7, 6.4, 6.4, 0.8, 0xd7ecf8, { shade: 1.3 }) // lens
      h.box(sx * 5.7, 13.4, 15.1, 8, 1.2, 1.2, frame) // rim: top, bottom, outer, inner
      h.box(sx * 5.7, 6.6, 15.1, 8, 1.2, 1.2, frame)
      h.box(sx * 9.1, 10, 15.1, 1.2, 8, 1.2, frame)
      h.box(sx * 2.3, 10, 15.1, 1.2, 8, 1.2, frame)
      h.box(sx * 10.8, 10, 12, 1.6, 1.4, 7, frame) // temple arm back towards the ear
    }
    h.box(0, 10, 15.1, 3.4, 1.2, 1.2, frame) // bridge
  } else if (kind === 'headphones') {
    const band = 0x33383f
    h.box(0, 18.6, 6, 18, 3, 5, band)
    h.box(-10, 16.5, 6, 3.2, 6, 5, band)
    h.box(10, 16.5, 6, 3.2, 6, 5, band)
    for (const sx of [-1, 1]) h.box(sx * 14.6, 12, 2, 6, 8, 5, band)
  } else if (kind === 'leaf') {
    h.box(0, 18.6, 2, 2.2, 3.6, 2.2, 0x6e4a33, W1)
    h.box(2.6, 21.4, 3.4, 9, 2.2, 6, 0x5fae54, LEAF)
    h.box(7.4, 22.6, 3.4, 4, 2, 4, 0x6ec25e, LEAF)
  }
  return h.isEmpty ? null : h.build()
}

export interface HamsterOptions {
  skin: Skin
  /** agent tint — the scarf colour */
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
  // stand the quadruped body up: local +y → back (-z), local +z → up
  bodyM.rotation.x = -Math.PI / 2
  bodyM.position.set(0, BODY_Y, 21.5)
  group.add(bodyM)
  const scarfG = new THREE.Group()
  scarfG.add(mk(geos.scarf))
  group.add(scarfG)

  const headG = new THREE.Group()
  headG.position.set(0, HEAD_Y, -1)
  headG.add(mk(geos.head))
  if (geos.accessory) headG.add(mk(geos.accessory))
  group.add(headG)

  const legs: THREE.Group[] = []
  for (const [lx, ly, lz] of [[-16, ARM_Y, 0], [16, ARM_Y, 0], [-6, LEG_Y, 0], [6, LEG_Y, 0]]) {
    const g = new THREE.Group()
    g.position.set(lx, ly, lz)
    g.add(mk(geos.leg))
    group.add(g)
    legs.push(g)
  }

  const tailG = new THREE.Group()
  tailG.position.set(0, TAIL_Y, -9)
  tailG.rotation.x = -0.5
  tailG.add(mk(geos.tail))
  group.add(tailG)

  if (main) group.scale.setScalar(1.1)
  return { group, bodyM, scarfG, headG, tailG, legs, headY: HEAD_Y, armY: ARM_Y, legY: LEG_Y, tailY: TAIL_Y, bodyY: BODY_Y }
}
