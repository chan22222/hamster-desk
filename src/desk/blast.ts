// The nuclear blast that plays when the studio is switched off (fold.ts, phase `blast`): a white-out,
// a fireball at ground zero, a shockwave racing across the deck and out over the water — levelling
// everything it passes (the voxel world drops away behind it: vox/material.ts `vxFoldLift`) and
// wiping out every hamster it reaches — and a mushroom cloud standing over the island until the
// studio folds away under it. three-only: the studio adds the group to its scene, ticks it every
// frame and disposes it when the story ends. What the wave does to a hamster is decided here
// (`doomOf`) but applied to its rig by the studio's render loop, the one thing that poses rigs.
//
// Pantomime, like everything the fold plays: the store never hears of it, and the studio puts every
// rig back the way it was when the blast is over — or cut short by a fresh unfold.
import * as THREE from 'three'
import { InstancedBoxes, Puffs } from './puffs'
import { BLAST, CENTRE, fireball, mushroom, ringAlpha, shockRadius } from './fold'
import { H_OFFICE } from './office-world'

/** how far out the wave keeps throwing up dust — past the island's edge, into the sea */
const DUST_REACH = 1400
/**
 * The cloud: this many puffs up the stem, this many round the cap. The envelope is fixed; the box
 * size is the look. The first cloud was 58 crates (a stack of boxes, not smoke), the one after it
 * 1200 grains (fine enough to lose the voxel look, and 1200 instances to move every frame). This
 * is the geometric middle of the two sizes (the `size` lines in `tickBlast`), with the count that
 * keeps the cloud as dense as the grains did (count × size² held): still billowing, visibly boxes.
 * One instanced draw either way.
 */
const STEM_N = 60
const CAP_N = 160
/** the pool for the wave's dust and the hamsters' ash */
const SMOKE_CAP = 220

const FIRE: [number, number, number] = [1.0, 0.62, 0.2]
const EMBER: [number, number, number] = [0.85, 0.32, 0.08]
const SMOKE: [number, number, number] = [0.46, 0.43, 0.41]
const DUST: [number, number, number] = [0.78, 0.7, 0.56]
const DUST_END: [number, number, number] = [0.5, 0.47, 0.44]
const SPRAY: [number, number, number] = [0.86, 0.95, 1.0]
const SPRAY_END: [number, number, number] = [0.7, 0.85, 0.95]
const ASH: [number, number, number] = [0.2, 0.18, 0.17]
const ASH_END: [number, number, number] = [0.42, 0.4, 0.38]

/** one box of the cloud: where it sits in the cloud's own frame (angle, radial share, height share) */
interface CloudPuff {
  a: number
  r: number
  v: number
  seed: number
  cap: boolean
}

export interface Blast {
  group: THREE.Group
  ball: THREE.Mesh
  ballMat: THREE.MeshBasicMaterial
  ballGeo: THREE.BufferGeometry
  ring: THREE.Mesh
  ringMat: THREE.MeshBasicMaterial
  ringGeo: THREE.BufferGeometry
  cloud: InstancedBoxes
  cloudPuffs: CloudPuff[]
  /** dust along the wave and ash off the hamsters — lit, like the ground they came off */
  smoke: Puffs
  /** the wave's radius last frame, so this frame's dust is laid along the arc it swept since */
  lastRing: number
  /** each hamster the wave has reached, and when */
  doomed: Map<string, number>
  rand: () => number
}

/** height of the ground at a world point, or null over the sea */
export type GroundAt = (x: number, z: number) => number | null

export function makeBlast(rand: () => number = Math.random): Blast {
  const group = new THREE.Group()
  const ballGeo = new THREE.SphereGeometry(1, 24, 16)
  const ballMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false })
  ballMat.toneMapped = false
  const ball = new THREE.Mesh(ballGeo, ballMat)
  ball.position.set(CENTRE.x, CENTRE.y + 40, CENTRE.z)
  ball.visible = false
  group.add(ball)
  const ringGeo = new THREE.RingGeometry(0.9, 1, 72)
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
  ringMat.toneMapped = false
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.rotation.x = -Math.PI / 2
  ring.position.set(CENTRE.x, H_OFFICE + 3, CENTRE.z) // just over the deck, under the desks
  ring.visible = false
  group.add(ring)
  const cloud = new InstancedBoxes(STEM_N + CAP_N, true)
  group.add(cloud.mesh)
  const cloudPuffs: CloudPuff[] = []
  for (let i = 0; i < STEM_N; i++) cloudPuffs.push({ a: rand() * Math.PI * 2, r: 0.2 + rand() * 0.8, v: (i + rand() * 0.6) / STEM_N, seed: rand(), cap: false })
  for (let i = 0; i < CAP_N; i++) cloudPuffs.push({ a: rand() * Math.PI * 2, r: 0.3 + rand() * 0.7, v: rand(), seed: rand(), cap: true })
  const smoke = new Puffs(SMOKE_CAP, true, rand)
  group.add(smoke.mesh)
  return { group, ball, ballMat, ballGeo, ring, ringMat, ringGeo, cloud, cloudPuffs, smoke, lastRing: 0, doomed: new Map(), rand }
}

