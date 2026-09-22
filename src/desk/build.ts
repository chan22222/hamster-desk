// The construction site that plays when the studio is switched on (fold.ts, phase `build`): the
// island and the office rise out of the sea tile by tile, growing out from the middle — the floor
// first, then whatever stands on it, feet before heads, so walls and desks grow up out of their
// tiles (vox/material.ts `vxFoldLift` does the lifting; this module times it, throws up the dust
// where a tile lands and dresses the crew). The hamsters drop in from the sky in hard hats and
// hammer at their spots until the place is up; then the hats come off and the studio's render loop
// takes over, seating everybody where the store says. three-only, like blast.ts.
//
// Pantomime, like everything the fold plays: the store never hears of it, and nothing the crew
// wore or did survives the story's end.
import * as THREE from 'three'
import { Puffs } from './puffs'
import { BUILD_REST, landTime } from './fold'
import { OFFICE, OFFICE_TILE, T } from './office-world'
import type { StudioWorld } from './vox/world'
import { VoxBuilder, S3, W1 } from './vox/builder'
import { VOX_FOLD } from './vox/material'
import type { HamsterRig } from './vox/hamster'

const DUST_CAP = 200
const DUST: [number, number, number] = [0.8, 0.72, 0.58]
const DUST_END: [number, number, number] = [0.62, 0.58, 0.52]
const YELLOW = 0xf3c331
const BAND = 0xd9a520

interface Landing {
  at: number
  x: number
  y: number
  z: number
  /** an office deck tile throws more dust than a patch of grass */
  deck: boolean
}

export interface Build {
  dust: Puffs
  /** every tile that throws up dust when it lands, soonest first, and how far down the list we are */
  landings: Landing[]
  next: number
  /** the crew's gear by hamster: put on when it lands, taken off when the site is done */
  gear: Map<string, { rig: HamsterRig; hat: THREE.Mesh; hammer: THREE.Mesh }>
  /** who has hit the ground already (the thud's dust is thrown once) */
  landed: Set<string>
  rand: () => number
}

/**
 * Which tiles throw up dust: every deck tile of the office, and a third of the grass outside it —
 * all of them would be a haze that hides the rising, and the pool is only so big.
 */
export function makeBuild(world: StudioWorld, rand: () => number = Math.random): Build {
  const landings: Landing[] = []
  const i0 = OFFICE_TILE.i
  const i1 = OFFICE_TILE.i + OFFICE.W
  const j0 = OFFICE_TILE.j
  const j1 = OFFICE_TILE.j + OFFICE.D
  world.land.forEach((row, ty) => {
    row.forEach((on, tx) => {
      if (!on) return
      const deck = tx >= i0 && tx < i1 && ty >= j0 && ty < j1
      // every other deck tile, a third of the grass: the tiles at one distance land together, and
      // all of them would pile the dust into a solid heap at the middle
      if (deck ? (tx + ty) % 2 !== 0 : (tx + ty) % 3 !== 0) return
      const x = (tx + 0.5) * T
      const z = (ty + 0.5) * T
      const y = world.heights[ty][tx]
      landings.push({ at: landTime(x, z, y), x, y, z, deck })
    })
  })
  landings.sort((a, b) => a.at - b.at)
  return { dust: new Puffs(DUST_CAP, true, rand), landings, next: 0, gear: new Map(), landed: new Set(), rand }
}

function puffDust(b: Build, x: number, y: number, z: number, n: number, up: number): void {
  const { rand } = b
  for (let k = 0; k < n && b.dust.free > 0; k++) {
    const a = rand() * Math.PI * 2
    const out = 40 + rand() * 70
    b.dust.spawn({
      x: x + (rand() - 0.5) * 24, y: y + 3, z: z + (rand() - 0.5) * 24,
      vx: Math.cos(a) * out, vz: Math.sin(a) * out, vy: up * (0.7 + rand() * 0.6),
      life: 0.6 + rand() * 0.3, size0: 3, size1: 11 + rand() * 9,
      color: DUST, color1: DUST_END, gravity: 40, drag: 2,
    })
  }
}

