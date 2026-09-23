// Camera state and the ray/projection math around it. A camera is an orbit rig: it always looks
// at a point on the office deck plane (tx, H_OFFICE, tz) from `distanceFor(scale)` away, at the
// given yaw/pitch. Every navigation gesture is expressed as "keep this ground point under that
// pixel", which is what makes dragging and zooming feel like moving the world rather than the lens.
//
// No DOM here — only three's vector math — so the node test can exercise it.
import * as THREE from 'three'
import { BUBBLE_H, H_OFFICE } from './office-world'

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

/**
 * The camera's position and its right / up / forward axes in world space, as plain numbers.
 *
 * Everything below projects through this, and the automatic framing projects a great deal: a
 * bisection is thirty-odd fits of four corners each, and it used to run every frame while anybody
 * walked. As Vector3s that was thousands of short-lived objects a frame, so the math is spelt out
 * on numbers and the scratch copy below is reused; a caller that projects many points through one
 * camera (the studio's overlay) computes a basis once and hands it in.
 */
export interface Basis {
  px: number; py: number; pz: number
  rx: number; ry: number; rz: number
  ux: number; uy: number; uz: number
  fx: number; fy: number; fz: number
}
export const makeBasis = (): Basis => ({ px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, ux: 0, uy: 0, uz: 0, fx: 0, fy: 0, fz: 0 })

/** Fill `out` with the camera's basis. `forward` points from the camera at the target; `right` is level. */
export function basisOf(c: Camera, out: Basis = makeBasis()): Basis {
  const cp = Math.cos(c.pitch)
  const sp = Math.sin(c.pitch)
  const sy = Math.sin(c.yaw)
  const cy = Math.cos(c.yaw)
  const d = distanceFor(c.scale)
  out.px = c.tx + sy * cp * d
  out.py = H_OFFICE + sp * d
  out.pz = c.tz + cy * cp * d
  out.fx = -sy * cp
  out.fy = -sp
  out.fz = -cy * cp
  // right = forward × world up, which is level; up = right × forward (both already unit length,
  // but normalised anyway so rounding never skews a long bisection)
  const rl = Math.hypot(out.fz, out.fx) || 1
  out.rx = -out.fz / rl
  out.ry = 0
  out.rz = out.fx / rl
  const ux = out.ry * out.fz - out.rz * out.fy
  const uy = out.rz * out.fx - out.rx * out.fz
  const uz = out.rx * out.fy - out.ry * out.fx
  const ul = Math.hypot(ux, uy, uz) || 1
  out.ux = ux / ul
  out.uy = uy / ul
  out.uz = uz / ul
  return out
}

/** the functions below project through this when the caller has no basis of its own */
const scratch = makeBasis()

const TAN_HALF = Math.tan((FOV / 2) * (Math.PI / 180))

/** Ray through a viewport pixel: the camera's position and the unit direction, as numbers. */
function rayThrough(c: Camera, sx: number, sy: number, w: number, h: number): { px: number; py: number; pz: number; dx: number; dy: number; dz: number } {
  const b = basisOf(c, scratch)
  const ndcX = (sx / Math.max(1, w)) * 2 - 1
  const ndcY = 1 - (sy / Math.max(1, h)) * 2
  const aspect = Math.max(1e-6, w / Math.max(1, h))
  const kx = ndcX * TAN_HALF * aspect
  const ky = ndcY * TAN_HALF
  const dx = b.fx + b.rx * kx + b.ux * ky
  const dy = b.fy + b.ry * kx + b.uy * ky
  const dz = b.fz + b.rz * kx + b.uz * ky
  const l = Math.hypot(dx, dy, dz) || 1
  return { px: b.px, py: b.py, pz: b.pz, dx: dx / l, dy: dy / l, dz: dz / l }
}

/** Where the pixel's ray meets the horizontal plane at height `y`, or null when it points at the sky. */
export function planeHit(c: Camera, sx: number, sy: number, w: number, h: number, y: number): { x: number; z: number } | null {
  const r = rayThrough(c, sx, sy, w, h)
  if (Math.abs(r.dy) < 1e-6) return null
  const t = (y - r.py) / r.dy
  if (t <= 0) return null
  return { x: r.px + r.dx * t, z: r.pz + r.dz * t }
}

/** Where the pixel's ray meets the office deck plane, or null when it points at the sky. */
export function groundHit(c: Camera, sx: number, sy: number, w: number, h: number): { x: number; z: number } | null {
  return planeHit(c, sx, sy, w, h, H_OFFICE)
}

