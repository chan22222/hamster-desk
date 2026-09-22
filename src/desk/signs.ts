// The framed Spritfy print on the office's north wall. The world builder lays the voxel frame and
// the dark backing (props.ts `signFrame`) and hands the spot over in `StudioWorld.signs`; this
// module paints the picture — the logo PNG over two caption lines on a dark card — into a canvas
// and hangs it there as a textured plane. It is the one surface in the office that is not a
// voxel, and the reason it lives outside vox/: it needs an Image, a 2D canvas and a Material,
// none of which the node test can have.
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

export const SPRITFY_URL = 'https://spritfy.xyz/'
const CAPTION = '3D & 스프라이트 생성 툴'
const SITE = 'spritfy.xyz'
/** the app's own text stack (styles.css), so the card's type matches the UI around the scene */
const FONT = "'Pretendard', 'Pretendard Variable', system-ui, -apple-system, 'Malgun Gothic', sans-serif"

/**
 * Texture size: the print's 100:60 shape, wide enough to hold the 700 px logo at its native size
 * so its pixel blocks stay whole (a resample would smear the pixel art it is advertising).
 */
const TEX_W = 768
const TEX_H = 460

export interface HungSign {
  mesh: THREE.Mesh
  /** what a click on it opens */
  url: string
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
  g.fillText(CAPTION, TEX_W / 2, 346)
  // the site's lavender, lifted a step: at the wall's slant the darker tint fell below reading
  g.fillStyle = '#d9cdff'
  g.font = `600 40px ${FONT}`
  g.fillText(SITE, TEX_W / 2, 410)
}

/**
 * The print as a lit plane at the world's spot. A MeshStandardMaterial rather than a flat one so
 * the sun and the room's shadows fall on it like on the plaster around it — a poster, not a screen.
 */
export function hangSign(sign: WallSign, renderer: THREE.WebGLRenderer): HungSign {
  const canvas = document.createElement('canvas')
  canvas.width = TEX_W
  canvas.height = TEX_H
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  // the wall is always seen at a slant; without this the caption smears at the default pitch
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
  const g = canvas.getContext('2d')
  if (g) {
    paintCard(g, null)
    const img = new Image()
    img.onload = () => {
      paintCard(g, img)
      tex.needsUpdate = true
    }
    img.src = logoUrl
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(sign.w, sign.h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.86, metalness: 0 }),
  )
  mesh.position.set(sign.x, sign.y, sign.z)
  mesh.rotation.y = (sign.rot * Math.PI) / 2 // the props' rotation steps: 1 turns +z into +x
  mesh.receiveShadow = true
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  return { mesh, url: SPRITFY_URL }
}