/** One frame, `t` seconds in: the world's clock, and dust for every tile that has landed since last frame. */
export function tickBuild(b: Build, t: number, dt: number): void {
  VOX_FOLD.build.value = t
  while (b.next < b.landings.length && b.landings[b.next].at <= t) {
    const l = b.landings[b.next++]
    puffDust(b, l.x, l.y, l.z, 1, l.deck ? 55 : 40)
  }
  b.dust.tick(dt)
}

/** A hamster hit its tile: the thud's dust, once. */
export function thud(b: Build, id: string, x: number, y: number, z: number): void {
  if (b.landed.has(id)) return
  b.landed.add(id)
  puffDust(b, x, y, z, 6, 70)
}

// ---- the crew's gear ------------------------------------------------------------------------
let hatGeo: THREE.BufferGeometry | null = null
let hammerGeo: THREE.BufferGeometry | null = null

/**
 * A hard hat, in head space (vox/hamster.ts: the skull is 22 wide, its top y 17, its front z 12;
 * the round ears stand at x ±7.2, y 15..21.25, z out to 3.7). It sits on the front half of the
 * skull, clear of the ears, and bites 0.4 into the skull top so it never floats — the beret's rule.
 */
function hat(): THREE.BufferGeometry {
  if (hatGeo) return hatGeo
  const h = new VoxBuilder()
  h.box(0, 17.4, 8.6, 21, 1.6, 9.4, YELLOW, { shade: 1.05 }) // brim, y 16.6..18.2, z 3.9..13.3
  h.box(0, 19.6, 8.6, 15, 3.2, 7.4, YELLOW) // crown, y 18..21.2
  h.box(0, 21.6, 8.6, 9, 1.4, 5, YELLOW, { shade: 1.1 }) // top, y 20.9..22.3
  h.box(0, 22.6, 8.6, 2.4, 1.2, 6.4, BAND) // the ridge
  hatGeo = h.build()
  return hatGeo
}

/**
 * A mallet, in limb space (the pivot is the shoulder; the paw is at y −11.6..−8.6): the handle runs
 * on down from the paw and the head sits across its end, so a raised arm holds it over the head
 * and a swung one brings it down on the work.
 */
function hammer(): THREE.BufferGeometry {
  if (hammerGeo) return hammerGeo
  const m = new VoxBuilder()
  m.box(0, -19, 0, 2.4, 16, 2.4, 0x8a5e33, W1) // handle, y −27..−11 (its top buried in the paw)
  m.box(0, -28.5, 0, 5, 5, 10, 0x6b7280, S3) // head
  hammerGeo = m.build()
  return hammerGeo
}

/** Dress a hamster that has landed: a hard hat on its head and a mallet in its near paw. Idempotent per rig. */
export function wearGear(b: Build, id: string, rig: HamsterRig, material: THREE.Material): void {
  const have = b.gear.get(id)
  if (have?.rig === rig) return
  if (have) dropGear(b, id) // the rig was rebuilt under it (a model change): dress the new one
  const hatM = new THREE.Mesh(hat(), material)
  hatM.castShadow = true
  rig.headG.add(hatM)
  const hammerM = new THREE.Mesh(hammer(), material)
  hammerM.castShadow = true
  rig.legs[0].add(hammerM)
  b.gear.set(id, { rig, hat: hatM, hammer: hammerM })
}

/** The site is done, or the hamster is gone: gear off. */
export function dropGear(b: Build, id: string): void {
  const g = b.gear.get(id)
  if (!g) return
  g.rig.headG.remove(g.hat)
  g.rig.legs[0].remove(g.hammer)
  b.gear.delete(id)
}

export function disposeBuild(b: Build): void {
  for (const id of [...b.gear.keys()]) dropGear(b, id)
  b.dust.dispose()
  VOX_FOLD.build.value = BUILD_REST
}
