// Voxel materials, ported from the reference voxel game (public/js/voxel.js).
// A MeshStandardMaterial with an onBeforeCompile patch that adds:
//   · procedural per-material detail (wood grain / leaf blotches / stone speckle / grass dots)
//   · per-material roughness
//   · cell-sized normal tilt ("pixels that catch the light"), faded out with distance
//   · optional vertex sway / breathing / buoyancy driven by the aSway·aPhase·aBob attributes
// The paint-atlas branch of the original is not ported — nothing here is paintable.
import * as THREE from 'three'
import { SHADE_GLSL } from './builder'
import { BLAST, BLAST_REST, BUILD, BUILD_REST, CENTRE } from '../fold'

export type TimeUniform = { value: number }

const VX_HASH_GLSL = `
float vxHash(vec3 c) {
  float a = c.x * 127.0 + c.y * 311.0 + c.z * 74.0;
  a -= 2048.0 * floor(a * (1.0 / 2048.0));
  float b = c.x * 269.0 + c.y * 183.0 + c.z * 431.0;
  b -= 2048.0 * floor(b * (1.0 / 2048.0));
  float h = a * b + a * 7.0 + b * 13.0 + 1013.0;
  return (h - 8192.0 * floor(h * (1.0 / 8192.0))) * (1.0 / 8192.0);
}`

const VX_NOISE_GLSL = `
float vxNoise(vec3 p, float s) {
  vec3 q = p / s - 0.5;
  vec3 i = floor(q), fr = fract(q);
  vec3 w = clamp(fwidth(q), 0.02, 4.0);
  vec3 t = clamp((fr - 0.5) / w + 0.5, 0.0, 1.0);
  return mix(
    mix(mix(vxHash(i), vxHash(i + vec3(1,0,0)), t.x), mix(vxHash(i + vec3(0,1,0)), vxHash(i + vec3(1,1,0)), t.x), t.y),
    mix(mix(vxHash(i + vec3(0,0,1)), vxHash(i + vec3(1,0,1)), t.x), mix(vxHash(i + vec3(0,1,1)), vxHash(i + vec3(1,1,1)), t.x), t.y), t.z);
}`

// Detail multiplier per material id. Grass (4) gets a hard texel grid so the ground reads as
// dots rather than smooth noise; the grid is axis aligned to the 64-unit tiles (0.1875 = 3/16).
const VX_DET_GLSL = `
if (vMat < 0.5) { vxDet = 0.965 + 0.06 * vxNoise(vWp, 5.0); }
else if (vMat < 1.5) { vxDet = 0.87 + 0.13 * vxNoise(vWp, 4.0); }
else if (vMat < 2.5) { vxDet = 0.85 + 0.24 * vxNoise(vWp, 3.0); }
else if (vMat < 3.5) { vxDet = 0.83 + 0.20 * vxNoise(vWp, 5.0); }
else {
  vec3 gq = vWp * 0.1875 + 0.25;
  vec3 fw = fwidth(gq);
  float fwm = max(max(fw.x, fw.y), fw.z);
  float k = 1.0 - smoothstep(0.30, 0.75, fwm);
  float coarse = (vxNoise(vWp, 16.0) - 0.5) * 0.10;
  if (k < 0.003) {
    vxDet = 0.95 + coarse;
  } else {
  float gh = vxHash(floor(gq));
  float cl = smoothstep(0.3, 0.7, vxNoise(vWp, 56.0));
  float darkTh = 0.05 + (1.0 - cl) * 0.33;
  float brightTh = 0.95 - cl * 0.33;
  if (gh < darkTh) {
    vxDet = mix(0.95, 0.82 + 0.04 * min(2.0, floor(gh * 3.0 / darkTh)), k) + coarse;
  } else if (gh > brightTh) {
    vxDet = mix(0.95, 1.04 + 0.03 * min(2.0, floor((gh - brightTh) * 3.0 / (1.0 - brightTh))), k) + coarse;
  } else {
    vxDet = 0.95 + (gh - 0.5) * 0.10 * k + coarse;
  }
  }
}`

/** Water height field. The water material and anything floating on it must share this. */
export const WAVE_GLSL = 'float wH(vec2 p, float t) { return sin(dot(p, vec2(0.0193, 0.0083)) + t * 1.1) * 3.0 + sin(dot(p, vec2(-0.0107, 0.0161)) - t * 0.9) * 2.4 + sin(dot(p, vec2(0.0355, 0.0276)) + t * 1.7) * 1.5; }\n'