/**
 * World point → viewport pixel. `behind` is true when the point is out of the frustum's front.
 * `b` is the camera's basis if the caller already has it (`basisOf`) — it must be this camera's.
 */
export function worldToScreen(c: Camera, p: { x: number; y: number; z: number }, w: number, h: number, b: Basis = basisOf(c, scratch)): { x: number; y: number; behind: boolean } {
  const vx = p.x - b.px
  const vy = p.y - b.py
  const vz = p.z - b.pz
  const zc = vx * b.fx + vy * b.fy + vz * b.fz
  if (zc <= 1e-4) return { x: 0, y: 0, behind: true }
  const aspect = Math.max(1e-6, w / Math.max(1, h))
  const ndcX = (vx * b.rx + vy * b.ry + vz * b.rz) / (zc * TAN_HALF * aspect)
  const ndcY = (vx * b.ux + vy * b.uy + vz * b.uz) / (zc * TAN_HALF)
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
 * `dy` is how far below centre. Manual gestures (the follow menu, a double-click, the minimap) use
 * it; the automatic framing does not — it measures where the heads actually land instead, in
 * `autoFrameCamera`, because a fixed pixel drop is wrong at every viewport height but one.
 */
export function focusCamera(c: Camera, world: { x: number; z: number }, w: number, h: number, scale = 2.5, dy = 10): void {
  c.scale = clampScale(scale)
  centerOn(c, world.x, world.z, w / 2, h / 2 + dy, w, h)
  c.initialized = true
}

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

/** `overviewCamera`'s own basis (the one `worldToScreen` falls back to is busy inside `centerOn`) */
const fitBasis = makeBasis()

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
    const b = basisOf(c, fitBasis) // one basis for the four corners
    return corners.every((p) => {
      const s = worldToScreen(c, p, w, h, b)
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
/** how much empty floor the automatic framing leaves around each hamster before it fits them */
export const FRAME_PAD = 44
/**
 * A full room (every seat and the desk in front of it, padded) fits at 0.60–0.66 in the usual
 * desk viewports; the floor is deliberately above that, so a crowded room spills a little at the
 * edges rather than shrinking every hamster to a speck.
 */
export const FRAME_MIN_SCALE = 0.75
/** the strip along the bottom the controls bar sits in */
const FRAME_BOTTOM_PAD = 44
/**
 * The band along the top the studio draws its header into (the live dot, the title, the status
 * counts). A feed row that reaches into it is unreadable, so the automatic framing keeps the whole
 * stack below it.
 */
export const HEADER_PAD = 56

/**
 * How many rows of a hamster's chat feed are worth drawing at this zoom (0 = hide the feed).
 * The bubbles are DOM at a fixed pixel size, so what changes with the zoom is not their legibility
 * but how much of the scene they would bury: a room seen from far away can carry the newest line,
 * a desk close-up can carry the whole stack. DeskStudio's render loop and the automatic framing
 * both read this, which is what keeps "what is shown" and "what is left room for" in step.
 *
 * The one-row band starts at `FRAME_MIN_SCALE` exactly, not above it: the automatic framing never
 * goes further out than that floor, so however crowded the room (or narrow the pane beside the
 * terminal), the automatic view always carries each hamster's newest line. With the band at 80%
 * a four-hamster room beside the terminal settled at 75% and said nothing at all.
 */
export function feedLines(scale: number): number {
  if (scale >= 2.2) return 4
  if (scale >= 1.5) return 3
  if (scale >= 1.1) return 2
  if (scale >= FRAME_MIN_SCALE) return 1
  return 0
}
/** on-screen height of a one-line feed row plus its gap */
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
 * no rows at all, because then the strip bought nothing: the first pass is both closer and still
 * shows a line, so it wins outright. (At the default floor that cannot happen any more — the floor
 * scale itself carries a row, `feedLines` — but a caller may pass a lower `minScale`.)
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

/**
 * Slack on top of `lines * FEED_LINE_PX`. A row that wraps onto a second line is ~6px taller than
 * the one-line row that constant describes, and a four-row stack measures 118px against the 104
 * the constant predicts — so the framing budgets for the stack being a little taller than nominal
 * rather than clipping its top row.
 */
const FEED_SLACK = 18

/**
 * Take the framing pad back off every side, never past the middle: what is left is the ground the
 * hamsters actually stand on, which is what the head and foot measurements below have to use.
 */
export function frameSubject(b: Bounds, pad = FRAME_PAD): Bounds {
  const x = Math.min(pad, (b.maxX - b.minX) / 2)
  const z = Math.min(pad, (b.maxZ - b.minZ) / 2)
  return { minX: b.minX + x, maxX: b.maxX - x, minZ: b.minZ + z, maxZ: b.maxZ - z }
}

const groundCorners = (b: Bounds): { x: number; z: number }[] => [
  { x: b.minX, z: b.minZ },
  { x: b.maxX, z: b.minZ },
  { x: b.maxX, z: b.maxZ },
  { x: b.minX, z: b.maxZ },
]

/** Screen y of the highest chat-bubble anchor over `bounds` — the pixel a feed stacks up from. */
export function feedAnchorY(c: Camera, bounds: Bounds, w: number, h: number): number | null {
  const b = basisOf(c, fitBasis)
  let top: number | null = null
  for (const q of groundCorners(bounds)) {
    const p = worldToScreen(c, { x: q.x, y: H_OFFICE + BUBBLE_H, z: q.z }, w, h, b)
    if (p.behind) continue
    if (top === null || p.y < top) top = p.y
  }
  return top
}

/** Screen y of the nearest edge of `bounds` on the floor — the lowest pixel of the subject. */
function groundBottomY(c: Camera, bounds: Bounds, w: number, h: number): number | null {
  const b = basisOf(c, fitBasis)
  let bottom: number | null = null
  for (const q of groundCorners(bounds)) {
    const p = worldToScreen(c, { x: q.x, y: H_OFFICE, z: q.z }, w, h, b)
    if (p.behind) continue
    if (bottom === null || p.y > bottom) bottom = p.y
  }
  return bottom
}

/** How far down the screen the top of a `lines`-row stack sits, for an anchor at `anchor`. */
export const feedTopY = (anchor: number, lines: number): number => anchor - lines * FEED_LINE_PX - FEED_SLACK

/** Slide the ground so whatever sits at the middle of the screen moves `dy` pixels down it. */
function dropBy(c: Camera, dy: number, w: number, h: number): void {
  panCamera(c, { x: w / 2, y: h / 2 }, { x: w / 2, y: h / 2 + dy }, w, h)
}

/**
 * The framing both the automatic camera and ⌂ use.
 *
 * `frameCamera` alone only ever reasons about the floor, so the strip it reserves is measured from
 * the ground under the hamsters — but the bubbles hang from a point `BUBBLE_H` above it, which is a
 * different number of pixels at every zoom and every viewport height. In a 700px-tall desk that
 * slack was generous and in the app's default 420 it was not, so the top rows of a four-row stack
 * were drawn off the top of the canvas or under the header.
 *
 * So: fit as before, then project that anchor and push the view down until the stack above it
 * clears `HEADER_PAD`. Panning can only bury the subject's feet, so if that pushes the nearest
 * hamster off the bottom of the canvas, give a little zoom back and try again. (Off the canvas, not
 * merely under the controls bar: that pill floats in a corner, and paying real zoom — and with it
 * feed rows — to keep a desk out from behind it is the worse trade.) When even the floor scale
 * cannot hold both, the head wins — a hamster with its feet cropped still says what it is doing,
 * one with its bubbles cropped does not.
 *
 * Both measurements are taken on the bounds with `pad` taken back off: the caller inflates every
 * hamster by `FRAME_PAD` so the fit leaves some floor around the room, and measuring the heads over
 * a padded corner where nobody stands would reserve sky for a hamster that is not there.
 */
export function autoFrameCamera(
  c: Camera,
  bounds: Bounds,
  w: number,
  h: number,
  minScale = FRAME_MIN_SCALE,
  maxScale = FRAME_MAX_SCALE,
  pad = FRAME_PAD,
): void {
  const subject = frameSubject(bounds, pad)
  let cap = maxScale
  for (let attempt = 0; attempt < 6; attempt++) {
    frameCamera(c, bounds, w, h, minScale, cap)
    // perspective: the ear tips move a slightly different number of pixels than the ground does,
    // so close in on the answer rather than solving it
    for (let k = 0; k < 4; k++) {
      const top = feedAnchorY(c, subject, w, h)
      if (top === null) break
      const short = HEADER_PAD - feedTopY(top, feedLines(c.scale))
      if (short <= 0.5) break
      dropBy(c, short, w, h)
    }
    const bottom = groundBottomY(c, subject, w, h)
    if (bottom === null || bottom <= h || c.scale <= minScale + 1e-6) break
    cap = Math.max(minScale, c.scale * 0.94)
  }
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
    const r = rayThrough(c, sx, sy, w, h)
    return { x: r.px + r.dx * 3000, z: r.pz + r.dz * 3000 }
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
