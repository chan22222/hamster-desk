// The framed Spritfy prints on the office's walls. The world builder lays the voxel frames and
// the dark backings (props.ts `signFrame` / `signFrameL`) and hands the spots over in
// `StudioWorld.signs`; this module paints the picture — the logo PNG over two caption lines on a
// dark card — into a canvas and hangs it at each spot as a textured plane. They are the only
// surfaces in the office that are not voxels, and the reason this lives outside vox/: it needs an
// Image, a 2D canvas and a Material, none of which the node test can have.
//
// The prints are also the one thing in the room a click does something with, so they behave like
// buttons under the pointer: `setSignHot` marks the one under the cursor and `tickSignHover`,
// called every frame, eases the picture up towards the viewer, a touch larger and lit from within,
// and back again when the pointer leaves.
//
// The facts on the card come from the product's own repository (README.md, index.html and
// landing-copy.ts): the name "Spritfy", the site https://spritfy.xyz, and the owner's own
// one-line description of the tool.
import * as THREE from 'three'
import type { WallSign } from './vox/world'
// `?inline` makes this a data: URL rather than a file next to the bundle. A packaged app loads
// its renderer from file://, where Chromium treats every file as its own origin: an <img> from
// there taints the canvas it is drawn on, and WebGL refuses a tainted canvas as a texture. A data
// URL is same-origin everywhere, and the CSP already allows `img-src data:`.
import logoUrl from '../assets/spritfy-logo.png?inline'
import { ui } from '../i18n'

export const SPRITFY_URL = 'https://spritfy.xyz/'
const SITE = 'spritfy.xyz'
/** the app's own text stack (styles.css), so the card's type matches the UI around the scene */
const FONT = "'Pretendard', 'Pretendard Variable', system-ui, -apple-system, 'Malgun Gothic', sans-serif"

/**
 * Texture size: the print's 100:60 shape, wide enough to hold the 700 px logo at its native size
 * so its pixel blocks stay whole (a resample would smear the pixel art it is advertising). Both
 * prints are this shape, so one texture serves them; the larger one is simply the same card at
 * 1.4×, which still leaves it more than a texel per pixel at any zoom the studio allows.
 */
const TEX_W = 768
const TEX_H = 460

// ---- the hover, as a button would do it ------------------------------------------------------
/** ms for the ease in and out */
export const HOVER_MS = 120
/** how far the picture comes out of its frame towards the viewer, in world units */
const HOVER_LIFT = 2.5
/** and how much it grows */
const HOVER_SCALE = 0.03
/** the card lit from within at full hover: the picture's own colours, added at this strength */
const HOVER_GLOW = 0.55

export interface HungSign {
  mesh: THREE.Mesh
  /** what a click on it opens */
  url: string
  /** the spot it hangs at (the world's data; `mesh` moves off it while hovered) */
  spot: WallSign
  /** the pointer is over it */
  hot: boolean
  /** the eased hover, 0 at rest and 1 fully lifted */
  hover: number
  /**
   * How far below its spot a fold story has it (fold.ts `foldLift`), 0 at rest. The hover pose
   * is built on top of it, so a print still easing back from the pointer when a blast begins
   * sinks with its wall instead of being put back on it every frame of the ease.
   */
  drop: number
}

/** The card, with or without the logo (it decodes asynchronously; the card repaints when it lands). */
function paintCard(g: CanvasRenderingContext2D, logo: HTMLImageElement | null): void {
  // the black-purple the site itself is set on, shading down so the card reads as paper, not a hole
  const bg = g.createLinearGradient(0, 0, 0, TEX_H)
  bg.addColorStop(0, '#1c1632')
  bg.addColorStop(1, '#0e0b17')
  g.fillStyle = bg
  g.fillRect(0, 0, TEX_W, TEX_H)
  // a hairline mat just inside the rails
  g.strokeStyle = 'rgba(196, 181, 253, 0.30)'
  g.lineWidth = 3
  g.strokeRect(14, 14, TEX_W - 28, TEX_H - 28)
  if (logo) g.drawImage(logo, (TEX_W - logo.width) / 2, 24)
  g.textAlign = 'center'
  g.textBaseline = 'alphabetic'
  g.fillStyle = '#f4f1ff'
  g.font = `700 48px ${FONT}`
  g.fillText(ui().studio.signCaption, TEX_W / 2, 346) // the language at the time it is painted: `repaintSigns` paints it again
  // the site's lavender, lifted a step: at the wall's slant the darker tint fell below reading
  g.fillStyle = '#d9cdff'
  g.font = `600 40px ${FONT}`
  g.fillText(SITE, TEX_W / 2, 410)
}