/** Displacement for a floating vertex: it rides the surface and slides along its slope. */
export const FLOAT_GLSL = `
vec3 floatOffset(vec2 wp, float t, float k) {
  float e = 5.0;
  float hC = wH(wp, t);
  return vec3(-(wH(wp + vec2(e, 0.0), t) - hC) / e * 26.0, hC, -(wH(wp + vec2(0.0, e), t) - hC) / e * 26.0) * k;
}
`

/** Surface bump strength, shared by every voxel material (a quality setting can turn it off). */
export const VOX_BUMP = { value: 1.0 }
export function setVoxBump(amount: number): void {
  VOX_BUMP.value = Math.max(0, amount)
}

/**
 * The two stories the fold switch plays (src/desk/fold.ts): `build` is seconds into a
 * construction, `blast` the shockwave's radius from ground zero. Shared objects like `VOX_BUMP`,
 * so every voxel material reads the same two numbers and moving a story on is two assignments.
 * At their resting values the shader adds exactly nothing.
 */
export const VOX_FOLD = { build: { value: BUILD_REST }, blast: { value: BLAST_REST } }

/**
 * Vertex-shader twin of fold.ts `foldLift`: how far below its place a voxel sits — sunk under the
 * sea bed before its turn comes in a construction (each tile column rising on its own schedule,
 * feet before heads, so walls and desks grow up out of their floor), and dropping away again
 * behind the blast's shockwave. Every constant is the JS one, and the per-tile raggedness is
 * integer arithmetic, so the dust the JS side spawns lands on the very frame the tile does.
 */
const VX_FOLD_GLSL = `
uniform float uBuild;
uniform float uBlast;
float vxFoldLift(vec3 wp) {
  vec2 tile = floor(wp.xz / 64.0);
  float jit = mod(tile.x * 7.0 + tile.y * 13.0, 17.0) / 17.0;
  float d = length(wp.xz - vec2(${CENTRE.x.toFixed(1)}, ${CENTRE.z.toFixed(1)}));
  float delay = d / 64.0 * ${BUILD.PER_TILE} + clamp(wp.y, 0.0, ${BUILD.LAG_H.toFixed(1)}) / ${BUILD.LAG_H.toFixed(1)} * ${BUILD.LAG} + jit * ${BUILD.JITTER};
  float k = clamp((uBuild - delay) / ${BUILD.RISE}, 0.0, 1.0) - 1.0;
  float e = 1.0 + 2.1 * k * k * k + 1.1 * k * k;
  float s = clamp((uBlast - d - ${BLAST.SINK_LAG.toFixed(1)} - jit * ${BLAST.SINK_JITTER.toFixed(1)}) / ${BLAST.SINK_FRONT.toFixed(1)}, 0.0, 1.0);
  return (1.0 - e) * ${BUILD.DROP.toFixed(1)} + s * s * ${BUILD.DROP.toFixed(1)};
}
`
/** the line every world-space vertex shader adds after `begin_vertex` */
const VX_FOLD_APPLY = 'transformed.y -= vxFoldLift((modelMatrix * vec4(position, 1.0)).xyz);\n'

export interface VoxMaterialOptions {
  sway?: boolean
  uTime?: TimeUniform | null
  transparent?: boolean
  opacity?: number
  /** pin the detail pattern to model space — for anything that moves, so the grain stays put */
  localDetail?: boolean
}

