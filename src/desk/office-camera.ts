// Camera state and the ray/projection math around it. A camera is an orbit rig: it always looks
// at a point on the office deck plane (tx, H_OFFICE, tz) from `distanceFor(scale)` away, at the
// given yaw/pitch. Every navigation gesture is expressed as "keep this ground point under that
// pixel", which is what makes dragging and zooming feel like moving the world rather than the lens.
//
// No DOM here — only three's vector math — so the node test can exercise it.
import * as THREE from 'three'
import { H_OFFICE } from './office-world'

export interface Camera {
  scale: number
  tx: number
  tz: number
  yaw: number
  pitch: number
  initialized: boolean
}

export const FOV = 42
export const NEAR = 1
export const FAR = 6000
export const MIN_SCALE = 0.15
export const MAX_SCALE = 5
const MIN_PITCH = (25 * Math.PI) / 180
const MAX_PITCH = (70 * Math.PI) / 180

/** 100% ≈ 480 units away: at that distance a hamster is about a fifth of a 520px viewport. */
export const distanceFor = (scale: number): number => 1200 / scale

export const createCamera = (): Camera => ({
  scale: 2.5,
  tx: 0,
  tz: 0,
  // looking north-west from the south-east, the way the old isometric room was drawn
  yaw: Math.PI / 4,
  pitch: (38 * Math.PI) / 180,
  initialized: false,
})

const dirOf = (c: Camera): THREE.Vector3 =>
  new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch))

export const cameraTarget = (c: Camera): THREE.Vector3 => new THREE.Vector3(c.tx, H_OFFICE, c.tz)

export function cameraPosition(c: Camera): THREE.Vector3 {
  return cameraTarget(c).addScaledVector(dirOf(c), distanceFor(c.scale))
}

/** right / up / forward basis of the camera, in world space */
function basis(c: Camera): { pos: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 } {
  const pos = cameraPosition(c)
  const forward = dirOf(c).multiplyScalar(-1) // from the camera towards the target
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
  const up = new THREE.Vector3().crossVectors(right, forward).normalize()
  return { pos, right, up, forward }
}

const tanHalf = (): number => Math.tan((FOV / 2) * (Math.PI / 180))

/** Ray direction through a viewport pixel. */
function rayThrough(c: Camera, sx: number, sy: number, w: number, h: number): { pos: THREE.Vector3; dir: THREE.Vector3 } {
  const { pos, right, up, forward } = basis(c)
  const t = tanHalf()
  const ndcX = (sx / Math.max(1, w)) * 2 - 1
  const ndcY = 1 - (sy / Math.max(1, h)) * 2
  const aspect = Math.max(1e-6, w / Math.max(1, h))
  const dir = forward
    .clone()
    .addScaledVector(right, ndcX * t * aspect)
    .addScaledVector(up, ndcY * t)
    .normalize()
  return { pos, dir }
}

/** Where the pixel's ray meets the office deck plane, or null when it points at the sky. */
export function groundHit(c: Camera, sx: number, sy: number, w: number, h: number): { x: number; z: number } | null {
  const { pos, dir } = rayThrough(c, sx, sy, w, h)
  if (Math.abs(dir.y) < 1e-6) return null
  const t = (H_OFFICE - pos.y) / dir.y
  if (t <= 0) return null
  return { x: pos.x + dir.x * t, z: pos.z + dir.z * t }
}

/** World point → viewport pixel. `behind` is true when the point is out of the frustum's front. */
export function worldToScreen(c: Camera, p: { x: number; y: number; z: number }, w: number, h: number): { x: number; y: number; behind: boolean } {
  const { pos, right, up, forward } = basis(c)
  const v = new THREE.Vector3(p.x - pos.x, p.y - pos.y, p.z - pos.z)
  const zc = v.dot(forward)
  if (zc <= 1e-4) return { x: 0, y: 0, behind: true }
  const t = tanHalf()
  const aspect = Math.max(1e-6, w / Math.max(1, h))
  const ndcX = v.dot(right) / (zc * t * aspect)
  const ndcY = v.dot(up) / (zc * t)
  return { x: (ndcX * 0.5 + 0.5) * w, y: (0.5 - ndcY * 0.5) * h, behind: false }
}

