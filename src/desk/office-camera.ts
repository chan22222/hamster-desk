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

/**
 * Put a world point just below the middle of the screen, the way the old 2D view framed a desk.
 * `dy` is how far below centre; the automatic camera drops it further to leave room for the feed
 * of bubbles that stacks above a hamster's head. ⌂ and the follow menu keep the original offset.
 */
export function focusCamera(c: Camera, world: { x: number; z: number }, w: number, h: number, scale = 2.5, dy = 10): void {
  c.scale = clampScale(scale)
  centerOn(c, world.x, world.z, w / 2, h / 2 + dy, w, h)
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

/** auto-framing never zooms in past this close-up of a desk, and never out past a full room */
export const FRAME_MAX_SCALE = 3.4
/**
 * A full room (every seat and the desk in front of it, padded) fits at 0.60–0.66 in the usual
 * desk viewports; the floor is deliberately above that, so a crowded room spills a little at the
 * edges rather than shrinking every hamster to a speck.
 */
export const FRAME_MIN_SCALE = 0.75
/** the strip along the bottom the controls bar sits in */
const FRAME_BOTTOM_PAD = 44

/**
 * How many rows of a hamster's chat feed are worth drawing at this zoom (0 = hide the feed).
 * The bubbles are DOM at a fixed pixel size, so what changes with the zoom is not their legibility
 * but how much of the scene they would bury: a room seen from far away can carry the newest line,
 * a desk close-up can carry the whole stack. DeskStudio's render loop and the automatic framing
 * both read this, which is what keeps "what is shown" and "what is left room for" in step.
 */
export function feedLines(scale: number): number {
  if (scale >= 2.2) return 4
  if (scale >= 1.5) return 3
  if (scale >= 1.1) return 2
  if (scale >= 0.8) return 1
  return 0
}
/** rough on-screen height of one feed row plus its gap */
export const FEED_LINE_PX = 26

/**
 * Below this zoom the nameplates come off. It is the bottom of `feedLines`' two-row band on
 * purpose: the automatic framing settles at 117% for a boss plus three colleagues, and a room
 * where you can read what everyone is saying but not who is saying it is the worse trade.
 */
export const PLATE_MIN_SCALE = 1.1

/**
 * The strip of sky a framing keeps clear above the hamsters' heads. It scales with the number of
 * rows, not with the zoom — a row is the same number of pixels however close the camera is — and
 * never eats more than a fifth of a short viewport.
 */
export function frameHeadPad(h: number, lines: number): number {
  if (lines <= 0) return 0
  return Math.max(0, Math.min(lines * FEED_LINE_PX + 10, h * 0.18, h - FRAME_BOTTOM_PAD - 40))
}

/**
 * Frame a set of hamsters: the tightest overview that shows all of `bounds`, but never closer than
 * `maxScale` and never farther than `minScale`.
 *
 * Two passes, because the head room and the close-up pull against each other. The first fits the
 * bounds into the whole frame — that answers "how close could we possibly get?" — and that zoom
 * says how many feed rows will be drawn. The second pass reserves exactly that many rows' worth of
 * sky and fits again; the subject then sits in the middle of the band below it, which is what
 * pushes it down the screen. A wide shot of a crowded room shows one line and pays for one line.
 *
 * One re-fit is enough, and deliberately so: reserving room can only zoom *out*, so the row count
 * can only fall, and a strip sized for four rows is simply a little extra sky for three. Iterating
 * to a fixed point would trade that harmless slack for a framing that oscillates between buckets
 * whenever the subject sits on a boundary. The single case worth undoing is falling all the way to
 * no rows at all — a crowded room pushed onto the floor scale — because then the strip bought
 * nothing: the first pass is both closer and still shows a line, so it wins outright.
 */
export function frameCamera(
  c: Camera,
  bounds: Bounds,
  w: number,
  h: number,
  minScale = FRAME_MIN_SCALE,
  maxScale = FRAME_MAX_SCALE,
): void {
  const fit = (top: number): number => {
    overviewCamera(c, bounds, w, h, top, FRAME_BOTTOM_PAD)
    return Math.max(minScale, Math.min(maxScale, c.scale))
  }
  let top = 0
  let scale = fit(0)
  const lines = feedLines(scale)
  if (lines > 0) {
    const pad = frameHeadPad(h, lines)
    const padded = fit(pad)
    if (feedLines(padded) > 0) {
      top = pad
      scale = padded
    }
  }
  c.scale = scale
  centerOn(c, (bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2, w / 2, top + (h - top - FRAME_BOTTOM_PAD) / 2, w, h)
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