export function voxMaterial({ sway = false, uTime = null, transparent = false, opacity = 1, localDetail = false }: VoxMaterialOptions = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent,
    opacity,
    roughness: 0.94,
    metalness: 0.0,
    envMapIntensity: 0.38,
  })
  if (transparent) mat.depthWrite = false
  mat.customProgramCacheKey = () => `vox|s${sway ? 1 : 0}|l${localDetail ? 1 : 0}`
  mat.onBeforeCompile = (sh) => {
    if (uTime) sh.uniforms.uTime = uTime
    sh.uniforms.uBumpAmt = VOX_BUMP // every material shares the object, so a setting change is free
    sh.uniforms.uBuild = VOX_FOLD.build
    sh.uniforms.uBlast = VOX_FOLD.blast
    let v = sh.vertexShader
    v = 'attribute float aMat;\nvarying float vMat;\nvarying vec3 vWp;\nvarying vec3 vWn;\n'
      + (sway ? 'uniform float uTime;\nattribute float aSway;\nattribute float aPhase;\nattribute float aBob;\nattribute float aGlow;\nvarying float vGlowMul;\n' + WAVE_GLSL + FLOAT_GLSL : '')
      + (localDetail ? '' : VX_FOLD_GLSL)
      + v
    v = v.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n'
      + (sway
        ? 'transformed.x += sin(uTime * 1.7 + aPhase) * aSway;\n'
          + 'transformed.z += cos(uTime * 1.3 + aPhase * 1.37) * aSway * 0.6;\n'
          + 'if (aBob < 0.0) transformed += floatOffset((modelMatrix * vec4(position, 1.0)).xz, uTime, -aBob);\n'
          + 'else transformed.y += sin(uTime * 1.9 + aPhase * 1.61) * aBob;\n'
          + 'vGlowMul = 1.0 + aGlow * (sin(uTime * 0.95 + aPhase * 1.23) * 0.85 + 0.65);\n'
        : '')
      // the world rises and falls with the fold stories; a hamster (local detail) is posed by the studio instead
      + (localDetail ? '' : VX_FOLD_APPLY)
      + 'vMat = aMat;\n'
      // pattern coordinates come from the undeformed vertex, so swaying leaves keep their grain
      + (localDetail
        ? 'vWp = position;\nvWn = normal;'
        : 'vWp = (modelMatrix * vec4(position, 1.0)).xyz;\nvWn = mat3(modelMatrix) * normal;'))
    sh.vertexShader = v
    let f = sh.fragmentShader
    f = 'varying float vMat;\nvarying vec3 vWp;\nvarying vec3 vWn;\nuniform float uBumpAmt;\n'
      + (sway ? 'varying float vGlowMul;\n' : '')
      + (localDetail ? 'uniform mat3 normalMatrix;\n' : '')
      + VX_HASH_GLSL + '\n'
      + VX_NOISE_GLSL + '\n'
      // Per-cell random tilt: each voxel "pixel" catches the light at its own angle. The cell
      // grid must be isotropic and must match the colour pattern cell size, or the two patterns
      // drift apart and one face reads as two different materials.
      + 'vec2 vxCellTilt(vec3 p, vec3 fwp, float m) {\n'
      + '  float s = 5.0, a = 0.10;\n'
      + '  if (m < 0.5) { s = 5.0; a = 0.09; }\n'
      + '  else if (m < 1.5) { s = 4.0; a = 0.13; }\n'
      + '  else if (m < 2.5) { s = 3.0; a = 0.16; }\n'
      + '  else if (m < 3.5) { s = 7.0; a = 0.0; }\n'
      + '  else { s = 5.3334; a = 0.0; }\n'
      + '  a *= 1.0 - smoothstep(0.10, 0.30, max(max(fwp.x, fwp.y), fwp.z) / s);\n'
      + '  vec3 c = (m > 3.5) ? floor(p * 0.1875 + 0.25) : floor(p / s);\n'
      + '  float h = vxHash(c);\n'
      + '  return (vec2(h, fract(h * 197.0)) - 0.5) * a;\n'
      + '}\n'
      + SHADE_GLSL
      + f
    f = f.replace('#include <color_fragment>',
      '#include <color_fragment>\n'
      + 'float vxDet = 1.0;\n'
      + VX_DET_GLSL + '\n'
      + 'diffuseColor.rgb *= vxDet;'
      + (sway ? '\ndiffuseColor.rgb *= vGlowMul;' : ''))
    // per-material roughness — a single smoothness everywhere reads as plastic
    f = f.replace('#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n'
      + 'if (vMat < 0.5) roughnessFactor = 0.87;\n'
      + 'else if (vMat < 1.5) roughnessFactor = 0.76;\n'
      + 'else if (vMat < 2.5) roughnessFactor = 0.93;\n'
      + 'else if (vMat < 3.5) roughnessFactor = 0.84;\n'
      + 'else roughnessFactor = 0.96;\n'
      + 'roughnessFactor = clamp(roughnessFactor + 0.35 * (vxDet - 1.0), 0.05, 1.0);')
    f = f.replace('#include <normal_fragment_maps>',
      '#include <normal_fragment_maps>\n'
      + '{\n'
      + '  float vxAmt = uBumpAmt * (1.0 - smoothstep(420.0, 1400.0, length(vViewPosition)));\n'
      // brighter faces show the same tilt far more strongly, so weaken it there — but measure
      // brightness with the baked face shade divided out, or top and bottom disagree
      + '  float vxLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) / vxFaceShade(vWn);\n'
      + '  vxAmt *= mix(1.0, 0.30, smoothstep(0.20, 0.72, vxLum));\n'
      // fwidth is undefined inside non-uniform flow control, so hoist it out of the if
      + '  vec3 vxFwp = fwidth(vWp);\n'
      + '  if (vxAmt > 0.002) {\n'
      + '    vec3 vxN = normalize(vWn);\n'
      + '    vec3 vxUp = abs(vxN.y) > 0.7 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);\n'
      + '    vec3 vxT = normalize(cross(vxUp, vxN));\n'
      + '    vec3 vxB = cross(vxN, vxT);\n'
      + '    vec2 vxTl = vxCellTilt(vWp, vxFwp, vMat) * vxAmt;\n'
      + '    vxTl.y *= mix(0.5, 1.0, abs(vxN.y));\n'
      + '    vec3 vxP = normalize(vxN + vxT * vxTl.x + vxB * vxTl.y);\n'
      + (localDetail
        ? '    normal = normalize(normalMatrix * vxP);\n'
        : '    normal = normalize((viewMatrix * vec4(vxP, 0.0)).xyz);\n')
      + '  }\n'
      + '}')
    sh.fragmentShader = f
  }
  return mat
}

