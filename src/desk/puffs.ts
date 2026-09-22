// Little box particles for the two stories the fold switch plays (blast.ts, build.ts): dust off
// a tile slamming into place, ash off a hamster, the fire and smoke of the cloud. The studio is
// voxels, so its smoke is boxes too. Everything is instanced — a pool of a few hundred puffs is
// one draw call, and a puff that is not alive simply is not counted — and nothing fades: a puff
// grows, drifts and shrinks back to nothing, which reads as dissipating and needs no per-instance
// opacity. Colours are per instance (`instanceColor`), so one pool holds tan dust and black ash.
import * as THREE from 'three'

const clamp01 = (k: number): number => (k < 0 ? 0 : k > 1 ? 1 : k)

/** A pool of unit boxes placed one by one. `set` them, then `commit` the count. */
export class InstancedBoxes {
  readonly mesh: THREE.InstancedMesh
  private readonly geo = new THREE.BoxGeometry(1, 1, 1)
  private readonly mat: THREE.Material
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private readonly c = new THREE.Color()
  private n = 0

  /** `lit` puffs take the sun and the shade like the voxels around them; unlit ones glow flat (fire). */
  constructor(readonly cap: number, lit: boolean) {
    this.mat = lit ? new THREE.MeshLambertMaterial({ color: 0xffffff }) : new THREE.MeshBasicMaterial({ color: 0xffffff })
    if (!lit) this.mat.toneMapped = false
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // instanceColor only exists once something has been set; give every slot white up front so
    // the shader is compiled with it from the first frame
    for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, this.c.setRGB(1, 1, 1))
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false // the instances go wherever the story sends them
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    this.mesh.count = 0
  }

  /** Place slot `i`: a box `size` across, turned by `rot` about every axis, in colour (r, g, b). */
  set(i: number, x: number, y: number, z: number, size: number, rot: number, r: number, g: number, b: number): void {
    this.e.set(rot, rot * 1.3, rot * 0.7)
    this.q.setFromEuler(this.e)
    this.p.set(x, y, z)
    this.s.setScalar(Math.max(0, size))
    this.m.compose(this.p, this.q, this.s)
    this.mesh.setMatrixAt(i, this.m)
    this.mesh.setColorAt(i, this.c.setRGB(r, g, b))
    if (i >= this.n) this.n = i + 1
  }

  /** Draw the first `count` slots (everything `set` since the last commit when omitted). */
  commit(count = this.n): void {
    this.mesh.count = count
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.n = 0
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
    this.mesh.dispose()
  }
}

export interface PuffSpec {
  x: number
  y: number
  z: number
  vx?: number
  vy?: number
  vz?: number
  /** seconds alive */
  life?: number
  /** size at birth and at its fullest (it is back to nothing at the end of its life) */
  size0?: number
  size1?: number
  /** colour at birth and at death, as [r, g, b] in 0..1 */
  color: readonly [number, number, number]
  color1?: readonly [number, number, number]
  /** world units/s² pulling it down (negative: it rises like hot air) */
  gravity?: number
  /** per-second share of its velocity it loses */
  drag?: number
  /** radians/s it turns */
  spin?: number
}

interface Puff extends Required<PuffSpec> {
  age: number
  rot: number
}

/** A pool of free-flying puffs: spawn them, tick them, they look after themselves. */
export class Puffs {
  readonly boxes: InstancedBoxes
  private live: Puff[] = []

  constructor(cap: number, lit: boolean, private readonly rand: () => number = Math.random) {
    this.boxes = new InstancedBoxes(cap, lit)
  }

  get mesh(): THREE.InstancedMesh {
    return this.boxes.mesh
  }

  get count(): number {
    return this.live.length
  }

  /** Room for this many more before the pool is full. */
  get free(): number {
    return this.boxes.cap - this.live.length
  }

  /** Add a puff; a full pool drops it (a story that wants more dust than this is not worth a bigger pool). Returns whether it was taken. */
  spawn(spec: PuffSpec): boolean {
    if (this.live.length >= this.boxes.cap) return false
    this.live.push({
      vx: 0, vy: 0, vz: 0, life: 1, size0: 6, size1: 24, gravity: 0, drag: 0, spin: 1.5,
      color1: spec.color,
      ...spec,
      age: 0,
      rot: this.rand() * Math.PI * 2,
    })
    return true
  }

  /** One frame for every puff; the dead are dropped and the rest placed. */
  tick(dt: number): void {
    let n = 0
    for (let k = this.live.length - 1; k >= 0; k--) {
      const p = this.live[k]
      p.age += dt
      if (p.age >= p.life) {
        this.live.splice(k, 1)
        continue
      }
      const keep = Math.max(0, 1 - p.drag * dt)
      p.vx *= keep
      p.vz *= keep
      p.vy = p.vy * keep - p.gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      p.rot += p.spin * dt
      const u = p.age / p.life
      // quick to full size, then gone over the last third
      const grow = Math.sqrt(clamp01(u / 0.3))
      const shrink = u < 0.66 ? 1 : 1 - ((u - 0.66) / 0.34) ** 2
      const size = (p.size0 + (p.size1 - p.size0) * grow) * shrink
      const c0 = p.color
      const c1 = p.color1
      this.boxes.set(n++, p.x, p.y, p.z, size, p.rot, c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u)
    }
    this.boxes.commit(n)
  }

  dispose(): void {
    this.live = []
    this.boxes.dispose()
  }
}