/** Slide the target so the ground point (x, z) lands under the pixel (px, py). */
function centerOn(c: Camera, x: number, z: number, px: number, py: number, w: number, h: number): void {
  c.tx = x
  c.tz = z
  const hit = groundHit(c, px, py, w, h)
  if (!hit) return
  c.tx += x - hit.x
  c.tz += z - hit.z
}

const clampScale = (s: number): number => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))

/** Put a world point just below the middle of the screen, the way the old 2D view framed a desk. */
export function focusCamera(c: Camera, world: { x: number; z: number }, w: number, h: number, scale = 2.5): void {
  c.scale = clampScale(scale)
  centerOn(c, world.x, world.z, w / 2, h / 2 + 10, w, h)
  c.initialized = true
}

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

/**
 * Frame the whole island. The projected footprint of a plan rectangle depends on yaw and pitch in
 * a way that is annoying to invert, so bisect on scale instead: "does every corner still fit?" is
 * monotonic, and 30 steps land within a fraction of a percent.
 */
export function overviewCamera(c: Camera, bounds: Bounds, w: number, h: number, topPad = 56, bottomPad = 44, sidePad = 24): void {
  const cx = (bounds.minX + bounds.maxX) / 2
  const cz = (bounds.minZ + bounds.maxZ) / 2
  const corners = [
    { x: bounds.minX, y: H_OFFICE, z: bounds.minZ },
    { x: bounds.maxX, y: H_OFFICE, z: bounds.minZ },
    { x: bounds.maxX, y: H_OFFICE, z: bounds.maxZ },
    { x: bounds.minX, y: H_OFFICE, z: bounds.maxZ },
  ]
  const midY = topPad + (h - topPad - bottomPad) / 2
  const fits = (scale: number): boolean => {
    c.scale = scale
    centerOn(c, cx, cz, w / 2, midY, w, h)
    return corners.every((p) => {
      const s = worldToScreen(c, p, w, h)
      return !s.behind && s.x >= sidePad && s.x <= w - sidePad && s.y >= topPad && s.y <= h - bottomPad
    })
  }
  let lo = MIN_SCALE
  let hi = MAX_SCALE
  if (!fits(lo)) hi = lo
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  fits(lo)
  c.initialized = true
}

/** Zoom about the cursor: the ground point under it must not move. */
export function zoomCamera(c: Camera, scale: number, sx: number, sy: number, w: number, h: number): void {
  const before = groundHit(c, sx, sy, w, h)
  c.scale = clampScale(scale)
  const after = groundHit(c, sx, sy, w, h)
  if (before && after) {
    c.tx += before.x - after.x
    c.tz += before.z - after.z
  }
  c.initialized = true
}

/** Drag the ground: whatever was under the pointer when the drag started follows it. */
export function panCamera(c: Camera, from: { x: number; y: number }, to: { x: number; y: number }, w: number, h: number): void {
  const a = groundHit(c, from.x, from.y, w, h)
  const b = groundHit(c, to.x, to.y, w, h)
  if (!a || !b) return
  c.tx += a.x - b.x
  c.tz += a.z - b.z
}

export function orbitCamera(c: Camera, dyaw: number, dpitch: number): void {
  c.yaw += dyaw
  c.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, c.pitch + dpitch))
}

/** The quad of ground the viewport currently covers, for the minimap. */
export function viewportGroundPolygon(c: Camera, w: number, h: number, topPad = 56, bottomPad = 44): { x: number; z: number }[] {
  const pixels: [number, number][] = [
    [0, topPad],
    [w, topPad],
    [w, h - bottomPad],
    [0, h - bottomPad],
  ]
  return pixels.map(([sx, sy]) => {
    const hit = groundHit(c, sx, sy, w, h)
    if (hit) return hit
    // the ray escaped above the horizon — draw it out to a plausible distance instead
    const { pos, dir } = rayThrough(c, sx, sy, w, h)
    return { x: pos.x + dir.x * 3000, z: pos.z + dir.z * 3000 }
  })
}

export function applyTo(threeCamera: THREE.PerspectiveCamera, c: Camera, w: number, h: number): void {
  const pos = cameraPosition(c)
  threeCamera.fov = FOV
  threeCamera.near = NEAR
  threeCamera.far = FAR
  threeCamera.aspect = Math.max(1e-6, w / Math.max(1, h))
  threeCamera.position.set(pos.x, pos.y, pos.z)
  threeCamera.lookAt(c.tx, H_OFFICE, c.tz)
  threeCamera.updateProjectionMatrix()
}