/**
 * Depth material for swaying meshes — without it leaves flicker in and out of their own shadow.
 * It follows the fold stories too, or a construction site would lie in the finished room's shadow.
 */
export function swayDepthMaterial(uTime: TimeUniform): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  mat.customProgramCacheKey = () => 'vox-depth-sway'
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime
    sh.uniforms.uBuild = VOX_FOLD.build
    sh.uniforms.uBlast = VOX_FOLD.blast
    sh.vertexShader = ('uniform float uTime;\nattribute float aSway;\nattribute float aPhase;\nattribute float aBob;\n' + WAVE_GLSL + FLOAT_GLSL + VX_FOLD_GLSL + sh.vertexShader)
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n'
        + 'transformed.x += sin(uTime * 1.7 + aPhase) * aSway;\n'
        + 'transformed.z += cos(uTime * 1.3 + aPhase * 1.37) * aSway * 0.6;\n'
        + 'if (aBob < 0.0) transformed += floatOffset((modelMatrix * vec4(position, 1.0)).xz, uTime, -aBob);\n'
        + 'else transformed.y += sin(uTime * 1.9 + aPhase * 1.61) * aBob;\n'
        + VX_FOLD_APPLY)
  }
  return mat
}

/** Depth material for the still world: the plain shadow pass, plus the fold stories' rise and fall. */
export function foldDepthMaterial(): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  mat.customProgramCacheKey = () => 'vox-depth-fold'
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBuild = VOX_FOLD.build
    sh.uniforms.uBlast = VOX_FOLD.blast
    sh.vertexShader = (VX_FOLD_GLSL + sh.vertexShader).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VX_FOLD_APPLY)
  }
  return mat
}

/**
 * Water: vertex waves plus drifting cell dots, so the surface breaks into pixel glitter instead
 * of looking like a sheet of glass. The geometry must be pre-rotated onto the XZ plane.
 * `horizon` is the colour distant water converges on — here the fog colour, so the seam with the
 * sky disappears (the game used its HDR sky colour for the same job).
 */