const mix = (a: readonly [number, number, number], b: readonly [number, number, number], k: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

/** One frame, `t` seconds in. `ground` says what the wave's dust comes off (sand, grass — or sea spray). */
export function tickBlast(b: Blast, t: number, dt: number, ground: GroundAt, seaY: number): void {
  const { rand } = b
  // ---- the fireball: white, then yellow, then a dull ember as it thins out --------------------
  const f = fireball(t)
  b.ball.visible = f.alpha > 0
  if (b.ball.visible) {
    b.ball.scale.setScalar(f.r)
    b.ballMat.opacity = f.alpha
    const c = f.heat < 0.2 ? mix([1, 1, 0.9], [1, 0.78, 0.3], f.heat / 0.2) : mix([1, 0.78, 0.3], [0.95, 0.35, 0.08], (f.heat - 0.2) / 0.8)
    b.ballMat.color.setRGB(c[0], c[1], c[2])
  }
  // ---- the shockwave, and the dust it kicks up along the way -------------------------------
  const R = shockRadius(t)
  const ra = ringAlpha(t)
  b.ring.visible = R > 0 && ra > 0
  if (b.ring.visible) {
    b.ring.scale.set(R, R, 1)
    b.ringMat.opacity = 0.9 * ra
  }
  if (R > b.lastRing && R < DUST_REACH) {
    const n = Math.min(b.smoke.free, 7)
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2
      const r = b.lastRing + rand() * (R - b.lastRing)
      const x = CENTRE.x + Math.cos(a) * r
      const z = CENTRE.z + Math.sin(a) * r
      const g = ground(x, z)
      const out = 60 + rand() * 90
      b.smoke.spawn({
        x, y: g ?? seaY, z,
        vx: Math.cos(a) * out, vz: Math.sin(a) * out, vy: 80 + rand() * 90,
        life: 1.0 + rand() * 0.5, size0: 5, size1: 16 + rand() * 12,
        color: g === null ? SPRAY : DUST, color1: g === null ? SPRAY_END : DUST_END,
        gravity: 60, drag: 1.2,
      })
    }
    b.lastRing = R
  }
  // ---- the mushroom cloud ------------------------------------------------------------------
  const m = mushroom(t)
  if (m.body <= 0) {
    b.cloud.commit(0)
  } else {
    const lift = (1 - m.body) * 160 // as it thins out it drifts up and away
    const spin = t * 0.25
    let n = 0
    for (const p of b.cloudPuffs) {
      let x: number, y: number, z: number, size: number, smoke: number
      if (p.cap) {
        // a squashed dome on top of the stem, rolling outward as it grows; its underside stays lit longest
        const capH = m.cap * 0.55
        const rr = m.cap * p.r
        x = CENTRE.x + Math.cos(p.a + spin) * rr
        z = CENTRE.z + Math.sin(p.a + spin) * rr
        y = CENTRE.y + m.stem + capH * (0.2 + 0.6 * p.v) * Math.sqrt(1 - p.r * p.r * 0.8)
        size = m.cap * (0.14 + 0.084 * p.seed) * (1 - 0.35 * p.r)
        smoke = Math.min(1, m.smoke * (0.6 + 0.6 * p.v))
      } else {
        // the stem: narrow at the foot, fatter up top, its foot still glowing
        const rr = m.cap * (0.22 + 0.18 * p.v) * p.r
        x = CENTRE.x + Math.cos(p.a + spin * 0.6) * rr
        z = CENTRE.z + Math.sin(p.a + spin * 0.6) * rr
        y = CENTRE.y + 20 + m.stem * p.v
        size = m.cap * (0.13 + 0.07 * p.seed) * (0.7 + 0.3 * p.v)
        smoke = Math.min(1, m.smoke * (0.4 + 0.8 * p.v))
      }
      const c = smoke < 0.5 ? mix(FIRE, EMBER, smoke * 2) : mix(EMBER, SMOKE, (smoke - 0.5) * 2)
      b.cloud.set(n++, x, y + lift, z, size * m.body, p.seed * 6 + t * 0.3, c[0], c[1], c[2])
    }
    b.cloud.commit(n)
  }
  b.smoke.tick(dt)
}

/**
 * Has the wave reached the hamster standing at (x, z)? The first frame it has, this records the
 * moment and says `fresh` (the studio throws its ash then); after that, how long ago. A hamster
 * that turns up after the wave has passed is caught the moment it does.
 */
export function doomOf(b: Blast, id: string, x: number, z: number, t: number): { age: number; fresh: boolean } | null {
  const at = b.doomed.get(id)
  if (at !== undefined) return { age: t - at, fresh: false }
  if (shockRadius(t) < Math.hypot(x - CENTRE.x, z - CENTRE.z)) return null
  b.doomed.set(id, t)
  return { age: 0, fresh: true }
}

/** What a hamster leaves behind: a burst of ash, thrown the way the wave is going. */
export function ashBurst(b: Blast, x: number, y: number, z: number): void {
  const { rand } = b
  const dx = x - CENTRE.x
  const dz = z - CENTRE.z
  const len = Math.hypot(dx, dz) || 1
  for (let k = 0; k < 12 && b.smoke.free > 0; k++) {
    const out = 80 + rand() * 140
    const side = (rand() - 0.5) * 160
    b.smoke.spawn({
      x, y: y + rand() * 30, z,
      vx: (dx / len) * out + (-dz / len) * side, vz: (dz / len) * out + (dx / len) * side, vy: 120 + rand() * 140,
      life: 0.8 + rand() * 0.4, size0: 5, size1: 16 + rand() * 8,
      color: ASH, color1: ASH_END, gravity: 140, drag: 1.5, spin: 4,
    })
  }
}

export function disposeBlast(b: Blast): void {
  b.ballGeo.dispose()
  b.ballMat.dispose()
  b.ringGeo.dispose()
  b.ringMat.dispose()
  b.cloud.dispose()
  b.smoke.dispose()
}

/** the constants the studio reads to time what it does itself (the flash, the shake, the doom) */
export { BLAST }