let cardTex: THREE.CanvasTexture | null = null
/** the card's canvas and the logo once it has decoded: what `repaintSigns` paints again */
let painter: { g: CanvasRenderingContext2D; logo: HTMLImageElement | null } | null = null

/** The painted card as a texture — one for every print, made on first use. */
function cardTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  if (cardTex) return cardTex
  const canvas = document.createElement('canvas')
  canvas.width = TEX_W
  canvas.height = TEX_H
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  // the walls are always seen at a slant; without this the caption smears at the default pitch
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
  const g = canvas.getContext('2d')
  if (g) {
    const p: NonNullable<typeof painter> = { g, logo: null }
    painter = p
    paintCard(g, null)
    const img = new Image()
    img.onload = () => {
      p.logo = img
      paintCard(g, img)
      tex.needsUpdate = true
    }
    img.src = logoUrl
  }
  cardTex = tex
  return tex
}

/**
 * Paint the card again in the language the UI is in now. The caption is the one line on it that is
 * translated, and the texture outlives any one mount of the studio, so the studio calls this when
 * the language changes (and on every mount, which costs one small canvas draw).
 */
export function repaintSigns(): void {
  if (!cardTex || !painter) return
  paintCard(painter.g, painter.logo)
  cardTex.needsUpdate = true
}

/** the way a print faces, from the props' 90° steps: 0 = +z (north wall), 1 = +x (west wall) */
function normalOf(rot: WallSign['rot']): THREE.Vector3 {
  return new THREE.Vector3(Math.sin((rot * Math.PI) / 2), 0, Math.cos((rot * Math.PI) / 2))
}

/**
 * The print as a lit plane at the world's spot. A MeshStandardMaterial rather than a flat one so
 * the sun and the room's shadows fall on it like on the plaster around it — a poster, not a
 * screen. The emissive channel carries the same picture at strength 0, ready for the hover glow.
 */
export function hangSign(sign: WallSign, renderer: THREE.WebGLRenderer): HungSign {
  const tex = cardTexture(renderer)
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(sign.w, sign.h),
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0, roughness: 0.86, metalness: 0 }),
  )
  mesh.position.set(sign.x, sign.y, sign.z)
  mesh.rotation.y = (sign.rot * Math.PI) / 2 // the props' rotation steps: 1 turns +z into +x
  mesh.receiveShadow = true
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  return { mesh, url: SPRITFY_URL, spot: sign, hot: false, hover: 0, drop: 0 }
}

/** Mark `hot` as the print under the pointer (or none): the frames after this ease every print to match. */
export function setSignHot(signs: readonly HungSign[], hot: HungSign | null): void {
  for (const s of signs) s.hot = s === hot
}

/**
 * One frame of the hover: ease `hover` towards where `hot` says it should be, at a fixed
 * `HOVER_MS` in either direction, and pose the picture for it — lifted out of the rebate along
 * the wall's normal, a shade larger, and glowing with its own colours. Returns whether anything
 * moved, so the caller can leave a print at rest alone.
 */
export function tickSignHover(s: HungSign, dt: number): boolean {
  const goal = s.hot ? 1 : 0
  if (s.hover === goal) return false
  const step = (dt * 1000) / HOVER_MS
  s.hover = s.hover < goal ? Math.min(goal, s.hover + step) : Math.max(goal, s.hover - step)
  poseSign(s)
  return true
}

/** A fold story moved the wall the print hangs on: sink it with the wall, keeping whatever hover it has. */
export function dropSign(s: HungSign, drop: number): void {
  if (s.drop === drop) return
  s.drop = drop
  poseSign(s)
}

/** The print where its spot, its hover and the fold story say it is. */
function poseSign(s: HungSign): void {
  const n = normalOf(s.spot.rot)
  s.mesh.position.set(s.spot.x, s.spot.y - s.drop, s.spot.z).addScaledVector(n, HOVER_LIFT * s.hover)
  s.mesh.scale.setScalar(1 + HOVER_SCALE * s.hover)
  s.mesh.updateMatrix()
  ;(s.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = HOVER_GLOW * s.hover
}