export function waterMaterial(uTime: TimeUniform, horizon: THREE.Color): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1c5e88,
    roughness: 0.16,
    metalness: 0.0,
    transparent: true,
    opacity: 0.9,
    envMapIntensity: 0.08,
    fog: false,
  })
  const uHorizon = { value: new THREE.Vector3(horizon.r, horizon.g, horizon.b) }
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime
    sh.uniforms.uHorizon = uHorizon
    sh.vertexShader = ('uniform float uTime;\nvarying vec2 vWpz;\n' + WAVE_GLSL + sh.vertexShader)
      .replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n{\n'
        + '  vec2 wp2 = (modelMatrix * vec4(position, 1.0)).xz;\n'
        + '  float e = 5.0;\n'
        + '  float hC = wH(wp2, uTime);\n'
        + '  float hX = wH(wp2 + vec2(e, 0.0), uTime);\n'
        + '  float hZ = wH(wp2 + vec2(0.0, e), uTime);\n'
        + '  objectNormal = normalize(vec3(-(hX - hC) / e, 1.0, -(hZ - hC) / e));\n'
        + '}')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n{\n'
        + '  vec2 wp2 = (modelMatrix * vec4(position, 1.0)).xz;\n'
        + '  transformed.y += wH(wp2, uTime);\n'
        + '  vWpz = wp2;\n'
        + '}')
    let f = sh.fragmentShader
    f = 'uniform float uTime;\nuniform vec3 uHorizon;\nvarying vec2 vWpz;\n'
      + 'float wtHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n'
      + WAVE_GLSL
      // ripple slope: a sum of travelling waves, never a product of per-axis sines (that would
      // trap the crests in a grid and the surface would look like bubble wrap)
      + 'vec2 wtRipple(vec2 p, float t) {\n'
      + '  vec2 g = vec2(0.0);\n'
      + '  vec2 k1 = vec2(0.0385, 0.0166);\n'
      + '  g += 0.95 * k1 * cos(dot(k1, p) + t * 1.7);\n'
      + '  vec2 k2 = vec2(-0.0214, 0.0362);\n'
      + '  g += 0.80 * k2 * cos(dot(k2, p) + t * 1.28);\n'
      + '  vec2 k3 = vec2(0.0602, -0.0509);\n'
      + '  g += 0.42 * k3 * cos(dot(k3, p) + t * 2.35);\n'
      + '  vec2 k4 = vec2(0.0928, 0.0817);\n'
      + '  g += 0.22 * k4 * cos(dot(k4, p) - t * 2.9);\n'
      + '  return g;\n'
      + '}\n'
      + 'float wtCellShade(vec2 p, float t) {\n'
      + '  vec2 c = floor((p + vec2(t * 6.0, t * 4.0)) / 11.0);\n'
      + '  return wtHash(c);\n'
      + '}\n'
      + f
    f = f.replace('#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n'
      + 'roughnessFactor = mix(roughnessFactor, 0.92, smoothstep(1400.0, 5000.0, length(vViewPosition)));')
    f = f.replace('#include <normal_fragment_maps>',
      '#include <normal_fragment_maps>\n'
      + '{\n'
      + '  float we = 4.0;\n'
      + '  float hC = wH(vWpz, uTime);\n'
      + '  vec2 wg = vec2(wH(vWpz + vec2(we, 0.0), uTime) - hC, wH(vWpz + vec2(0.0, we), uTime) - hC) / we;\n'
      + '  wg += wtRipple(vWpz, uTime);\n'
      + '  vec3 wn = normalize(vec3(-wg.x, 1.0, -wg.y));\n'
      + '  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);\n'
      + '}')
    f = f.replace('#include <color_fragment>',
      '#include <color_fragment>\n'
      + 'float wd1 = wtCellShade(vWpz, uTime);\n'
      + 'float wd2 = wtHash(floor((vWpz - vec2(uTime * 10.0, uTime * 6.0)) / 22.0));\n'
      + 'diffuseColor.rgb *= 0.86 + 0.17 * wd1 + 0.08 * wd2;\n'
      + 'if (wd1 > 0.94) diffuseColor.rgb += vec3(0.09, 0.11, 0.12) * (wd1 - 0.94) * 9.0;\n')
    // distant water converges on the horizon colour, hiding the seam with the sky
    f = f.replace('#include <opaque_fragment>',
      '#include <opaque_fragment>\n'
      + 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uHorizon, smoothstep(2200.0, 7000.0, length(vViewPosition)));')
    sh.fragmentShader = f
  }
  return mat
}

/** Island theme sky colours (themes.js `island`): zenith, horizon, below the horizon. */
export const SKY_COLORS = {
  zen: [0.09, 0.36, 0.97] as [number, number, number],
  hor: [0.48, 0.7, 0.95] as [number, number, number],
  sea: [0.38, 0.64, 0.93] as [number, number, number],
}

/** A big inside-out sphere with a three-stop vertical gradient. */
export function skyDome(zen = SKY_COLORS.zen, hor = SKY_COLORS.hor, sea = SKY_COLORS.sea): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      uZen: { value: new THREE.Vector3(...zen) },
      uHor: { value: new THREE.Vector3(...hor) },
      uSea: { value: new THREE.Vector3(...sea) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uZen;
      uniform vec3 uHor;
      uniform vec3 uSea;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h >= 0.0
          ? mix(uHor, uZen, pow(clamp(h, 0.0, 1.0), 0.55))
          : mix(uHor, uSea, pow(clamp(-h, 0.0, 1.0), 0.35));
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 20), mat)
  mesh.renderOrder = -2
  mesh.frustumCulled = false
  return mesh
}
