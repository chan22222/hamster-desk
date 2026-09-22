// The splash a thrown hamster makes when it hits the sea (grab.ts → DeskStudio): a ring spreading
// on the water and a handful of drops thrown up, all gone in under a second. three-only — the
// studio adds the group to its scene, ticks it every frame and disposes it when it is done.
import * as THREE from 'three'

export interface Splash {
  group: THREE.Group
  ring: THREE.Mesh
  drops: { mesh: THREE.Mesh; vx: number; vy: number; vz: number }[]
  ringMat: THREE.MeshBasicMaterial
  dropMat: THREE.MeshBasicMaterial
  dropGeo: THREE.BufferGeometry
  age: number
}

/** how long the whole thing lasts, seconds */
export const SPLASH_S = 0.8
/** the drops' own gravity — lighter than the hamster's, they hang a little */
const G = 900

export function makeSplash(x: number, y: number, z: number, rand: () => number = Math.random): Splash {
  const group = new THREE.Group()
  group.position.set(x, y, z)
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
  ringMat.toneMapped = false
  const ring = new THREE.Mesh(new THREE.RingGeometry(10, 16, 28), ringMat)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 1.5 // just over the water's own wave crests
  group.add(ring)
  const dropMat = new THREE.MeshBasicMaterial({ color: 0xeaf7fd, transparent: true, opacity: 1 })
  dropMat.toneMapped = false
  const dropGeo = new THREE.BoxGeometry(5, 5, 5)
  const drops: Splash['drops'] = []
  for (let k = 0; k < 9; k++) {
    const a = rand() * Math.PI * 2
    const s = 60 + rand() * 120
    const mesh = new THREE.Mesh(dropGeo, dropMat)
    group.add(mesh)
    drops.push({ mesh, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 180 + rand() * 200 })
  }
  return { group, ring, drops, ringMat, dropMat, dropGeo, age: 0 }
}

/** One frame; false once it is over and should be removed. */
export function tickSplash(s: Splash, dt: number): boolean {
  s.age += dt
  const k = Math.min(1, s.age / SPLASH_S)
  s.ring.scale.setScalar(1 + k * 3.5)
  s.ringMat.opacity = 0.9 * (1 - k)
  s.dropMat.opacity = 1 - k * k
  for (const d of s.drops) {
    d.mesh.position.x += d.vx * dt
    d.mesh.position.z += d.vz * dt
    d.mesh.position.y += d.vy * dt
    d.vy -= G * dt
    if (d.mesh.position.y < 0) {
      // back in the water: stays on the surface and fades with the rest
      d.mesh.position.y = 0
      d.vx = d.vy = d.vz = 0
    }
  }
  return s.age < SPLASH_S
}

export function disposeSplash(s: Splash): void {
  s.ring.geometry.dispose()
  s.ringMat.dispose()
  s.dropMat.dispose()
  s.dropGeo.dispose()
}
