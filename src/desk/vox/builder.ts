// Voxel geometry builder, ported from the reference voxel game (public/js/voxel.js).
// Boxes in, one merged BufferGeometry out. Per-face shading is baked into the vertex colours
// (that is what gives voxels their crisp facets) and a few extra attributes drive the shader:
//   aMat   material id — 0 plain / 1 wood grain / 2 leaf / 3 stone·dirt / 4 grass
//   aSway  wind amplitude (leaves, grass, flowers), aPhase its per-prop offset
//   aBob   positive = breathing (idle props), negative = floating on the water surface
//   aGlow  brightness pulse (lamps)
import * as THREE from 'three'

/** Fake per-face AO baked into vertex colours: top bright, bottom dark, sides in between. */
export const SHADE = { px: 0.94, nx: 0.94, py: 1.0, ny: 0.85, pz: 0.97, nz: 0.95 }

/** The shader needs to undo SHADE before judging albedo brightness (bump strength). */
export const SHADE_GLSL = 'float vxFaceShade(vec3 n) {\n'
  + '  vec3 a = abs(n);\n'
  + `  if (a.y >= a.x && a.y >= a.z) return n.y > 0.0 ? ${SHADE.py.toFixed(3)} : ${SHADE.ny.toFixed(3)};\n`
  + `  if (a.x >= a.z) return n.x > 0.0 ? ${SHADE.px.toFixed(3)} : ${SHADE.nx.toFixed(3)};\n`
  + `  return n.z > 0.0 ? ${SHADE.pz.toFixed(3)} : ${SHADE.nz.toFixed(3)};\n`
  + '}\n'

export type FaceKey = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz'
export type HideFaces = Partial<Record<FaceKey, boolean>>

export interface BoxOpt {
  /** extra multiplier on the baked face shade (>1 = brighter, for highlights) */
  shade?: number
  /** material id, see above */
  mat?: number
  /** wind sway amplitude */
  sway?: number
  /** y where sway starts (0 amplitude); above it the amplitude ramps up */
  swayY0?: number
  /** per-instance phase so neighbouring props do not move in lockstep */
  phase?: number
  /** breathing amplitude as a ratio of height */
  breath?: number
  /** y where breathing is pinned (the foot of the prop) */
  breathY0?: number
  /** brightness pulse ratio */
  glow?: number
  /** buoyancy (1 = rides the water surface exactly) */
  float?: number
  /** faces that are permanently hidden by a neighbour and can be skipped */
  hide?: HideFaces
}

const FACES: [FaceKey, [number, number, number]][] = [
  ['px', [1, 0, 0]],
  ['nx', [-1, 0, 0]],
  ['py', [0, 1, 0]],
  ['ny', [0, -1, 0]],
  ['pz', [0, 0, 1]],
  ['nz', [0, 0, -1]],
]

export class VoxBuilder {
  pos: number[] = []
  nor: number[] = []
  col: number[] = []
  sway: number[] = []
  phase: number[] = []
  mat: number[] = []
  bob: number[] = []
  glow: number[] = []
  private tmp = new THREE.Color()

  get isEmpty(): boolean {
    return this.pos.length === 0
  }

  /** centre (cx,cy,cz), size (w,h,d), colour (hex int). */
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, color: number, opt: BoxOpt = {}): void {
    const x0 = cx - w / 2, x1 = cx + w / 2
    const y0 = cy - h / 2, y1 = cy + h / 2
    const z0 = cz - d / 2, z1 = cz + d / 2
    const c = this.tmp.setHex(color)
    const mul = opt.shade == null ? 1 : opt.shade
    const quads: Record<FaceKey, number[][]> = {
      px: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
      nx: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      py: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
      ny: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      pz: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
      nz: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    }
    const amp = opt.sway || 0
    const y0s = opt.swayY0 == null ? y0 : opt.swayY0
    const br = opt.breath || 0
    const fl = opt.float || 0
    const gl = opt.glow || 0
    const y0b = opt.breathY0 == null ? y0 : opt.breathY0
    const ph = opt.phase || 0
    const mid = opt.mat || 0
    const hide = opt.hide
    for (const [key, n] of FACES) {
      if (hide && hide[key]) continue
      const s = SHADE[key] * mul
      const r = c.r * s, g = c.g * s, b = c.b * s
      const q = quads[key]
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const v = q[i]
        this.pos.push(v[0], v[1], v[2])
        this.nor.push(n[0], n[1], n[2])
        this.col.push(r, g, b)
        this.sway.push(amp ? amp * Math.min(1.5, Math.max(0, (v[1] - y0s) / 50)) : 0)
        this.phase.push(ph)
        this.mat.push(mid)
        // foot pinned at 0, top moves the most — a prop never detaches from the ground
        this.bob.push(fl ? -fl : br ? Math.max(0, v[1] - y0b) * br : 0)
        this.glow.push(gl)
      }
    }
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    geo.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1))
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.phase, 1))
    geo.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1))
    geo.setAttribute('aBob', new THREE.Float32BufferAttribute(this.bob, 1))
    // only attach aGlow when something uses it — otherwise the shader reads the default 0
    if (this.glow.some((g) => g !== 0)) geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1))
    geo.computeBoundingSphere()
    return geo
  }
}

/** A box sink — the world builder routes boxes into per-chunk builders through this shape. */
export interface BoxSink {
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, color: number, opt?: BoxOpt): void
}

export const W1: BoxOpt = { mat: 1 } // wood grain
export const L2 = (sway: number, swayY0 = 0): BoxOpt => ({ sway, swayY0, mat: 2 }) // swaying leaves
export const S3: BoxOpt = { mat: 3 } // stone
export const LEAF: BoxOpt = { mat: 2 } // leaf pattern without the sway
