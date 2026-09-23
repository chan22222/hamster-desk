import { memo, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as THREE from 'three'
import { feedLife, runInTerminal, setFeedLife, shortName, useDesk, type Hamster, type HamsterState, type SessionState } from '../store'
import { formatDuration, ui, useUi } from '../i18n'
import { rich } from '../rich'
import { animFor, screenColor, statusDot, tintFor, type IsoAnim } from './anim'
import { modelSkin } from './skins'
import { makePatrol, patrolGoal, setPatrolMode, stepPatrol, type Patrol, type PatrolMode } from './patrol'
import { IconClose, IconHome, IconMap, IconMinus, IconPlus, IconTarget } from '../widgets/icons'
import { Popover } from '../widgets/Popover'
import { TranscriptList } from '../session/TranscriptList'
import {
  LOBBY,
  OFFICE,
  FEED_RISE,
  H_OFFICE,
  SEAT_LIFT,
  T,
  advanceWalker,
  makeWalker,
  reconcileSeats,
  tileToWorld,
  walkDirect,
  walkTo,
  type Point,
  type Walker,
} from './office-world'
import {
  applyTo,
  autoFrameCamera,
  basisOf,
  createCamera,
  distanceFor,
  feedLines,
  focusCamera,
  FRAME_PAD,
  HEADER_PAD,
  makeBasis,
  orbitCamera,
  overviewCamera,
  panCamera,
  planeHit,
  PLATE_MIN_SCALE,
  viewportGroundPolygon,
  worldToScreen,
  zoomCamera,
  type Camera,
} from './office-camera'
import { foldDepthMaterial, setVoxBump, skyDome, swayDepthMaterial, VOX_FOLD, voxMaterial, waterMaterial } from './vox/material'
import { buildHamster, coatOf, FEED_ANCHOR, MAIN_SCALE, type HamsterRig } from './vox/hamster'
import { buildStudioWorld, COLS, ROWS, WATER_Y, WORLD_D, WORLD_W, type StudioWorld } from './vox/world'
import { BOSS_DESK_W, DESK_W } from './vox/props'
import { dropSign, hangSign, repaintSigns, setSignHot, tickSignHover, type HungSign } from './signs'
import { INPUT_HOLD_MS, QUALITY, frameDue, frameRate, pixelRatio, qualityFor, type Quality } from './pace'
import { declutter, type FeedBox, type Shift } from './declutter'
import { LIFT, SCRUFF, carry, fly, grab, hang, landingSpot, release, returnPath, worldToTile, type Flight, type Ground, type Held } from './grab'
import { disposeSplash, makeSplash, tickSplash, type Splash } from './splash'
import { BLAST_REST, BUILD, BUILD_REST, CENTRE, STORY_DROP, blendView, builder, doomAt, flashAlpha, foldAge, foldAt, foldLift, foldPlaying, landTime, shakeOffset, shockRadius, storyBounds, storyMix, storyScale, type FoldFx } from './fold'
import { ashBurst, disposeBlast, doomOf, makeBlast, tickBlast, type Blast, type GroundAt } from './blast'
import { disposeBuild, dropGear, makeBuild, thud, tickBuild, wearGear, type Build } from './build'

const GLYPH: Partial<Record<IsoAnim, string>> = { think: '···', wave: '!', sleep: 'z', phone: '♪' }
/** states in which a colleague counts as working — and so as fair game for the boss's rounds */
const WORKING = new Set<HamsterState>(['thinking', 'reading', 'searching', 'writing', 'running', 'hiring', 'browsing', 'talking'])
/** the boss is out of its chair: on the way to a colleague, standing over one, or on the way back */
const bossAway = (p: Patrol, w: Walker): boolean => p.phase === 'going' || p.phase === 'scolding' || (p.phase === 'returning' && w.path.length > 0)

const FOG = 0xcfe3f2
/** how fast the automatic camera eases towards its target (the room it leaves is FRAME_PAD) */
const FRAME_EASE = 6
/**
 * While somebody walks, the automatic framing is worked out again at most this often. The answer
 * is a bisection of a few hundred projections, and the easing towards it fills in between anyway:
 * at every frame it was most of the frame's budget for a camera that could not move any faster.
 */
const REFRAME_MS = 120
/** a lone seated hamster: closer than a manual focus (the framing pushes it down on its own) */
const SOLO_SCALE = 3.0
/** a feed row fades out over its last `FEED_FADE` ms (or half its life, whichever is shorter) */
const FEED_FADE = 600
/** a press on a hamster that lets go within this many px and ms is a tap (select), anything more picks it up */
const TAP_PX = 4
const TAP_MS = 250
/** a feed pushed further than this from its hamster (declutter.ts) gets a tail back to the head */
const TAIL_MIN = 10
/** how far one arrow key pans the view, px (Shift: three times as far) */
const PAN_STEP = 64
/** how often the studio looks for scenes whose session is gone */
const SWEEP_MS = 2000

const near = (a: Point, b: Point): boolean => Math.hypot(a.i - b.i, a.j - b.j) < 0.01

/** Camera scripting for the capture script, only wired up in the `?studio-demo` preview. */
export interface StudioDebug {
  focus(idOrTile: string | { i: number; j: number }, scale?: number): void
  zoom(scale: number): void
  orbit(dyaw: number, dpitch: number): void
  setStates(map: Record<string, { state: HamsterState; since?: number }>): void
  addArriving(id: string, model: string, agentType: string): void
  /** the hamster says a sentence, exactly as a `text` transcript event would make it */
  say(id: string, text: string): void
  /** the hamster does something, exactly as a `tool` transcript event would make it */
  act(id: string, label: string): void
  /** shorten the feed's life spans so a capture does not have to wait nine seconds */
  feedLife(p: { act?: number; say?: number; warn?: number }): void
  /** turn the automatic framing on or off (the `자동` button) */
  autoFrame(on: boolean): void
  /** the boss's rounds (src/desk/patrol.ts): `off` keeps it at its desk, `hurry` starts one at once */
  patrol(mode: PatrolMode): void
  /** hold the pointer over the k-th wall print (`StudioWorld.signs` order), or over none */
  hoverSign(index: number | null): void
  /** pin a hamster's card, as a tap on it does (or let go of it) */
  pin(id: string | null): void
  /** the fold story on screen (fold.ts): its phase and age, how many rigs it has hidden, the white-out's opacity */
  fold(): { phase: FoldFx['phase']; age: number; hidden: number; flash: string }
}
declare global {
  interface Window { __studio?: StudioDebug }
}

interface RigState {
  rig: HamsterRig
  key: string
  /** smoothed facing, so a hamster turns instead of snapping */
  yaw: number
}

/**
 * Automatic framing, per session scene so it survives folding the desk and switching tabs like
 * the camera does. `target` is where the camera is heading; `key` the occupancy it was computed for.
 */
interface AutoFrame {
  on: boolean
  key: string
  target: { tx: number; tz: number; scale: number } | null
  /** when the target was last worked out (the render loop's clock) */
  at: number
}

interface Scene {
  seats: Map<string, number>
  /**
   * Everybody on the floor, by hamster id — including, for a few seconds, one the session has
   * already let go of: a colleague whose report is in walks on to the door (`LEAVE_MS` in the store
   * is not long enough to cross the room from its far corner) and is only taken away there.
   */
  walkers: Map<string, Walker>
  /** the boss's rounds: whether it is out of its chair, and where in a round it is (patrol.ts) */
  patrol: Patrol
  camera: Camera
  rigs: Map<string, RigState>
  auto: AutoFrame
  /** the hamster in the user's hand, if any (grab.ts) */
  hold: Held | null
  /** hamsters in the air, or in the water, after being let go (grab.ts) */
  flights: Flight[]
  /** how many times each hamster has gone into the sea: the one that walks in after is a different individual */
  variants: Map<string, number>
  /** hamsters with neither a desk nor a place in the visible queue, last frame: the next place that opens, they walk in for */
  unseen: Set<string>
  width: number
  height: number
}
const makeScene = (): Scene => ({
  seats: new Map(),
  walkers: new Map(),
  patrol: makePatrol(),
  camera: createCamera(),
  rigs: new Map(),
  hold: null,
  flights: [],
  variants: new Map(),
  unseen: new Set(),
  // a scene that has never been opened starts with whatever the saved preference says
  auto: { on: useDesk.getState().prefs.autoCam, key: '', target: null, at: 0 },
  width: 0,
  height: 0,
})
// Folding the desk unmounts this component. Keep each session's world across that toggle too.
const scenes = new Map<string, Scene>()

// ---- the renderer and the static scene are module singletons -------------------------------
// A WebGL context is expensive and browsers cap how many may exist, so folding the desk must not
// throw one away: the canvas is simply detached from the DOM and re-attached on the next mount.
interface Studio {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** recentred on the camera every frame, so the dome horizon never skews */
  sky: THREE.Mesh
  uTime: { value: number }
  world: StudioWorld
  hamsterMat: THREE.Material
  /** per-session groups of hamster rigs; only the active session's group is visible */
  sessionGroups: Map<string, THREE.Group>
  deskDynamic: { screen: THREE.Mesh; keys: THREE.Mesh; lamp: THREE.Mesh; spill: THREE.Mesh }[]
  /** the framed prints on the walls — a click on one opens its site (the hamsters are the other thing the pointer can take hold of: grab.ts) */
  signs: HungSign[]
  /** splashes on the water (splash.ts) — ticked every frame and removed when they are over */
  splashes: Splash[]
  /** the world's chunk meshes: culling comes off them while a fold story (fold.ts) moves their vertices about */
  chunks: THREE.Mesh[]
  minimapUrl: string
  /** the sun, whose shadow map the quality tier sizes (pace.ts) */
  sun: THREE.DirectionalLight
  /** the sea, and its vertex grids by segment count — the tier swaps between two (pace.ts `QUALITY`) */
  water: THREE.Mesh
  seaGrids: Map<number, THREE.BufferGeometry>
  /** the tier the picture is drawn at (pace.ts) */
  quality: Quality
  /** a software rasteriser: shadows off and a fixed low pixel ratio, whatever the tier */
  software: boolean
}
let studio: Studio | null = null
let studioFailed = false

/** The sea's vertex grid at `n` segments a side, made once per size. */
function seaGrid(st: Pick<Studio, 'seaGrids'>, n: number): THREE.BufferGeometry {
  let g = st.seaGrids.get(n)
  if (!g) {
    // Wide enough that its edge always sits beyond the sky dome horizon (4500 from the camera);
    // a 6000 plane left a visible chevron where the sea ran out during the overview.
    g = new THREE.PlaneGeometry(16000, 16000, n, n)
    g.rotateX(-Math.PI / 2) // local y becomes world up, which the wave shader displaces
    st.seaGrids.set(n, g)
  }
  return g
}

/**
 * Draw at another tier (pace.ts): the pixel ratio, the shadow map, the voxel normal tilt and the
 * sea's grid. The shadow map is thrown away so the renderer makes it again at the new size.
 */
function setQuality(st: Studio, q: Quality): void {
  if (st.quality === q) return
  st.quality = q
  const spec = QUALITY[q]
  if (!st.software) {
    st.renderer.setPixelRatio(pixelRatio(q, window.devicePixelRatio)) // re-sizes the buffer at the size it had
    st.sun.shadow.mapSize.set(spec.shadow, spec.shadow)
    st.sun.shadow.map?.dispose()
    st.sun.shadow.map = null
  }
  setVoxBump(spec.bump)
  st.water.geometry = seaGrid(st, spec.sea)
}

const basicCache = new Map<string, THREE.MeshBasicMaterial>()
function flat(color: string | number): THREE.MeshBasicMaterial {
  const key = String(color)
  let m = basicCache.get(key)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color as THREE.ColorRepresentation) })
    m.toneMapped = false
    basicCache.set(key, m)
  }
  return m
}

/** The glow a screen throws on the desktop: the same colour at 55%, memoised per screen colour. */
const spillCache = new Map<string, number>()
function spillOf(bg: string): number {
  let hex = spillCache.get(bg)
  if (hex === undefined) {
    hex = new THREE.Color(bg).multiplyScalar(0.55).getHex()
    spillCache.set(bg, hex)
  }
  return hex
}

function boxMesh(b: { x: number; y: number; z: number; w: number; h: number; d: number }, color: string | number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), flat(color))
  mesh.position.set(b.x, b.y, b.z)
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  return mesh
}

/** Bake the tile colours into a data URL once — the minimap is an <image> inside its SVG. */
function minimapDataUrl(world: StudioWorld): string {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = COLS
    canvas.height = ROWS
    const g = canvas.getContext('2d')
    if (!g) return ''
    g.fillStyle = '#1d4a68'
    g.fillRect(0, 0, COLS, ROWS)
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
      const c = world.mapColors[ty][tx]
      if (!c) continue
      g.fillStyle = `#${c.toString(16).padStart(6, '0')}`
      g.fillRect(tx, ty, 1, 1)
    }
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

function createStudio(): Studio | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  } catch (err) {
    console.error('[studio] WebGL context creation failed', err)
    return null
  }
  renderer.setPixelRatio(pixelRatio('full', window.devicePixelRatio))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.35
  // software rasterisers (SwiftShader / llvmpipe) cannot afford shadows at full resolution
  let software = false
  try {
    const gl = renderer.getContext()
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const gpu = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '')
    if (/swiftshader|software|llvmpipe|basic render/i.test(gpu)) {
      software = true
      renderer.shadowMap.enabled = false
      renderer.setPixelRatio(0.6)
    }
  } catch {
    /* the extension is optional */
  }

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xbfe0f5)
  scene.fog = new THREE.Fog(FOG, 2600, 11000)
  const sky = skyDome()
  scene.add(sky)

  const uTime = { value: 0 }
  const world = buildStudioWorld()
  const islandX = (world.bounds.minX + world.bounds.maxX) / 2
  const islandZ = (world.bounds.minZ + world.bounds.maxZ) / 2

  scene.add(new THREE.HemisphereLight(0xd6e6f2, 0x7ab45c, 0.89))
  const sun = new THREE.DirectionalLight(0xffe7ae, 2.3)
  sun.castShadow = true
  sun.shadow.mapSize.set(QUALITY.full.shadow, QUALITY.full.shadow)
  sun.shadow.camera.left = -1200
  sun.shadow.camera.right = 1200
  sun.shadow.camera.top = 1200
  sun.shadow.camera.bottom = -1200
  sun.shadow.camera.near = 100
  sun.shadow.camera.far = 4000
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 3.6
  sun.shadow.intensity = 0.62
  sun.shadow.camera.updateProjectionMatrix()
  const sunDir = new THREE.Vector3(340, 760, 220).normalize()
  sun.position.set(islandX + sunDir.x * 1800, sunDir.y * 1800, islandZ + sunDir.z * 1800)
  sun.target.position.set(islandX, 0, islandZ)
  scene.add(sun)
  scene.add(sun.target)

  const staticMat = voxMaterial({})
  const swayMat = voxMaterial({ sway: true, uTime })
  const depthSway = swayDepthMaterial(uTime)
  // the still world's shadow pass has to follow the fold stories too (material.ts): a rising
  // office would otherwise be shadowed by its finished self
  const depthStill = foldDepthMaterial()
  const chunks: THREE.Mesh[] = []
  for (const chunk of world.chunks) {
    for (const [geo, mat] of [[chunk.static, staticMat], [chunk.sway, swayMat]] as const) {
      if (!geo) continue
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.customDepthMaterial = mat === swayMat ? depthSway : depthStill
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      scene.add(mesh)
      chunks.push(mesh)
    }
  }

  const seaGrids = new Map<number, THREE.BufferGeometry>()
  const water = new THREE.Mesh(seaGrid({ seaGrids }, QUALITY.full.sea), waterMaterial(uTime, new THREE.Color(FOG)))
  water.position.set(WORLD_W / 2, WATER_Y, WORLD_D / 2)
  water.renderOrder = -1
  scene.add(water)
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), new THREE.MeshLambertMaterial({ color: 0x2a6b8f }))
  bed.rotation.x = -Math.PI / 2
  bed.position.set(WORLD_W / 2, -66, WORLD_D / 2)
  scene.add(bed)

  const deskDynamic = world.deskParts.map((parts) => {
    const screen = boxMesh(parts.screen, 0x243c36)
    const keys = boxMesh(parts.keys, 0x8892aa)
    const lamp = boxMesh(parts.lamp, 0x506358)
    const spill = boxMesh(parts.spill, 0x142219)
    scene.add(screen, keys, lamp, spill)
    return { screen, keys, lamp, spill }
  })
  // the pictures in the world's frames: textured planes, the frames themselves are in the chunks
  const signs = world.signs.map((sign) => hangSign(sign, renderer))
  for (const s of signs) scene.add(s.mesh)

  const camera = new THREE.PerspectiveCamera(42, 1, 1, 6000)
  return {
    renderer,
    scene,
    camera,
    sky,
    uTime,
    world,
    hamsterMat: voxMaterial({ localDetail: true }),
    sessionGroups: new Map(),
    deskDynamic,
    signs,
    splashes: [],
    chunks,
    minimapUrl: minimapDataUrl(world),
    sun,
    water,
    seaGrids,
    quality: 'full',
    software,
  }
}

function getStudio(): Studio | null {
  if (studio || studioFailed) return studio
  studio = createStudio()
  if (!studio) studioFailed = true
  return studio
}

// ---- the fold stories: the blast and the construction (fold.ts) ----------------------------
// Switching the studio off blows it up, switching it on builds it back (blast.ts, build.ts). The
// render loop runs whichever one App.tsx's clock says is playing, keeps a note of everything it
// moved, and puts it all back the moment the story ends or is cut short — so the frame after is
// exactly the frame the store would have drawn without it.
interface FoldRun {
  phase: 'blast' | 'build'
  since: number
  blast: Blast | null
  build: Build | null
  /** rigs a story has posed: back to their own scale, upright and visible when it is over */
  rigs: Map<string, { rig: HamsterRig; main: boolean }>
  /** the story's own framing (ground zero, a little wider than the view was), bisected once per size and orientation; `base` = the zoom the story started from */
  view: { key: string; cam: Camera; base: number } | null
  /** how far towards the story's view the camera already was when this run began (fold.ts `storyMix`) */
  mixFrom: number
}
/** nothing playing: what the mini window and the preview hand the studio */
const NO_FX: FoldFx = foldAt(false)

function startFoldRun(st: Studio, world: Scene, fx: FoldFx, handed: number | null): FoldRun {
  // A hamster in the hand or in the air goes back to its chair first: both stories pose every rig
  // themselves, and a flight left mid-air would land in a room that is not there any more. (One
  // from the queue loses its walker instead, and is put back in its place on the next frame.)
  const reseat = (id: string): void => {
    const k = world.seats.get(id)
    if (k !== undefined) world.walkers.set(id, makeWalker(OFFICE.slots[k].seat))
    else world.walkers.delete(id)
  }
  for (const f of world.flights) reseat(f.id)
  if (world.hold) reseat(world.hold.id)
  world.flights = []
  world.hold = null
  const run: FoldRun = { phase: fx.phase as 'blast' | 'build', since: fx.since, blast: null, build: null, rigs: new Map(), view: null, mixFrom: handed ?? (fx.phase === 'build' ? 1 : 0) }
  if (fx.phase === 'blast') {
    run.blast = makeBlast()
    st.scene.add(run.blast.group)
  } else {
    run.build = makeBuild(st.world)
    st.scene.add(run.build.dust.mesh)
  }
  // the shader moves vertices well outside the chunks' bounding spheres while a story plays
  for (const m of st.chunks) m.frustumCulled = false
  return run
}

function endFoldRun(st: Studio, run: FoldRun): void {
  if (run.blast) {
    st.scene.remove(run.blast.group)
    disposeBlast(run.blast)
  }
  if (run.build) {
    st.scene.remove(run.build.dust.mesh)
    disposeBuild(run.build)
  }
  VOX_FOLD.build.value = BUILD_REST
  VOX_FOLD.blast.value = BLAST_REST
  for (const m of st.chunks) m.frustumCulled = true
  // the desks' lit parts and the wall prints back on their spots
  st.world.deskParts.forEach((parts, k) => {
    const dyn = st.deskDynamic[k]
    for (const key of ['screen', 'keys', 'lamp', 'spill'] as const) {
      dyn[key].position.y = parts[key].y
      dyn[key].updateMatrix()
    }
  })
  for (const s of st.signs) dropSign(s, 0)
  for (const { rig, main } of run.rigs.values()) {
    rig.group.scale.setScalar(main ? MAIN_SCALE : 1)
    rig.group.rotation.x = 0
    rig.group.rotation.z = 0
    rig.group.visible = true
  }
}

/** The fixtures that are not in the chunk geometry ride with their tiles (fold.ts `foldLift`). */
function liftFixtures(st: Studio, build: number, blast: number): void {
  st.world.deskParts.forEach((parts, k) => {
    const dyn = st.deskDynamic[k]
    for (const key of ['screen', 'keys', 'lamp', 'spill'] as const) {
      const b = parts[key]
      dyn[key].position.y = b.y - foldLift(b.x, b.y, b.z, build, blast)
      dyn[key].updateMatrix()
    }
  })
  // the prints through their own pose, which keeps whatever hover they are easing out of (signs.ts)
  for (const s of st.signs) dropSign(s, foldLift(s.spot.x, s.spot.y, s.spot.z, build, blast))
}

/** Ease a rig's facing towards `yaw` the short way round: a hamster turns rather than snapping. */
function turn(rs: RigState, yaw: number, dt: number): void {
  let d = yaw - rs.yaw
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  rs.yaw += d * Math.min(1, dt * 8)
  rs.rig.group.rotation.y = rs.yaw
}

/** Pose the rig for one frame. Rhythms are lifted from the game's cat animation. */
function poseRig(st: RigState, anim: IsoAnim, seated: boolean, t: number): void {
  const { rig } = st
  const { bodyM, tieG, headG, tailG, legs, headY, armY, legY, tailY, bodyY } = rig
  // reset what the previous frame may have bent
  headG.position.set(0, headY, -1)
  headG.rotation.set(0, 0, 0)
  tailG.position.set(0, tailY, -9)
  tailG.rotation.set(-0.5, 0, 0)
  legs[0].position.set(-17, armY, 0)
  legs[1].position.set(17, armY, 0)
  legs[2].position.set(-6, legY, 0)
  legs[3].position.set(6, legY, 0)
  for (const l of legs) l.rotation.set(0, 0, 0)
  bodyM.position.set(0, bodyY, 21.5)
  tieG.position.y = 0

  // shared breathing
  bodyM.position.y = bodyY + Math.sin(t * 2.2) * 0.8
  headG.rotation.x = Math.sin(t * 1.4) * 0.04
  tailG.rotation.z = Math.sin(t * 2.6) * 0.22

  // walking is the only pose that moves the legs; every other state happens at a desk
  if (anim === 'walk') {
    // shorter legs, shorter stride: at the cat's 0.7 the stubby legs read as doing the splits
    const s = Math.sin(t * 9) * 0.5
    legs[0].rotation.x = s
    legs[1].rotation.x = -s
    legs[2].rotation.x = -s
    legs[3].rotation.x = s
    bodyM.position.y = bodyY + Math.abs(Math.sin(t * 9)) * 1.6
    headG.rotation.x = Math.sin(t * 9) * 0.05
    tieG.position.y = bodyM.position.y - bodyY
    return
  }

  if (seated) {
    // the game's sit pose: legs folded flat forward, everything else dropped by 12
    legs[2].rotation.x = -Math.PI / 2
    legs[3].rotation.x = -Math.PI / 2
    // the hip sits at the front of the torso, so the folded legs actually show in front of it
    legs[2].position.set(-6, 4, 6)
    legs[3].position.set(6, 4, 6)
    bodyM.position.y -= 12
    headG.position.y = headY - 12
    tailG.position.y = tailY - 12
    legs[0].position.y = armY - 12
    legs[1].position.y = armY - 12
  }

  // the tie rides the chest: it drops with the torso when seated and bobs with it
  tieG.position.y = bodyM.position.y - bodyY

  switch (anim) {
    case 'type': {
      const tap = Math.sin(t * 14) * 0.12
      legs[0].rotation.x = -1.3 + tap
      legs[1].rotation.x = -1.3 - tap
      break
    }
    case 'run': {
      // same hands-on-keys shape as typing, only faster, with the torso bobbing along
      const tap = Math.sin(t * 20) * 0.17
      legs[0].rotation.x = -1.3 + tap
      legs[1].rotation.x = -1.3 - tap
      bodyM.position.y += Math.abs(Math.sin(t * 10)) * 1.2
      tieG.position.y = bodyM.position.y - bodyY
      headG.rotation.x += Math.sin(t * 10) * 0.05
      break
    }
    case 'read':
      legs[0].rotation.x = -1.1
      legs[1].rotation.x = -1.1
      headG.rotation.x += 0.12
      break
    case 'think':
      legs[0].rotation.x = -2.3
      legs[1].rotation.x = -0.9
      headG.rotation.z = 0.12
      break
    case 'phone':
      legs[0].rotation.x = -2.6
      legs[0].rotation.z = 0.4
      legs[1].rotation.x = -0.8
      break
    case 'talk':
      headG.rotation.x += Math.sin(t * 6) * 0.06
      legs[0].rotation.x = -1.2 + Math.sin(t * 5) * 0.25
      legs[1].rotation.x = -1.2 - Math.sin(t * 5) * 0.25
      break
    case 'wave':
      legs[0].rotation.x = -1.4 + Math.sin(t * 11) * 0.45
      legs[1].rotation.x = -1.0
      break
    case 'sleep':
      headG.rotation.x = 0.55 + Math.sin(t * 1.1) * 0.06
      headG.position.y = headY - (seated ? 14 : 8)
      tailG.rotation.z = 0.03
      legs[0].rotation.x = 0
      legs[1].rotation.x = 0
      break
    case 'scold': {
      // The boss standing over a colleague (patrol.ts): the near arm out and jabbing on every
      // beat, a little hop on every other one, the head thrust forward. A cartoon telling-off —
      // it has to read as a joke from across the room, so everything is a beat too big.
      const beat = t * 9
      const hop = Math.max(0, Math.sin(beat / 2)) * 3
      for (const part of [bodyM, headG, tailG, ...legs]) part.position.y += hop
      legs[0].rotation.x = -2.5 + Math.sin(beat) * 0.35
      legs[1].rotation.x = -0.7
      headG.rotation.x += 0.16
      headG.rotation.z = Math.sin(beat) * 0.05
      tieG.position.y = bodyM.position.y - bodyY
      break
    }
    case 'flinch': {
      // being told off (patrol.ts): both paws up over the head, sunk a little deeper into the
      // chair, and a tremble the sweat mark above finishes off
      const shake = Math.sin(t * 26)
      legs[0].rotation.x = -2.9 + shake * 0.08
      legs[1].rotation.x = -2.9 - shake * 0.08
      bodyM.position.y -= 2
      headG.position.y -= 3
      headG.rotation.x += 0.2
      headG.rotation.z = shake * 0.05
      tieG.position.y = bodyM.position.y - bodyY
      break
    }
    case 'struggle': {
      // in the hand (grab.ts): held by the scruff, all four paws pedalling, the tail whipping and
      // the head shaking — too big to be dignified, which is the point
      const k = t * 17
      legs[0].rotation.x = -1.6 + Math.sin(k) * 1.0
      legs[1].rotation.x = -1.6 - Math.sin(k) * 1.0
      legs[0].rotation.z = 0.45
      legs[1].rotation.z = -0.45
      legs[2].rotation.x = Math.sin(k + 1) * 0.9
      legs[3].rotation.x = -Math.sin(k + 1) * 0.9
      headG.rotation.x = -0.1
      headG.rotation.z = Math.sin(t * 9) * 0.12
      tailG.rotation.z = Math.sin(t * 14) * 0.5
      break
    }
    case 'hammer': {
      // On the site (build.ts): the near arm lifts the mallet slowly over the head and brings it
      // down fast, a hop on every strike, the other paw steadying the work. Each hamster swings on
      // its own beat (its place in the room sets the phase), or the crew would look like a machine.
      const ph = (((t * 2.0 + rig.group.position.x * 0.013) % 1) + 1) % 1
      const up = ph < 0.72 ? ph / 0.72 : 1 - (ph - 0.72) / 0.28
      legs[0].rotation.x = -1.0 - 1.8 * up
      legs[1].rotation.x = -1.1
      const strike = ph >= 0.72 ? 1 - up : 0
      const hop = Math.sin(strike * Math.PI) * 3
      for (const part of [bodyM, headG, tailG, ...legs]) part.position.y += hop
      headG.rotation.x += 0.08 + 0.12 * (1 - up)
      tieG.position.y = bodyM.position.y - bodyY
      break
    }
    default:
      legs[0].rotation.x = -1.0
      legs[1].rotation.x = -1.0
  }
}

/**
 * `fx` is the fold switch's clock (fold.ts, from App.tsx's `useFold`): which story is playing, if
 * any, and since when. The mini window and the preview leave it out — nothing plays there.
 */
/** the size the picture keeps while the pane slides (styles.css `.is-story .desk-canvas-host`); `w` null = the pane's own width */
export interface KeepSize { w: number | null; h: number }

interface DeskStudioProps { session: SessionState | null; height: number; fx?: FoldFx; story?: boolean; shut?: boolean; keep?: KeepSize }

// The pointer's ray, shared by every hit test (one at a time, all on the main thread).
const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
/** a rig's group → its hamster, filled afresh for each hit test rather than allocated for it */
const owners = new Map<THREE.Object3D, string>()
const ownerList: THREE.Object3D[] = []
/** when the studio last looked for scenes whose session is gone (the render loop's clock) */
let sweptAt = 0

// Inline styles the render loop writes, as it last wrote them: most frames change nothing, and a
// style write the browser has to look at costs more than the comparison that skips it.
const written = new WeakMap<HTMLElement, Record<string, string>>()
type Prop = 'display' | 'opacity' | 'visibility' | 'transform' | 'cursor' | 'width' | 'height'
function put(el: HTMLElement, prop: Prop, value: string): void {
  let w = written.get(el)
  if (!w) {
    w = {}
    written.set(el, w)
  }
  if (w[prop] === value) return
  w[prop] = value
  el.style[prop] = value
}
function putText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text
}
function putClass(el: HTMLElement, name: string): void {
  if (el.className !== name) el.className = name
}

function DeskStudioView({ session, height, fx = NO_FX, story = false, shut = false, keep }: DeskStudioProps) {
  const u = useUi()
  /** the hidden line that tells a screen reader (and `aria-describedby`) what the studio's keys do */
  const keysId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasHost = useRef<HTMLDivElement>(null)
  const feeds = useRef(new Map<string, HTMLDivElement>())
  const plates = useRef(new Map<string, HTMLDivElement>())
  const glyphs = useRef(new Map<string, HTMLDivElement>())
  /** the line from a feed that had to move aside back to its hamster's head (declutter.ts) */
  const tails = useRef(new Map<string, HTMLDivElement>())
  /** where each feed was pushed last frame, so the next frame keeps pushing the same way */
  const shifts = useRef(new Map<string, Shift>())
  /**
   * The feeds' and the card's sizes, as the browser last laid them out. The render loop needs them
   * to keep the bubbles apart, and reading a size back right after writing positions would make the
   * browser lay the page out again in the middle of every frame; a ResizeObserver hears of the
   * changes after layout instead, which is also the only time they happen.
   */
  const sizes = useRef(new WeakMap<Element, { w: number; h: number }>())
  const sizeObs = useRef<ResizeObserver | null>(null)
  /** what the observer watches; the ones that have left the page are let go of every SWEEP_MS */
  const observed = useRef(new Set<Element>())
  const observe = (el: Element): void => {
    if (observed.current.has(el)) return
    sizeObs.current ??= new ResizeObserver((entries) => {
      for (const e of entries) {
        const box = e.borderBoxSize?.[0]
        sizes.current.set(e.target, box ? { w: box.inlineSize, h: box.blockSize } : { w: e.contentRect.width, h: e.contentRect.height })
      }
    })
    observed.current.add(el)
    sizeObs.current.observe(el)
  }
  /** the card for the hamster under the pointer, or the one a tap pinned (DOM, placed by the render loop) */
  const card = useRef<HTMLDivElement>(null)
  /** the card's `12분 3초`, written by the render loop as the clock moves */
  const cardSince = useRef<HTMLSpanElement>(null)
  /** the camera's basis for this frame's projections (office-camera.ts `basisOf`) */
  const frameBasis = useRef(makeBasis())
  /** the pointer over the studio (client px) while it is not dragging anything; hit tested once a frame */
  const pointer = useRef<{ x: number; y: number } | null>(null)
  /** a drag, a hamster in the hand or a press on one is under way: nothing is hovered meanwhile */
  const gesture = useRef(false)
  /**
   * The print the pointer was found over last. The render loop only tells the prints when that
   * answer changes, so a print lit by something else — the capture script's `hoverSign` — stays lit.
   */
  const hotRef = useRef<HungSign | null>(null)
  /** the last time the user worked the studio (pace.ts `INPUT_HOLD_MS`) */
  const inputAt = useRef(0)
  const viewportPolygon = useRef<SVGPolygonElement>(null)
  /** the caption under a wall print while the pointer is over it */
  const signTip = useRef<HTMLDivElement>(null)
  /** the blast's white-out over the whole studio (styles.css `.office-flash`), driven by the render loop */
  const flash = useRef<HTMLDivElement>(null)
  const fxRef = useRef(fx)
  fxRef.current = fx
  /** the story on screen, with everything it has to put back (startFoldRun / endFoldRun) */
  const foldRun = useRef<FoldRun | null>(null)
  /** true while a story plays: the pointer takes hold of nothing then (the hamsters are not themselves) */
  const fxOn = useRef(false)
  /** the story mix drawn last frame (0 while nothing plays) */
  const storyMixNow = useRef(0)
  const [zoom, setZoom] = useState(250)
  const [selected, setSelected] = useState('main')
  const [showMap, setShowMap] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [noGl, setNoGl] = useState(false)
  // The card that says who a hamster is: for the one under the pointer, or — after a tap on it —
  // pinned to that one until a tap elsewhere, Esc, or it leaves. The refs are the render loop's copy.
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const hoverRef = useRef(hoverId)
  hoverRef.current = hoverId
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  // Automatic framing keeps every present hamster in view. Any manual gesture switches it off;
  // ⌂ switches it back on. The scene holds the truth (the render loop reads it); this state only
  // draws the button, and the preference remembers the answer across restarts.
  const [autoFrame, setAutoFrameState] = useState(useDesk.getState().prefs.autoCam)
  const setAuto = (on: boolean): void => {
    sceneFor().auto.on = on
    setAutoFrameState(on)
    if (useDesk.getState().prefs.autoCam !== on) useDesk.getState().setPrefs({ autoCam: on })
  }
  // (every manual gesture is the user at the studio: the frames after it are drawn at the full rate, pace.ts)
  const manual = (): void => {
    inputAt.current = performance.now()
    if (sceneFor().auto.on) setAuto(false)
  }
  /** DOM nodes the render loop has already hidden once, so a re-render does not blank them again */
  const primed = useRef(new WeakSet<HTMLElement>())
  const dismissFeedItem = useDesk((s) => s.dismissFeedItem)
  const requestLogReveal = useDesk((s) => s.requestLogReveal)
  // The welcome card can start claude for the user, but only in a terminal this window owns:
  // an external session's tab has no pty of ours to type into.
  const activeTab = useDesk((s) => s.activeTab)
  const workspaces = useDesk((s) => s.workspaces)
  const welcomeWs = workspaces.find((w) => `ws:${w.id}` === activeTab) ?? null
  const welcomePty = welcomeWs?.ptyId ?? null
  const runInShell = (cmd: string): void => {
    if (welcomePty !== null) runInTerminal(welcomePty, cmd)
  }
  // `claude 실행` carries data-debug-click="welcome-run"; src/dev/debug.ts presses it, like every
  // other button a blind capture run drives. (This used to be a special case right here.)
  const size = useRef({ w: 800, h: height })
  const sessionRef = useRef(session)
  sessionRef.current = session
  const selectionRef = useRef(selected)
  selectionRef.current = selected

  const sceneFor = (): Scene => {
    const key = sessionRef.current?.info.sessionId ?? 'empty'
    let scene = scenes.get(key)
    if (!scene) { scene = makeScene(); scenes.set(key, scene) }
    return scene
  }
  const list = session ? session.order.map((id) => session.hamsters[id]).filter(Boolean) : []
  const scene = sceneFor()
  reconcileSeats(scene.seats, list.map((h) => h.id))
  const overflow = list.filter((h) => !scene.seats.has(h.id)).length
  const active = list.filter((h) => !['idle', 'waiting', 'leaving'].includes(h.state)).length
  const waiting = list.filter((h) => h.state === 'waiting').length

  const zoomShown = useRef(250)
  const updateZoom = (): void => {
    const z = Math.round(sceneFor().camera.scale * 100)
    if (z === zoomShown.current) return
    zoomShown.current = z
    setZoom(z)
  }
  /** Look at one hamster (the follow menu, a double-click): its seat, or its place in the queue. A manual view. */
  const focus = (id = 'main'): void => {
    const s = sceneFor()
    const k = s.seats.get(id)
    const walker = s.walkers.get(id)
    const at = k !== undefined ? OFFICE.slots[k].seat : walker ? { i: walker.i, j: walker.j } : id === 'main' ? OFFICE.slots[0].seat : null
    if (!at) return
    manual()
    focusCamera(s.camera, tileToWorld(at.i, at.j), size.current.w, size.current.h)
    setSelected(id)
    updateZoom()
  }
  /** A tap on a hamster: select it and pin its card — a second tap on the same one lets go. */
  const tap = (id: string): void => {
    setSelected(id)
    setPinned((p) => (p === id ? null : id))
  }
  /** the user did something to the studio: draw at the full rate for a moment (pace.ts) */
  const input = (): void => {
    inputAt.current = performance.now()
  }
  /** ⌂: back to automatic framing. With only the main hamster present that is the 250% desk view. */
  const home = (): void => {
    const s = sceneFor()
    s.auto.target = null
    inputAt.current = performance.now()
    setAuto(true)
    setSelected('main')
  }
  const overview = (): void => {
    manual()
    const st = getStudio()
    const bounds = st ? st.world.bounds : { minX: 0, maxX: WORLD_W, minZ: 0, maxZ: WORLD_D }
    overviewCamera(sceneFor().camera, bounds, size.current.w, size.current.h)
    updateZoom()
  }
  const zoomBy = (factor: number): void => {
    manual()
    const s = size.current
    const c = sceneFor().camera
    zoomCamera(c, c.scale * factor, s.w / 2, s.h / 2, s.w, s.h)
    updateZoom()
  }

  // ---- hit tests, for the pointer handlers and the render loop's hover ------------------------
  // `x`/`y` are client pixels and `rect` the studio's box, read once by the caller.
  const aim = (x: number, y: number, rect: DOMRect, st: Studio): void => {
    ndc.set(((x - rect.left) / Math.max(1, rect.width)) * 2 - 1, 1 - ((y - rect.top) / Math.max(1, rect.height)) * 2)
    raycaster.setFromCamera(ndc, st.camera)
  }
  /**
   * The hamster under a point, if any: one of the rigs' meshes hit by the ray — not one already in
   * the air, and not one walking out that the session has already let go of. Nothing while a fold
   * story plays: the hamsters are being blown up or dropped in then, not for taking.
   */
  const hamsterUnder = (x: number, y: number, rect: DOMRect): string | null => {
    const st = getStudio()
    const here = sessionRef.current?.hamsters
    if (!st || !here || fxOn.current) return null
    const world = sceneFor()
    owners.clear()
    ownerList.length = 0
    for (const [id, rs] of world.rigs) {
      if (!rs.rig.group.visible || !here[id] || world.flights.some((f) => f.id === id)) continue
      owners.set(rs.rig.group, id)
      ownerList.push(rs.rig.group)
    }
    if (!ownerList.length) return null
    aim(x, y, rect, st)
    const hit = raycaster.intersectObjects(ownerList, true)[0]
    let o: THREE.Object3D | null = hit ? hit.object : null
    while (o && !owners.has(o)) o = o.parent
    return o ? owners.get(o) ?? null : null
  }
  /**
   * The wall print under a point, if any — a plane is one-sided, so nothing hits from behind the
   * wall. A name plate over it wins: plates let the pointer through (so the canvas can be dragged
   * across them), but a label on top of a print is what the eye is on.
   */
  const signUnder = (x: number, y: number, rect: DOMRect): HungSign | null => {
    const st = getStudio()
    if (!st || !st.signs.length || fxOn.current) return null
    for (const plate of plates.current.values()) {
      if (plate.style.display === 'none') continue
      const r = plate.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return null
    }
    aim(x, y, rect, st)
    const hit = raycaster.intersectObjects(st.signs.map((s) => s.mesh), false)[0]
    return hit ? st.signs.find((s) => s.mesh === hit.object) ?? null : null
  }

  // The studio's keys, while it has the focus itself (Tab reaches it; a click does not take it
  // from the terminal): arrows pan, + and − zoom, Home is ⌂, Esc lets go of a pinned card.
  const onKey = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (e.target !== e.currentTarget || e.ctrlKey || e.altKey || e.metaKey) return
    const { w, h } = size.current
    const step = PAN_STEP * (e.shiftKey ? 3 : 1)
    const pan = (dx: number, dy: number): void => {
      manual()
      panCamera(sceneFor().camera, { x: w / 2, y: h / 2 }, { x: w / 2 - dx, y: h / 2 - dy }, w, h)
    }
    switch (e.key) {
      case 'ArrowLeft': pan(-step, 0); break
      case 'ArrowRight': pan(step, 0); break
      case 'ArrowUp': pan(0, -step); break
      case 'ArrowDown': pan(0, step); break
      case '+':
      case '=': zoomBy(1.25); break
      case '-':
      case '_': zoomBy(0.8); break
      case 'Home': home(); break
      case 'Escape':
        if (!pinnedRef.current) return
        setPinned(null)
        break
      default: return
    }
    input()
    e.preventDefault()
  }

  useEffect(() => {
    setSelected('main')
    setPinned(null)
    setHoverId(null)
    // a session's scene keeps its own camera and framing mode; a fresh one starts automatic
    setAutoFrameState(sceneFor().auto.on)
    updateZoom()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.info.sessionId])

  // The print's caption and the canvas's label are the two strings the studio paints outside React:
  // put them into the language the UI is in, on mount and whenever it changes.
  useEffect(() => {
    repaintSigns()
    getStudio()?.renderer.domElement.setAttribute('aria-label', u.studio.canvasLabel(OFFICE.slots.length))
  }, [u])

  // the observer that measures the feeds and the card goes with the component
  useEffect(() => () => {
    sizeObs.current?.disconnect()
    sizeObs.current = null
    observed.current.clear()
  }, [])

  // A row of the speech-bubble log was clicked: look at whoever said it. Same shape as the
  // terminal's focus request — a stamped request in the store, acted on by whoever can.
  //
  // The stamp is also what keeps a *remount* quiet: folding the studio away and bringing it back
  // builds a new component with the old request still in the store, and without this it would
  // yank the camera to whatever was clicked minutes ago.
  const hamsterFocus = useDesk((s) => s.focusHamster)
  const handledFocus = useRef(useDesk.getState().focusHamster?.at ?? 0)
  useEffect(() => {
    if (!hamsterFocus || hamsterFocus.at <= handledFocus.current) return
    handledFocus.current = hamsterFocus.at
    if (hamsterFocus.sessionId !== session?.info.sessionId) return
    focus(hamsterFocus.hid)
    setSelected(hamsterFocus.hid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hamsterFocus])

  // Capture-script hook. Only in the browser preview: the capture script has to drive the camera
  // and the hamsters' states, and there is no other way to reach them from outside the component.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('studio-demo')) return
    const sessionId = (): string | null => sessionRef.current?.info.sessionId ?? null
    window.__studio = {
      focus(idOrTile, scale) {
        const s = sceneFor()
        manual()
        const at = typeof idOrTile === 'string' ? OFFICE.slots[s.seats.get(idOrTile) ?? 0].seat : idOrTile
        focusCamera(s.camera, tileToWorld(at.i, at.j), size.current.w, size.current.h, scale ?? 2.5)
        if (typeof idOrTile === 'string') setSelected(idOrTile)
        updateZoom()
      },
      zoom(scale) {
        manual()
        const { w, h } = size.current
        zoomCamera(sceneFor().camera, scale, w / 2, h / 2, w, h)
        updateZoom()
      },
      orbit(dyaw, dpitch) {
        manual()
        orbitCamera(sceneFor().camera, dyaw, dpitch)
      },
      say(id, text) {
        const sid = sessionId()
        if (!sid) return
        useDesk.getState().apply({ kind: 'text', sessionId: sid, agentId: id === 'main' ? null : id, text, ts: Date.now() })
      },
      act(id, label) {
        const sid = sessionId()
        if (!sid) return
        const ts = Date.now()
        const agentId = id === 'main' ? null : id
        const toolUseId = `dbg-${ts}-${Math.random().toString(36).slice(2, 7)}`
        const apply = useDesk.getState().apply
        apply({ kind: 'tool', sessionId: sid, agentId, toolUseId, name: 'Bash', action: 'run', label, file: null, ts })
        apply({ kind: 'tool_done', sessionId: sid, agentId, toolUseId, ok: true, ts })
      },
      feedLife(p) {
        setFeedLife(p)
      },
      autoFrame(on) {
        if (on) home()
        else manual()
      },
      patrol(mode) {
        setPatrolMode(mode)
      },
      hoverSign(index) {
        const st = getStudio()
        if (st) setSignHot(st.signs, index === null ? null : st.signs[index] ?? null)
      },
      pin(id) {
        if (id) setSelected(id)
        setPinned(id)
      },
      fold() {
        const now = fxRef.current
        let hidden = 0
        for (const rs of sceneFor().rigs.values()) if (!rs.rig.group.visible) hidden++
        return { phase: now.phase, age: foldRun.current ? foldAge(now, performance.now()) : 0, hidden, flash: flash.current?.style.opacity ?? '' }
      },
      setStates(map) {
        const id = sessionId()
        if (!id) return
        useDesk.setState((st) => {
          const sess = st.sessions[id]
          if (!sess) return {}
          const hamsters = { ...sess.hamsters }
          for (const [hid, v] of Object.entries(map)) {
            if (hamsters[hid]) hamsters[hid] = { ...hamsters[hid], state: v.state, since: v.since ?? Date.now() }
          }
          return { sessions: { ...st.sessions, [id]: { ...sess, hamsters } } }
        })
      },
      addArriving(id, model, agentType) {
        const sid = sessionId()
        if (!sid) return
        const ts = Date.now()
        const apply = useDesk.getState().apply
        apply({ kind: 'agent_start', sessionId: sid, agentId: id, agentType, description: ui().studio.newColleague, toolUseId: null, depth: 1, background: false, ts })
        apply({ kind: 'model', sessionId: sid, agentId: id, model, effort: 'high', ts })
      },
    }
    return () => { delete window.__studio }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // mount: hand the singleton renderer's canvas to this instance
  useEffect(() => {
    const host = canvasHost.current!
    const st = getStudio()
    if (!st) { setNoGl(true); return }
    const canvas = st.renderer.domElement
    canvas.className = 'desk-canvas'
    canvas.setAttribute('aria-label', ui().studio.canvasLabel(OFFICE.slots.length))
    host.appendChild(canvas)
    return () => {
      if (canvas.parentNode === host) host.removeChild(canvas)
    }
  }, [])

  useEffect(() => {
    const el = wrapRef.current!
    // sized by the canvas host, not the pane: during a fold story the pane slides while the host
    // keeps its size (styles.css `.is-story .desk-canvas-host`); the pointer and wheel listeners
    // below stay on the pane, so the overlays and a synthetic event on the pane reach them
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      size.current = { w: Math.max(1, Math.floor(rect.width)), h: Math.max(1, Math.floor(rect.height)) }
      const st = getStudio()
      if (!st) return
      st.renderer.setSize(size.current.w, size.current.h, false)
      st.camera.aspect = size.current.w / size.current.h
      st.camera.updateProjectionMatrix()
    })
    ro.observe(canvasHost.current!)
    // The three buttons do three things and nothing else. The left button only ever takes hold of
    // something — a hamster (grab.ts), or a print on the wall on a click — and never moves the
    // camera; the middle button pans (the look-around the left button used to do) and the right
    // one orbits. So: `drag` is the middle or right button moving the camera, and `press` the left
    // button held on nothing, which turns into a click if it lets go within a few pixels of where
    // it went down.
    let drag: { id: number; x: number; y: number; orbit: boolean } | null = null
    let press: { id: number; x0: number; y0: number } | null = null
    // A hamster in the hand (grab.ts): which pointer holds it, and the scene it belongs to — a tab
    // switch mid-drag must let go of the one that was picked up, not of the new scene's nothing.
    let grabbing: { pointer: number; scene: Scene } | null = null
    // The left button on a hamster is a question until the pointer moves or time passes: let go
    // within TAP_PX and TAP_MS and it was a tap (select it, pin its card); move further, or hold
    // still longer, and it picks the hamster up. `hand` is where the hand met it on the carrying
    // plane, so the lift keeps the offset the press had rather than jumping into the hand.
    let pending: { pointer: number; id: string; scene: Scene; hand: { x: number; z: number }; x0: number; y0: number; t0: number; timer: number } | null = null
    const overUi = (e: Event): boolean => !!(e.target as HTMLElement).closest('[data-office-ui]')
    const client = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
      const rect = el.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    /** where the pointer is on the plane the hand carries at — the scruff of a hamster hanging at LIFT — seen by `sc`'s camera */
    const handAt = (e: { clientX: number; clientY: number }, sc: Scene): { x: number; z: number } | null => {
      const p = client(e)
      return planeHit(sc.camera, p.x, p.y, size.current.w, size.current.h, H_OFFICE + LIFT + SCRUFF)
    }
    /** nothing is under the pointer any more, as far as the prints, the cursor and the card go */
    const unhover = (): void => {
      pointer.current = null
      hotRef.current = null
      const st = getStudio()
      if (st) setSignHot(st.signs, null)
    }
    const lift = (p: NonNullable<typeof pending>, e: { clientX: number; clientY: number } | null): void => {
      window.clearTimeout(p.timer)
      pending = null
      const rs = p.scene.rigs.get(p.id)
      // gone meanwhile, or a fold story began: nothing to pick up
      if (!rs || fxOn.current) {
        gesture.current = false
        return
      }
      const at = rs.rig.group.position
      p.scene.hold = grab(p.id, { x: at.x, y: at.y, z: at.z }, p.hand, p.t0)
      if (e) carry(p.scene.hold, handAt(e, p.scene), performance.now())
      const walker = p.scene.walkers.get(p.id)
      if (walker) {
        walker.path = []
        walker.moving = false
      }
      // the boss lifted off its rounds is not on them any more
      if (p.id === 'main') p.scene.patrol = makePatrol()
      grabbing = { pointer: p.pointer, scene: p.scene }
      setDragging(true)
    }
    // A wheel is a zoom, as it always was — but a trackpad has no middle button to pan with, so its
    // gestures get their own meanings: a pinch (which the browser reports as a wheel with Ctrl held)
    // zooms in fine steps, and a two-finger swipe with any sideways part — or any wheel with Shift —
    // pans the view, the way a page scrolls.
    const wheel = (e: WheelEvent): void => {
      if (overUi(e)) return
      e.preventDefault()
      const p = client(e)
      const c = sceneFor().camera
      const { w, h } = size.current
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? h : 1
      manual()
      if (e.ctrlKey) zoomCamera(c, c.scale * Math.exp(-e.deltaY * unit * 0.01), p.x, p.y, w, h)
      else if (e.shiftKey || e.deltaX !== 0) {
        const sideways = e.shiftKey && e.deltaX === 0
        const dx = (sideways ? e.deltaY : e.deltaX) * unit
        const dy = (sideways ? 0 : e.deltaY) * unit
        panCamera(c, { x: w / 2, y: h / 2 }, { x: w / 2 - dx, y: h / 2 - dy }, w, h)
      } else zoomCamera(c, c.scale * Math.exp(-e.deltaY * unit * 0.0015), p.x, p.y, w, h)
      updateZoom()
    }
    const down = (e: PointerEvent): void => {
      if (overUi(e) || grabbing || pending) return
      input()
      if (e.button === 0) {
        // the left button on a hamster is a tap or a pick-up (above); on anything else it is a
        // press that may turn out to be a click on a print — it never pans
        const world = sceneFor()
        const id = hamsterUnder(e.clientX, e.clientY, el.getBoundingClientRect())
        const hand = id ? handAt(e, world) : null
        if (id && hand && world.rigs.has(id)) {
          const p = { pointer: e.pointerId, id, scene: world, hand, x0: e.clientX, y0: e.clientY, t0: performance.now(), timer: 0 }
          // held still that long, a press is a pick-up too: no need to wiggle the pointer first
          p.timer = window.setTimeout(() => {
            if (pending === p) lift(p, null)
          }, TAP_MS)
          pending = p
          gesture.current = true
          unhover()
          el.setPointerCapture(e.pointerId)
          return
        }
        press = { id: e.pointerId, x0: e.clientX, y0: e.clientY }
        return
      }
      if (e.button !== 1 && e.button !== 2) return
      // (the middle button's own meaning, Chromium's autoscroll, is cancelled on `mousedown` below —
      // cancelling this pointerdown instead would suppress that mouse event and leave the autoscroll
      // on, eating every move of the drag)
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, orbit: e.button === 2 }
      gesture.current = true
      put(el, 'cursor', '') // the class's grabbing cursor takes over for the drag
      unhover()
      el.setPointerCapture(e.pointerId)
      setDragging(true)
    }
    const move = (e: PointerEvent): void => {
      if (pending) {
        if (e.pointerId === pending.pointer && Math.hypot(e.clientX - pending.x0, e.clientY - pending.y0) >= TAP_PX) lift(pending, e)
        return
      }
      if (grabbing) {
        input()
        if (e.pointerId === grabbing.pointer && grabbing.scene.hold) carry(grabbing.scene.hold, handAt(e, grabbing.scene), performance.now())
        return
      }
      if (!drag) {
        // What is under the pointer — a print (a link: lifted, lit, captioned, signs.ts), a
        // hamster (the hand that can pick it up, and its card), or nothing — is worked out by the
        // render loop, once a frame: a mouse reports far more often than the screen draws, and it
        // changes under a still pointer too, as the camera eases and the hamsters walk.
        pointer.current = overUi(e) ? null : { x: e.clientX, y: e.clientY }
        input()
        return
      }
      if (e.pointerId !== drag.id) return
      input()
      const rect = el.getBoundingClientRect()
      const c = sceneFor().camera
      if (e.clientX !== drag.x || e.clientY !== drag.y) manual()
      if (drag.orbit) orbitCamera(c, -(e.clientX - drag.x) * 0.005, (e.clientY - drag.y) * 0.005)
      else {
        panCamera(c, { x: drag.x - rect.left, y: drag.y - rect.top }, { x: e.clientX - rect.left, y: e.clientY - rect.top }, size.current.w, size.current.h)
      }
      drag.x = e.clientX
      drag.y = e.clientY
    }
    const up = (e: PointerEvent): void => {
      if (pending) {
        if (e.pointerId !== pending.pointer) return
        const p = pending
        window.clearTimeout(p.timer)
        pending = null
        gesture.current = false
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
        if (e.type === 'pointerup') tap(p.id)
        return
      }
      if (grabbing) {
        if (e.pointerId !== grabbing.pointer) return
        const sc = grabbing.scene
        grabbing = null
        gesture.current = false
        setDragging(false)
        // let go: a drop or a throw, from wherever the hand is — grab.ts decides which
        if (sc.hold) {
          sc.flights.push(release(sc.hold, performance.now()))
          sc.hold = null
        }
        return
      }
      if (press) {
        const p = press
        if (e.pointerId !== p.id) return
        press = null
        // A left click that did not move, on the print: open its site. `window.open` is how every
        // external link leaves the app — electron/main.ts hands it to the default browser through
        // setWindowOpenHandler, so this needs no bridge of its own. On nothing at all, it lets go
        // of a pinned card, the way a click beside a popover closes it.
        if (e.type === 'pointerup' && e.button === 0 && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < TAP_PX) {
          const sign = signUnder(e.clientX, e.clientY, el.getBoundingClientRect())
          if (sign) window.open(sign.url, '_blank', 'noopener')
          else setPinned(null)
        }
        return
      }
      if (!drag) return
      drag = null
      gesture.current = false
      setDragging(false)
    }
    // A double-click on a hamster looks at it (as the follow menu does), with its card pinned — its
    // two clicks were two taps, which pinned the card and let it go again; on the floor, at the boss.
    const dbl = (e: MouseEvent): void => {
      if (overUi(e)) return
      const rect = el.getBoundingClientRect()
      const id = hamsterUnder(e.clientX, e.clientY, rect)
      if (id) {
        focus(id)
        setPinned(id)
      } else if (!signUnder(e.clientX, e.clientY, rect)) focus()
    }
    const leave = (): void => {
      put(el, 'cursor', '')
      unhover()
    }
    const menu = (e: Event): void => e.preventDefault()
    // A press on the studio itself keeps the focus where it was — in the terminal, as a rule, so a
    // click on a hamster does not leave the next keystroke with nowhere to go (the studio is still
    // reached with Tab, for its keys). The middle button pans, so its own meaning, Chromium's
    // autoscroll, goes too — a default action of the mouse events, not the pointer ones, which is
    // why this is on mousedown and on the auxclick after.
    const aux = (e: MouseEvent): void => {
      if (e.type === 'mousedown' ? !overUi(e) : e.button === 1) e.preventDefault()
    }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('lostpointercapture', up)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('dblclick', dbl)
    el.addEventListener('contextmenu', menu)
    el.addEventListener('mousedown', aux)
    el.addEventListener('auxclick', aux)
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('lostpointercapture', up)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('dblclick', dbl)
      el.removeEventListener('contextmenu', menu)
      el.removeEventListener('mousedown', aux)
      el.removeEventListener('auxclick', aux)
      leave()
      if (pending) window.clearTimeout(pending.timer)
      gesture.current = false
      // unmounted mid-drag (the desk folded away): let go, or the hamster hangs in the air for good
      if (grabbing?.scene.hold) {
        grabbing.scene.flights.push(release(grabbing.scene.hold, performance.now()))
        grabbing.scene.hold = null
      }
    }
  }, [])

  /** set by every render of the component: the next frame is drawn whatever the pace says (the store changed, or a button did something) */
  const dirty = useRef(true)
  dirty.current = true
  /** the minimap's viewport outline as last written */
  const polygonDrawn = useRef('')

  /**
   * One frame. Returns whether anything on screen moved the way the eye follows — somebody
   * walking, a hamster in the hand or the air, a story, a print easing, the camera still on its way
   * — which is what earns the next frames the full rate (pace.ts).
   */
  const renderRef = useRef<(t: number, dt: number) => boolean>(() => false)
  renderRef.current = (t, dt) => {
    const st = getStudio()
    if (!st) return false
    const { w: W, h: H } = size.current
    const s = sessionRef.current
    const key = s?.info.sessionId ?? 'empty'
    const world = sceneFor()
    const c = world.camera
    // the studio opens on the main hamster, the same place the ⌂ button goes back to
    if (!c.initialized) focusCamera(c, tileToWorld(OFFICE.slots[0].seat.i, OFFICE.slots[0].seat.j), W, H)
    world.width = W
    world.height = H
    st.uTime.value += dt
    let lively = false

    // ---- what the pointer is over --------------------------------------------------------------
    // Hit tested here, once a frame and before this frame writes anything to the DOM (the plates'
    // boxes are read): a print is a link — the cursor says so and the print answers like a button
    // (signs.ts) — and a hamster is something the hand can take, with a card that says who it is.
    {
      const at = pointer.current
      const el = wrapRef.current
      let sign: HungSign | null = null
      let over: string | null = null
      if (at && el && !gesture.current) {
        const rect = el.getBoundingClientRect()
        sign = signUnder(at.x, at.y, rect)
        over = sign ? null : hamsterUnder(at.x, at.y, rect)
      }
      if (el && !gesture.current) put(el, 'cursor', sign ? 'pointer' : over ? 'grab' : '')
      if (sign !== hotRef.current) {
        hotRef.current = sign
        setSignHot(st.signs, sign)
      }
      if (over !== hoverRef.current) {
        hoverRef.current = over
        setHoverId(over)
      }
    }

    // ---- the fold stories (fold.ts): start, end or cut whichever App.tsx's clock says ----------
    // A story that is over, or replaced by the other one (an unfold in the middle of the blast),
    // is torn down before anything else happens this frame, so a cut is one clean frame.
    const fx = fxRef.current
    let run = foldRun.current
    // the view a story that is being cut short was showing: the next one carries on from there
    let handed: number | null = null
    if (run && (!foldPlaying(fx) || run.phase !== fx.phase || run.since !== fx.since)) {
      handed = storyMixNow.current
      endFoldRun(st, run)
      run = foldRun.current = null
    }
    if (!run && foldPlaying(fx)) run = foldRun.current = startFoldRun(st, world, fx, handed)
    const ft = run ? foldAge(fx, t) : 0
    fxOn.current = !!run
    if (run) lively = true
    /** height of the ground at a world point, or null over the sea — what a thrown hamster and the blast's dust land on */
    const groundAt: GroundAt = (x, z) => {
      const tx = Math.floor(x / T)
      const ty = Math.floor(z / T)
      return st.world.land[ty]?.[tx] ? st.world.heights[ty][tx] : null
    }
    if (run?.blast) tickBlast(run.blast, ft, dt, groundAt, WATER_Y)
    if (run?.build) tickBuild(run.build, ft, dt)
    if (run) {
      VOX_FOLD.blast.value = run.blast ? shockRadius(ft) : BLAST_REST
      liftFixtures(st, run.build ? ft : BUILD_REST, VOX_FOLD.blast.value)
    }
    /** the overlays (plates, glyphs, feeds) stay off while the room is not itself */
    const hideUi = !!run && (!!run.blast || ft < BUILD.HAMMER_END)

    const hams = s ? s.order.map((id) => s.hamsters[id]).filter(Boolean) : []
    reconcileSeats(world.seats, hams.map((h) => h.id))
    const bySeat = new Map<number, Hamster>()
    // Where everybody belongs: its seat, or — past the twelfth colleague — its place in the queue by
    // the door (office-world.ts `LOBBY`), in the order the session lists them, which is the order
    // `reconcileSeats` hands the next free desk out in: the head of the queue is always next.
    const places = new Map<string, Point>()
    let queued = 0
    for (const h of hams) {
      const k = world.seats.get(h.id)
      if (k !== undefined) {
        bySeat.set(k, h)
        places.set(h.id, OFFICE.slots[k].seat)
      } else if (queued < LOBBY.length) places.set(h.id, LOBBY[queued++])
    }

    // ---- desks: screen colour, blinking keys, status lamp, and the glow they spill -----------
    st.world.deskParts.forEach((parts, k) => {
      const dyn = st.deskDynamic[k]
      const h = bySeat.get(parts.slot)
      const state = h?.state ?? 'idle'
      const sc = screenColor(state, t)
      const typing = state === 'writing' || state === 'running'
      dyn.screen.material = flat(h ? sc.bg : '#243c36')
      dyn.keys.material = flat(typing && Math.floor(t / 180) % 2 ? '#ccddc3' : '#8892aa')
      // The screen faces the hamster, so from the room you only see the monitor's back: the light
      // bar across its top is what carries the state to this side. It wears the same accent the
      // screen's own text does, and blinks with a running command the way the screen behind it does.
      const bar = state === 'running' && Math.floor(t / 300) % 2 ? '#166534' : sc.fg
      dyn.lamp.material = flat(h ? bar : '#506358')
      dyn.spill.material = flat(h ? spillOf(sc.bg) : 0x142219)
    })

    // ---- hamsters ----------------------------------------------------------------------------
    let group = st.sessionGroups.get(key)
    if (!group) {
      group = new THREE.Group()
      st.scene.add(group)
      st.sessionGroups.set(key, group)
    }
    for (const [gk, gv] of st.sessionGroups) gv.visible = gk === key

    // A scene outlives its session only until the studio notices: the store drops a session when
    // its claude exits (or on /clear), and every scene kept its camera, its walkers and a group of
    // invisible rigs in the three scene for good. Looked for every SWEEP_MS, not every frame.
    if (t - sweptAt > SWEEP_MS) {
      sweptAt = t
      // (and the feeds that are gone from the page no longer need measuring)
      for (const el of observed.current) {
        if (el.isConnected) continue
        sizeObs.current?.unobserve(el)
        observed.current.delete(el)
      }
      const live = useDesk.getState().sessions
      for (const k of [...scenes.keys()]) {
        if (k === key || k === 'empty' || live[k]) continue
        scenes.delete(k)
        const g = st.sessionGroups.get(k)
        if (g) {
          st.scene.remove(g)
          st.sessionGroups.delete(k)
        }
      }
    }

    // ---- the hamster in the hand, and the ones in the air (grab.ts) -------------------------
    // A held one eases up to carrying height; a thrown one flies until it lands (and walks home
    // from there) or hits the water (a splash, a short sink, and a newcomer at the door). Both
    // are pantomime: the store never hears of it. A hamster the session has since dropped is
    // simply forgotten mid-air.
    if (world.hold && !hams.some((h) => h.id === world.hold!.id)) world.hold = null
    if (world.hold) hang(world.hold, dt)
    if (world.flights.length) {
      const ground: Ground = groundAt
      world.flights = world.flights.filter((f) => {
        if (!hams.some((h) => h.id === f.id)) return false
        const ev = fly(f, dt, ground, WATER_Y)
        if (ev === 'splash') {
          const splash = makeSplash(f.x, WATER_Y, f.z)
          st.scene.add(splash.group)
          st.splashes.push(splash)
        } else if (ev === 'landed') {
          // On its feet: from here it walks back to its place, out of the furniture first if it
          // fell on some — by the lanes, or round the building, but never by `walkTo`, whose
          // corridor legs would start right where it stands and cut through a desk or a wall.
          const walker = world.walkers.get(f.id)
          const home = places.get(f.id)
          if (walker && home) {
            const spot = landingSpot(worldToTile(f))
            walker.i = spot.i
            walker.j = spot.j
            walker.moving = false
            walker.target = { ...home }
            walker.path = returnPath(spot, home)
            walker.free = true
          } else world.walkers.delete(f.id) // it has no place on the floor any more: put back where it belongs next frame
          return false
        } else if (ev === 'gone') {
          // in the sea: a different hamster (vox/hamster.ts `variant`) walks in through the door
          const rs = world.rigs.get(f.id)
          if (rs) {
            group!.remove(rs.rig.group)
            world.rigs.delete(f.id)
          }
          world.variants.set(f.id, (world.variants.get(f.id) ?? 0) + 1)
          world.walkers.set(f.id, makeWalker(OFFICE.door))
          return false
        }
        return true
      })
    }
    /** hamsters not on the floor this frame: in the hand or in the air */
    const carried = new Set<string>(world.flights.map((f) => f.id))
    if (world.hold) carried.add(world.hold.id)
    if (carried.size) lively = true
    for (let k = st.splashes.length - 1; k >= 0; k--) {
      const sp = st.splashes[k]
      lively = true
      if (tickSplash(sp, dt)) continue
      st.scene.remove(sp.group)
      disposeSplash(sp)
      st.splashes.splice(k, 1)
    }

    // ---- the boss's rounds (patrol.ts) ------------------------------------------------------
    // Decided from last frame's walkers, before anybody moves this frame: who is seated and
    // working, where the boss stands, and whether it has said something real since the round
    // began. The machine only ever reads the store; what it decides is applied to the rigs below.
    {
      const boss = s?.hamsters.main
      const bw = world.walkers.get('main')
      if (run) {
        // a fold story freezes the rounds where they are, like everything else on the floor
      } else if (boss && bw && !carried.has('main')) {
        const workers: { id: string; seat: { i: number; j: number } }[] = []
        for (const h of hams) {
          // a colleague in the user's hand is off its chair, so a round on it is cut short
          if (h.id === 'main' || !WORKING.has(h.state) || carried.has(h.id)) continue
          const k = world.seats.get(h.id)
          const w = world.walkers.get(h.id)
          // seated means on the chair — not merely standing still (a newcomer at the door has no path yet either)
          if (k !== undefined && w && near(w, OFFICE.slots[k].seat)) workers.push({ id: h.id, seat: OFFICE.slots[k].seat })
        }
        let said = ''
        for (let k = boss.feed.length - 1; k >= 0; k--) if (boss.feed[k].kind === 'say') { said = boss.feed[k].id; break }
        stepPatrol(world.patrol, { now: Date.now(), workers, boss: { state: boss.state, at: { i: bw.i, j: bw.j }, said } })
      } else if (world.patrol.phase !== 'idle' || world.patrol.at) {
        world.patrol = makePatrol() // no boss on screen: whatever round was on is over
      }
    }
    const patrol = world.patrol

    // every projection of this frame goes through one basis of the camera as it stands now
    const basis = basisOf(c, frameBasis.current)
    const scale = c.scale
    /** the feeds on screen this frame, for the declutter pass after the loop */
    const boxes: FeedBox[] = []
    const seen = new Set<string>()
    const unseen = new Set<string>()
    hams.forEach((h) => {
      seen.add(h.id)
      const index = world.seats.get(h.id)
      const plate = plates.current.get(h.id)
      const feed = feeds.current.get(h.id)
      const glyph = glyphs.current.get(h.id)
      const home = places.get(h.id)
      if (!home) {
        // neither a desk nor a place in the queue: waiting out of sight until one opens up, when
        // it walks in through the door (`unseen`)
        unseen.add(h.id)
        const idle = world.rigs.get(h.id)
        if (idle) idle.rig.group.visible = false
        world.walkers.delete(h.id)
        if (plate) put(plate, 'display', 'none')
        if (feed) {
          put(feed, 'opacity', '0')
          put(feed, 'visibility', 'hidden')
        }
        if (glyph) put(glyph, 'display', 'none')
        return
      }
      const slot = index !== undefined ? OFFICE.slots[index] : null
      let walker = world.walkers.get(h.id)
      if (!walker) {
        // a newcomer walks in at the door, and so does one whose place in the queue has just come
        // into view; one that is already here when the studio opens (a remount, a tab switch) is
        // simply in its place
        walker = makeWalker(h.state === 'arriving' || world.unseen.has(h.id) ? OFFICE.door : home)
        world.walkers.set(h.id, walker)
      }
      const held = world.hold?.id === h.id ? world.hold : null
      const flight = held ? null : world.flights.find((f) => f.id === h.id) ?? null
      const inHand = !!(held || flight)
      // The boss may be out on its rounds, and for those it takes the direct lanes rather than
      // the door corridor; everybody else only ever walks the corridor to a seat, a place in the
      // queue or the door — unless a throw left it off the corridor (`Walker.free`), when the lanes
      // or the way round the building take it home. In the hand or in the air it walks nowhere:
      // the walker waits where it was picked up until it lands, and the landing sets it down and
      // gives it the way home (above). A fold story freezes every walker where it is, and they
      // carry on from there when it is over.
      if (!inHand && !run) {
        const goal = h.state === 'leaving' ? OFFICE.door : home
        if (h.id === 'main' && patrol.phase !== 'idle') walkDirect(walker, patrolGoal(patrol) ?? home)
        else if (walker.free) {
          if (!near(walker.target, goal)) {
            walker.target = { ...goal }
            walker.path = returnPath(walker, goal)
          }
        } else walkTo(walker, goal)
        advanceWalker(walker, dt)
        if (walker.free && !walker.path.length) walker.free = false // home: back on the corridor's network
        if (walker.moving) lively = true
      }

      const skin = modelSkin(h.model)
      const variant = world.variants.get(h.id) ?? 0
      const rigKey = `${skin.family}|${skin.accessory}|${tintFor(h.agentType)}|${h.id === 'main'}|${coatOf(variant)}`
      let rs = world.rigs.get(h.id)
      if (!rs || rs.key !== rigKey) {
        if (rs) group!.remove(rs.rig.group)
        const rig = buildHamster({ skin, tint: tintFor(h.agentType), main: h.id === 'main', variant }, st.hamsterMat)
        rs = { rig, key: rigKey, yaw: 0 }
        group!.add(rig.group)
        world.rigs.set(h.id, rs)
      }
      rs.rig.group.visible = true

      // Arriving/leaving are lifecycle states. Only an actual path plays the walk cycle. The boss
      // on its rounds is out of its chair until it is back at the desk; one in the queue stands.
      const away = h.id === 'main' && bossAway(patrol, walker)
      const seated = !!slot && !inHand && !walker.path.length && h.state !== 'leaving' && !away
      // the two halves of a telling-off override whatever the states would otherwise play
      const part: IsoAnim | null =
        h.id === 'main' ? (patrol.phase === 'scolding' ? 'scold' : null) : patrol.phase === 'scolding' && patrol.target === h.id ? 'flinch' : null
      // standing in the queue there is no desk to work at: it waits, and waves if it needs the user
      const standing: IsoAnim = h.state === 'waiting' ? 'wave' : 'idle'
      const anim: IsoAnim = inHand ? 'struggle' : walker.moving ? 'walk' : part ?? (['arriving', 'leaving'].includes(h.state) ? 'idle' : slot ? animFor(h.state, Date.now() - h.since) : standing)
      const lifted = held ?? flight
      const pos = lifted ? { x: lifted.x, z: lifted.z } : tileToWorld(walker.i, walker.j)
      // Sitting lays the folded legs (8.4 thick, pinned at rig y 4) across the chair seat and
      // still lifts the short-legged hamster's head and arms clear of the desk top (y 40). SEAT_LIFT
      // is the most the torso can rise and still stay in the cushion through the breathing bob: its
      // underside lands at y 16.5, and ±0.8 of breath never takes it past the seat's own 18.
      const groundY = lifted ? lifted.y : H_OFFICE + (seated ? SEAT_LIFT : 0)
      const scaleF = h.id === 'main' ? MAIN_SCALE : 1
      rs.rig.group.position.set(pos.x, groundY, pos.z)
      // face the way we are walking; standing still we face +z, across the desk and at the camera
      // — unless we are the boss standing over somebody, in which case we face them. In the hand
      // it faces the camera squarely whatever the view: the struggle is for whoever is holding it.
      const next = walker.path[0]
      const victim = part === 'scold' && patrol.target !== null ? world.walkers.get(patrol.target) : undefined
      const targetYaw = inHand
        ? c.yaw
        : walker.moving && next
        ? Math.atan2(next.i - walker.i, next.j - walker.j)
        : victim ? Math.atan2(victim.i - walker.i, victim.j - walker.j) : 0
      turn(rs, targetYaw, dt)
      // dangling from the hand it swings a little; thrown hard it cartwheels the way it is going
      // (the roll is about its own forward axis, which points at the camera); otherwise upright
      const side = flight ? flight.vx * Math.cos(rs.yaw) - flight.vz * Math.sin(rs.yaw) : 0
      rs.rig.group.rotation.z = held
        ? Math.sin((t / 1000) * 5) * 0.12
        : flight && flight.phase === 'air' && Math.hypot(flight.vx, flight.vz) > 200
        ? Math.sign(side || 1) * flight.age * 7
        : 0
      poseRig(rs, anim, seated && !walker.moving, t / 1000)

      // ---- a fold story has the last word on the rig (fold.ts) -------------------------------
      if (run) {
        const noted = run.rigs.get(h.id)
        if (!noted || noted.rig !== rs.rig) run.rigs.set(h.id, { rig: rs.rig, main: h.id === 'main' })
        const g = rs.rig.group
        if (run.blast) {
          // the wave reaches it: thrown outward and up, tumbling, shrinking to nothing, with a
          // burst of ash where it stood (blast.ts)
          const doom = doomOf(run.blast, h.id, pos.x, pos.z, ft)
          if (doom) {
            if (doom.fresh) ashBurst(run.blast, pos.x, groundY + 20, pos.z)
            const d = doomAt(doom.age)
            const dx = pos.x - CENTRE.x
            const dz = pos.z - CENTRE.z
            const len = Math.hypot(dx, dz) || 1
            g.position.set(pos.x + (dx / len) * d.out, groundY + d.up, pos.z + (dz / len) * d.out)
            g.scale.setScalar(scaleF * d.scale)
            g.rotation.x = d.spin
            g.rotation.z = d.spin * 0.6
            g.visible = d.scale > 0
            poseRig(rs, 'struggle', false, t / 1000)
          }
        } else if (run.build) {
          // on the site (build.ts): down from the sky once its tile is there, hard hat on,
          // hammering where it stands until the place is up — then the pose above, in the same
          // spot, takes over and it sits down
          const floor = groundAt(pos.x, pos.z) ?? H_OFFICE
          const b = builder(ft, landTime(pos.x, pos.z, floor))
          if (b.working) {
            g.visible = b.here
            g.position.y = floor + b.height
            poseRig(rs, 'hammer', false, t / 1000)
            if (b.landed) {
              thud(run.build, h.id, pos.x, floor, pos.z)
              wearGear(run.build, h.id, rs.rig, st.hamsterMat)
            }
          } else dropGear(run.build, h.id)
        }
      }

      // ---- DOM overlays ---------------------------------------------------------------------
      const headTop = groundY + (rs.rig.headG.position.y + FEED_ANCHOR) * scaleF
      const deskCentre = slot ? tileToWorld(slot.i + 0.5, slot.j) : null
      const plateWorld = seated && deskCentre
        ? { x: deskCentre.x, y: H_OFFICE + 42, z: deskCentre.z + 26 }
        : { x: pos.x, y: groundY + 4, z: pos.z }
      let plateShown = false
      if (plate) {
        const p = worldToScreen(c, plateWorld, W, H, basis)
        // The queue stands too close together for a plate each — they would lie on top of one
        // another; a queued hamster's feed says its name instead (`is-named` below), and its card.
        plateShown = !hideUi && !!slot && scale >= PLATE_MIN_SCALE && !p.behind && p.x > -60 && p.x < W + 60 && p.y > -20 && p.y < H + 20
        put(plate, 'display', plateShown ? '' : 'none')
        // The boss on its rounds ends up standing just behind and beside a colleague, and a plate
        // centred under its feet lands squarely on that colleague's head — the one thing the
        // telling-off is about. Out of its chair the plate hangs off to the far side instead.
        if (plateShown) put(plate, 'transform', away ? `translate(${Math.round(p.x - 6)}px, ${Math.round(p.y)}px) translate(-100%, 0)` : `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, 0)`)
      }
      if (glyph) {
        // The rounds are told entirely in marks: anger over the boss from the moment it gets up,
        // sweat over whoever it is standing over (with the flinch pose). Emoji, so they read at
        // a wider zoom than the thought glyphs, and the boss keeps its mark while it walks.
        const mark = inHand ? '💦' : h.id === 'main' ? (patrol.phase === 'going' || patrol.phase === 'scolding' ? '💢' : null) : part === 'flinch' ? '💦' : null
        const symbol = mark ?? GLYPH[anim]
        // the boss's mark goes on the far side of its head: the near side is where the colleague
        // it is standing over keeps its own feed rows
        const p = worldToScreen(c, { x: pos.x + (mark && h.id === 'main' ? -14 : 14), y: headTop + 14, z: pos.z }, W, H, basis)
        const show = !hideUi && !!symbol && (mark ? scale >= 0.8 : !walker.moving && scale >= 1.5) && !p.behind && p.x > 0 && p.x < W && p.y > 0 && p.y < H
        put(glyph, 'display', show ? '' : 'none')
        if (show) {
          putText(glyph, symbol as string)
          putClass(glyph, `office-glyph${anim === 'wave' ? ' is-alert' : ''}${mark ? ' is-mark' : ''}`)
          // the little hop makes the glyph read as a thought rather than a label
          put(glyph, 'transform', `translate(${Math.round(p.x)}px, ${Math.round(p.y - (Math.floor(t / 600) % 2) * 3)}px) translate(-50%, -100%)`)
        }
      }
      if (feed) {
        // how many rows this zoom carries — the same answer the automatic framing reserved sky for
        const lines = feedLines(scale)
        const p = worldToScreen(c, { x: pos.x, y: headTop + FEED_RISE, z: pos.z }, W, H, basis)
        const show = !hideUi && lines > 0 && !p.behind && p.x > 70 && p.x < W - 70 && p.y > 40 && p.y < H + 70
        put(feed, 'opacity', show ? '1' : '0')
        // `visibility` takes the rows out of hit testing too; the container itself never gets clicks
        put(feed, 'visibility', show ? '' : 'hidden')
        // With its plate off (too far out, or off the canvas) a feed says whose it is itself: the
        // newest row carries the tie colour and the name (styles.css `.is-named .ob-who`).
        feed.classList.toggle('is-named', show && !plateShown)
        if (show) {
          // placed after the loop, once every feed on screen is known (declutter.ts)
          const box = sizes.current.get(feed)
          boxes.push({ id: h.id, x: p.x, y: p.y, w: box?.w ?? 0, h: box?.h ?? 0 })
          // Each row ages out on its own, and zooming out drops the oldest ones. React must not
          // re-render for either, so which rows are shown, the fade, and the step-back of the rows
          // that got pushed up are all written straight onto the elements here.
          const rows = feed.children
          const now = Date.now()
          const first = Math.max(0, rows.length - lines) // only the newest `lines` rows are drawn
          for (let k = 0; k < rows.length; k++) {
            const row = rows[k] as HTMLElement
            if (k < first) {
              put(row, 'display', 'none')
              continue
            }
            put(row, 'display', '')
            const life = Number(row.dataset.life) || 3000
            const age = now - (Number(row.dataset.ts) || now)
            const fade = Math.min(FEED_FADE, life * 0.5)
            const dying = Math.max(0, Math.min(1, (age - (life - fade)) / fade))
            const back = k < rows.length - 1 // anything but the newest row has been pushed up
            put(row, 'opacity', ((back ? 0.8 : 1) * (1 - dying)).toFixed(2))
            put(row, 'transform', back ? 'scale(0.96)' : '')
          }
        }
      }
    })
    world.unseen = unseen

    // ---- the ones the session has let go of, on their way out --------------------------------
    // A colleague whose report is in walks to the door, and the store takes it off the floor
    // `LEAVE_MS` later — which from the far corner of the room is half-way across it. So the studio
    // keeps a walker it no longer has a hamster for, as long as that walker is still on its way to
    // the door, and only lets the rig go there. Anybody else not here any more goes at once.
    let ghosts = 0
    for (const [id, walker] of world.walkers) {
      if (seen.has(id)) continue
      const rs = world.rigs.get(id)
      if (!run && rs && walker.path.length && near(walker.target, OFFICE.door)) {
        advanceWalker(walker, dt)
        if (walker.path.length) {
          ghosts++
          const at = tileToWorld(walker.i, walker.j)
          rs.rig.group.position.set(at.x, H_OFFICE, at.z)
          const next = walker.path[0]
          turn(rs, Math.atan2(next.i - walker.i, next.j - walker.j), dt)
          rs.rig.group.rotation.z = 0
          rs.rig.group.visible = true
          poseRig(rs, 'walk', false, t / 1000)
          continue
        }
      }
      if (rs) {
        group.remove(rs.rig.group)
        world.rigs.delete(id)
      }
      world.walkers.delete(id)
    }
    for (const [id, rs] of world.rigs) {
      if (!seen.has(id) && !world.walkers.has(id)) {
        group.remove(rs.rig.group)
        world.rigs.delete(id)
      }
    }
    if (ghosts) lively = true

    // ---- keep the bubbles apart (declutter.ts) ------------------------------------------------
    // Nearest the viewer first; a feed that had to move gets a tail back to its hamster's head.
    const moved = declutter(boxes, W, shifts.current, HEADER_PAD)
    shifts.current = moved
    const tailed = new Set<string>()
    for (const b of boxes) {
      const el = feeds.current.get(b.id)
      if (!el) continue
      const m = moved.get(b.id) ?? { dx: 0, dy: 0 }
      const x = Math.round(b.x + m.dx)
      const y = Math.round(b.y + m.dy)
      put(el, 'transform', `translate(${x}px, ${y}px) translate(-50%, -100%)`)
      const tail = tails.current.get(b.id)
      const len = Math.hypot(m.dx, m.dy)
      if (tail && len > TAIL_MIN) {
        // from the bottom of the feed where it now is, back to the head it belongs to
        tailed.add(b.id)
        put(tail, 'height', `${Math.round(len)}px`)
        put(tail, 'transform', `translate(${x}px, ${y}px) rotate(${Math.atan2(m.dx, -m.dy).toFixed(3)}rad)`)
      }
    }
    for (const [id, tail] of tails.current) put(tail, 'display', tailed.has(id) ? '' : 'none')

    // ---- the card: who the hamster under the pointer (or the pinned one) is -------------------
    {
      const el = card.current
      const id = pinnedRef.current ?? hoverRef.current
      const h = id ? s?.hamsters[id] : undefined
      // the pinned one left the office (or the session went): the card goes with it
      if (pinnedRef.current && !s?.hamsters[pinnedRef.current]) {
        pinnedRef.current = null
        setPinned(null)
      }
      const rs = id ? world.rigs.get(id) : undefined
      let shown = false
      if (el && h && rs && rs.rig.group.visible && !hideUi) {
        const g = rs.rig.group.position
        const p = worldToScreen(c, { x: g.x, y: g.y + 34 * (id === 'main' ? MAIN_SCALE : 1), z: g.z }, W, H, basis)
        if (!p.behind && p.x > 0 && p.x < W && p.y > 0 && p.y < H) {
          const box = sizes.current.get(el) ?? { w: 220, h: 96 }
          // beside the hamster, on whichever side has the room
          const x = p.x + 28 + box.w <= W - 8 ? p.x + 28 : p.x - 28 - box.w
          const y = Math.max(8, Math.min(H - box.h - 8, p.y - box.h / 2))
          put(el, 'transform', `translate(${Math.round(x)}px, ${Math.round(y)}px)`)
          if (cardSince.current) putText(cardSince.current, formatDuration(Date.now() - h.since))
          shown = true
        }
      }
      if (el) put(el, 'visibility', shown ? '' : 'hidden')
    }

    // ---- automatic framing: only the hamsters that are actually here ------------------------
    // Not while a hamster is in the hand: the hand is a point under the pointer, so a camera easing
    // away under it would carry off the hamster the pointer is holding still.
    if (world.auto.on && !world.hold) {
      const pts: { x: number; z: number }[] = []
      const ids: string[] = []
      let moving = false
      let out = false
      for (const h of hams) {
        const k = world.seats.get(h.id)
        const walker = world.walkers.get(h.id)
        if (!places.has(h.id) || !walker) continue
        ids.push(h.id)
        // a thrown one is followed through the air the way a walker is, so the splash is seen
        const flight = world.flights.find((f) => f.id === h.id)
        if (flight) {
          moving = true
          pts.push({ x: flight.x, z: flight.z })
          continue
        }
        // the boss out on its rounds is framed where it stands, not where its chair is — the same
        // way a colleague walking in is, so the view follows it over and back; one in the queue
        // is framed where it stands too
        const away = h.id === 'main' && bossAway(patrol, walker)
        if (walker.path.length || away || k === undefined) {
          if (walker.path.length) moving = true
          if (away) out = true
          pts.push(tileToWorld(walker.i, walker.j))
        } else {
          const seat = OFFICE.slots[k].seat
          pts.push(tileToWorld(seat.i, seat.j), tileToWorld(seat.i, seat.j + 1)) // the seat and the desk in front
        }
      }
      // and the ones walking out are followed to the door, as a newcomer is followed in
      for (const [id, walker] of world.walkers) {
        if (seen.has(id) || !walker.path.length) continue
        moving = true
        pts.push(tileToWorld(walker.i, walker.j))
      }
      // Recompute when the occupancy changes or the viewport resizes, and every REFRAME_MS while
      // somebody walks; otherwise keep easing towards the target we already have. The size is in
      // the signature because the framing is measured in pixels — how much sky a feed row needs is
      // the same 26px in a 420-tall desk as in a 700-tall one, so dragging the splitter really does
      // change the answer. It is quantised to 8px so a drag recomputes a handful of times, not
      // every frame. `out` recomputes once when the boss stops beside a colleague and once when it
      // sits back down.
      const sig = `${ids.sort().join(',')}|${Math.round(W / 8)}x${Math.round(H / 8)}${moving ? '|walk' : ''}${out ? '|out' : ''}`
      if (!world.auto.target || sig !== world.auto.key || (moving && t - world.auto.at >= REFRAME_MS)) {
        world.auto.key = sig
        world.auto.at = t
        const target: Camera = { ...c }
        // an empty office still looks at the boss's desk, so ⌂ has somewhere to go
        if (!pts.length) {
          const seat = OFFICE.slots[0].seat
          pts.push(tileToWorld(seat.i, seat.j), tileToWorld(seat.i, seat.j + 1))
        }
        const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
        for (const p of pts) {
          b.minX = Math.min(b.minX, p.x - FRAME_PAD); b.maxX = Math.max(b.maxX, p.x + FRAME_PAD)
          b.minZ = Math.min(b.minZ, p.z - FRAME_PAD); b.maxZ = Math.max(b.maxZ, p.z + FRAME_PAD)
        }
        // one desk is the only case that would otherwise hit the 340% cap; hold it at the 300%
        // close-up it has always had so the room around the hamster does not disappear
        const solo = ids.length <= 1 && !moving
        autoFrameCamera(target, b, W, H, undefined, solo ? SOLO_SCALE : undefined)
        world.auto.target = { tx: target.tx, tz: target.tz, scale: target.scale }
      }
      const goal = world.auto.target
      // ease towards the target — never snap, so a colleague arriving pulls the view over smoothly
      const k = 1 - Math.exp(-dt * FRAME_EASE)
      c.tx += (goal.tx - c.tx) * k
      c.tz += (goal.tz - c.tz) * k
      c.scale += (goal.scale - c.scale) * k
      // still on its way (by more than a fraction of a pixel's worth): the eye is following it
      if (Math.abs(goal.tx - c.tx) > 0.5 || Math.abs(goal.tz - c.tz) > 0.5 || Math.abs(goal.scale - c.scale) > 0.002) lively = true
      updateZoom()
    }

    // ---- the wall prints under the pointer (signs.ts) ---------------------------------------
    // The picture eases up and back on its own clock; the caption sits under the print's bottom
    // edge, where a button's label would be, and follows the print if the camera moves.
    let hotSign: HungSign | null = null
    for (const sg of st.signs) {
      if (tickSignHover(sg, dt)) lively = true
      if (sg.hot || sg.hover > 0) hotSign = sg
    }
    const tip = signTip.current
    if (tip) {
      const spot = hotSign?.spot
      const p = spot ? worldToScreen(c, { x: spot.x, y: spot.y - spot.h / 2 - 6, z: spot.z }, W, H, basis) : null
      const show = !!hotSign?.hot && !!p && !p.behind && p.x > 0 && p.x < W && p.y > 0 && p.y < H
      tip.classList.toggle('is-on', show)
      if (p && !p.behind) {
        // keep the whole caption on the canvas when the print hangs at its edge
        const half = (sizes.current.get(tip)?.w ?? 120) / 2 + 8
        put(tip, 'transform', `translate(${Math.round(Math.max(half, Math.min(W - half, p.x)))}px, ${Math.round(p.y)}px) translate(-50%, 0)`)
      }
    }

    // A story's camera work is done on a copy: the view cuts over to ground zero with the whole
    // island in frame (the blast under its flash, the build from its first frame) and the build
    // eases home before the hats come off (fold.ts `storyMix`). The camera state never learns of
    // it, so the view after a story is the view before it — and a right-drag during the story
    // still turns the room, which is why the story's framing is bisected again when the
    // orientation or the size changes.
    let view: Camera = c
    const k = run ? storyMix(run.phase, ft, run.mixFrom) : 0
    storyMixNow.current = k
    if (run) {
      if (k > 0) {
        const key = `${W}x${H}|${c.yaw.toFixed(3)}|${c.pitch.toFixed(3)}`
        if (!run.view || run.view.key !== key) {
          // the zoom the story started from, not the one the auto camera is easing through now
          const base = run.view?.base ?? c.scale
          const cam: Camera = { ...c }
          overviewCamera(cam, storyBounds(), W, H)
          focusCamera(cam, CENTRE, W, H, storyScale(base, cam.scale), H * STORY_DROP)
          run.view = { key, cam, base }
        }
        view = { ...c, ...blendView(c, run.view.cam, k) }
      }
    }
    applyTo(st.camera, view, W, H)
    if (run?.blast) {
      // the tremor, on the three camera alone
      const sh = shakeOffset(ft, distanceFor(view.scale))
      st.camera.position.x += sh.x
      st.camera.position.y += sh.y
      st.camera.position.z += sh.z
    }
    if (flash.current) {
      const a = run?.blast ? flashAlpha(ft) : 0
      put(flash.current, 'opacity', a > 0 ? a.toFixed(3) : '0')
    }
    st.sky.position.copy(st.camera.position)
    if (!document.hidden) st.renderer.render(st.scene, st.camera)

    if (viewportPolygon.current) {
      const pts = viewportGroundPolygon(c, W, H)
        .map((p) => `${((p.x / WORLD_W) * 100).toFixed(2)},${((p.z / WORLD_D) * 100).toFixed(2)}`)
        .join(' ')
      if (pts !== polygonDrawn.current) {
        polygonDrawn.current = pts
        viewportPolygon.current.setAttribute('points', pts)
      }
    }
    return lively
  }

  // The frame loop, paced (pace.ts): the display's rate only while something moves that the eye
  // follows or the user is at the studio, less when it is calm, less again behind other windows and
  // in the mini window — where the picture also drops to the cheaper tier. A frame is drawn at once,
  // whatever the pace, after anything React changed (`dirty`): a new bubble never waits.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lively = true
    /** since when the window has been without the focus (the render loop's clock), for the quality tier */
    let blurred: number | null = null
    const tick = (t: number): void => {
      raf = requestAnimationFrame(tick)
      const focused = document.hasFocus()
      const mini = useDesk.getState().mini
      const fps = frameRate({ focused, mini, lively, input: t - inputAt.current < INPUT_HOLD_MS })
      if (!dirty.current && !frameDue(t - last, fps)) return
      dirty.current = false
      const st = getStudio()
      if (st) {
        if (focused) blurred = null
        else blurred ??= t
        setQuality(st, qualityFor({ mini, unfocusedFor: blurred === null ? 0 : t - blurred }))
      }
      lively = renderRef.current(t, Math.min(0.1, (t - last) / 1000))
      last = t
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      // unmounted mid-story (the blast has folded the studio away, or the tab closed under a
      // build): everything the story moved goes back now, not on a frame that will never come
      const run = foldRun.current
      if (run) {
        const st = getStudio()
        if (st) endFoldRun(st, run)
        foldRun.current = null
      }
      fxOn.current = false
    }
  }, [])

  const studioRef = getStudio()
  // the card: the pinned hamster, else the one under the pointer — who it is, what it runs on,
  // what it is doing and since when, and the last thing it said (from the log once its bubbles are gone)
  const cardId = pinned ?? hoverId
  const cardHam = cardId && session ? session.hamsters[cardId] ?? null : null
  let cardLog: SessionState['log'][number] | null = null
  if (cardHam && session) {
    for (let k = session.log.length - 1; k >= 0; k--) {
      if (session.log[k].hid === cardHam.id) {
        cardLog = session.log[k]
        break
      }
    }
  }
  const cardLine = cardHam && cardHam.feed.length ? cardHam.feed[cardHam.feed.length - 1].text : cardLog?.text ?? null
  const cardPinned = !!pinned && !!cardHam
  /** somewhere to stand for a hamster: a desk, or a place in the visible queue (the follow menu can look at either) */
  const placed = (id: string): boolean => scene.seats.has(id) || scene.walkers.has(id)
  return (
    <section
      ref={wrapRef}
      className={`desk-wrap desk-studio ${dragging ? 'is-dragging' : ''} ${story ? 'is-story' : ''} ${shut ? 'is-shut' : ''}`}
      style={{ height, ...(story && keep ? { ['--keep-h' as string]: `${keep.h}px`, ['--keep-w' as string]: keep.w === null ? '100%' : `${keep.w}px` } : {}) }}
      aria-label={u.studio.label}
      aria-describedby={keysId}
      tabIndex={0}
      onKeyDown={onKey}
    >
      <span id={keysId} hidden>{u.studio.keysHelp}</span>
      <div ref={canvasHost} className="desk-canvas-host" />
      {noGl && <div className="office-nogl">{rich(u.studio.noGl)}</div>}
      <div className="office-vignette" />
      <div ref={flash} className="office-flash" aria-hidden="true" />
      <div className="desk3d-overlay">
        {list.map((h) => (
          <div key={`plate:${session?.info.sessionId}:${h.id}`} className={`office-nameplate ${h.id === selected ? 'is-selected' : ''}`} data-id={h.id} ref={(el) => {
            if (!el) return
            if (!primed.current.has(el)) { el.style.display = 'none'; primed.current.add(el) }
            plates.current.set(h.id, el)
            return () => { if (plates.current.get(h.id) === el) plates.current.delete(h.id) }
          }}>
            <span className="np-dot" style={{ background: statusDot(h.state) }} />
            <span className={`np-name ${h.id === 'main' ? 'is-main' : ''}`}>{h.id === 'main' ? u.common.mainHamster : h.name.length > 13 ? `${h.name.slice(0, 12)}…` : h.name}</span>
            <span className="np-sub">{[modelSkin(h.model).label, h.effort].filter(Boolean).join(' · ') || u.studio.state[h.state]}</span>
          </div>
        ))}
        {list.map((h) => (
          <div key={`glyph:${session?.info.sessionId}:${h.id}`} className="office-glyph" ref={(el) => {
            if (!el) return
            if (!primed.current.has(el)) { el.style.display = 'none'; primed.current.add(el) }
            glyphs.current.set(h.id, el)
            return () => { if (glyphs.current.get(h.id) === el) glyphs.current.delete(h.id) }
          }} />
        ))}
        {/* the tails come first, so every bubble is drawn over them (declutter.ts) */}
        {list.map((h) => h.feed.length > 0 && (
          <div key={`tail:${session?.info.sessionId}:${h.id}`} className="office-feed-tail" aria-hidden="true" ref={(el) => {
            if (!el) return
            if (!primed.current.has(el)) { el.style.display = 'none'; primed.current.add(el) }
            tails.current.set(h.id, el)
            return () => { if (tails.current.get(h.id) === el) tails.current.delete(h.id) }
          }} />
        ))}
        {/* One feed container per hamster, keyed by the hamster alone. A new row must not replace
            the container: the render loop finds it through `feeds`, and swapping DOM nodes under
            that map is how a fresh bubble used to get stuck at the mount-time opacity 0. Rows are
            keyed by their feed id, so a merged row keeps its element (and its place) while a new
            one mounts at the bottom and plays the pop-in. The container grows upwards, so the
            newest line is nearest the head and older ones are pushed away, like a chat log. */}
        {list.map((h) => h.feed.length > 0 && (
          <div
            key={`feed:${session?.info.sessionId}:${h.id}`}
            className="office-feed"
            data-office-ui
            data-hid={h.id}
            ref={(el) => {
              if (!el) return
              if (!primed.current.has(el)) { el.style.opacity = '0'; primed.current.add(el) }
              feeds.current.set(h.id, el)
              observe(el) // its size, for keeping the feeds apart (declutter.ts)
              // only forget the element we registered: a stale cleanup must never drop a newer node
              return () => { if (feeds.current.get(h.id) === el) feeds.current.delete(h.id) }
            }}
          >
            {h.feed.map((f, k) => (
              <div
                key={f.id}
                className={`ob-item kind-${f.kind} tone-${f.tone}`}
                data-ts={f.ts}
                data-life={feedLife(f)}
                title={u.studio.feedTip(f.raw)}
                onClick={() => { if (session) requestLogReveal(session.info.sessionId, f.id) }}
                onContextMenu={(e) => { e.preventDefault(); if (session) dismissFeedItem(session.info.sessionId, h.id, f.id) }}
              >
                {/* whose feed this is, on the newest row — shown only while the plate is off (the render loop's `is-named`) */}
                {k === h.feed.length - 1 && (
                  <span className="ob-who">
                    <i style={{ background: tintFor(h.agentType) }} />
                    {h.id === 'main' ? u.common.mainHamster : shortName(h.name, 10)}
                  </span>
                )}
                <span className="ob-text">{f.text}</span>
                {f.count > 1 && <span className="ob-count">×{f.count}</span>}
              </div>
            ))}
          </div>
        ))}
        <div
          ref={(el) => {
            card.current = el
            if (!el) return
            if (!primed.current.has(el)) { el.style.visibility = 'hidden'; primed.current.add(el) }
            observe(el)
          }}
          className={`office-card ${cardPinned ? 'is-pinned' : ''}`}
          data-office-ui={cardPinned ? '' : undefined}
          aria-hidden={cardHam ? undefined : true}
        >
          {cardHam && (
            <>
              <div className="oc-head">
                <span className="oc-tie" style={{ background: tintFor(cardHam.agentType) }} />
                <span className="oc-name">{cardHam.id === 'main' ? u.studio.mainHamster : cardHam.name}</span>
                {cardPinned && (
                  <button className="oc-x" onClick={() => setPinned(null)} aria-label={u.common.close} title={u.common.close}>
                    <IconClose size={12} />
                  </button>
                )}
              </div>
              <div className="oc-meta">{[cardHam.id === 'main' ? null : cardHam.agentType, modelSkin(cardHam.model).label, cardHam.effort].filter(Boolean).join(' · ')}</div>
              <div className="oc-state">
                <span className="oc-dot" style={{ background: statusDot(cardHam.state) }} />
                {u.studio.state[cardHam.state]} · <span ref={cardSince}>{formatDuration(Date.now() - cardHam.since)}</span>
              </div>
              {cardLine && <div className="oc-say">{cardLine}</div>}
              {cardPinned
                ? cardLog && session && (
                    <button className="oc-log" onClick={() => requestLogReveal(session.info.sessionId, cardLog.id)}>
                      {u.studio.cardLog}
                    </button>
                  )
                : <div className="oc-hint">{u.studio.cardHint}</div>}
            </>
          )}
        </div>
        <div ref={(el) => {
          signTip.current = el
          if (el) observe(el)
        }} className="office-sign-tip" aria-hidden="true">{u.studio.signTip}</div>
      </div>
      <div className="office-header" data-office-ui>
        <div className="office-heading">
          <span className="office-eyebrow"><span className="office-live-dot" /> THE HAMSTER STUDIO <span className="office-floor">01F</span></span>
          <span className="office-title" title={session?.info.cwd}>{session?.title || session?.info.name || u.studio.defaultTitle}</span>
        </div>
        <div className="office-status"><span><i className="status-active" />{u.studio.working} {active}</span><span><i />{u.studio.resting} {list.length - active - waiting}</span>{waiting > 0 && <span className="needs-attention"><i />{u.studio.attention} {waiting}</span>}<span className="office-occupancy" title={u.studio.occupancyTip}><small>{u.studio.colleagues}</small> {Math.min(list.filter((h) => h.id !== 'main').length, OFFICE.staff)} <small>/ {OFFICE.staff}</small></span></div>
      </div>
      {!session && (
        <div className="office-welcome" data-office-ui>
          <span>{u.studio.welcomeReady}</span>
          <p>{rich(u.studio.welcomeHow)}</p>
          {welcomeWs && welcomePty !== null && (
            <div className="office-welcome-actions">
              <button className="owa-run" data-debug-click="welcome-run" onClick={() => runInShell('claude')} title={u.studio.runClaudeTip}>
                {u.studio.runClaude}
              </button>
              {/* the list the session bar's `지난 대화` opens, but a pick runs in this idle terminal
                  rather than a new tab — there is no claude here yet to keep out of the way */}
              <Popover label={u.studio.history} title={u.studio.historyHereTip} ariaLabel={u.studio.history} width={360} debugClick="welcome-history">
                {(close) => <TranscriptList cwd={welcomeWs.cwd} profileId={welcomeWs.profileId} onPick={close} run={runInShell} />}
              </Popover>
            </div>
          )}
        </div>
      )}
      <div className="office-bottom" data-office-ui>
        <div className="office-follow">
          <span className="office-follow-icon"><IconTarget size={14} /></span>
          <select aria-label={u.studio.findLabel} value={list.some((h) => h.id === selected && placed(h.id)) ? selected : ''} onChange={(e) => focus(e.target.value)}>
            <option value="" disabled>{u.studio.findPlaceholder}</option>
            {list.map((h) => <option key={h.id} value={h.id} disabled={!placed(h.id)}>{h.id === 'main' ? u.studio.mainHamster : h.name} · {scene.seats.has(h.id) ? u.studio.state[h.state] : u.studio.waitingSeat}</option>)}
          </select>
          {overflow > 0 && <span className="office-overflow" role="status">{u.studio.overflow(overflow)}</span>}
        </div>
        <div className="office-controls">
          <button onClick={home} title={u.studio.homeTip} aria-label={u.studio.home}><IconHome size={14} /></button>
          <button className={autoFrame ? 'is-on' : ''} aria-pressed={autoFrame} title={u.studio.autoTip} onClick={() => (autoFrame ? manual() : home())}>{u.studio.auto}</button>
          <span className="control-divider" />
          <button onClick={() => zoomBy(0.8)} aria-label={u.studio.zoomOut} title={u.studio.zoomOut}><IconMinus size={14} /></button>
          <span className="office-zoom">{zoom}%</span>
          <button onClick={() => zoomBy(1.25)} aria-label={u.studio.zoomIn} title={u.studio.zoomIn}><IconPlus size={14} /></button>
          <span className="control-divider" />
          <button onClick={overview} data-debug-click="overview">{u.studio.overview}</button>
          <button className={showMap ? 'is-on' : ''} aria-pressed={showMap} onClick={() => setShowMap(!showMap)}><IconMap className="ctl-ico" size={13} />{u.studio.map}</button>
        </div>
      </div>
      {showMap && <div className="office-minimap" data-office-ui>
        <span>OFFICE MAP <small>{u.studio.mapHint}</small></span>
        <svg viewBox="0 0 100 100" role="img" aria-label={u.studio.mapLabel} onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const c = sceneFor().camera
          manual()
          focusCamera(c, { x: ((e.clientX - r.left) / r.width) * WORLD_W, z: ((e.clientY - r.top) / r.height) * WORLD_D }, size.current.w, size.current.h, c.scale)
        }}>
          <rect width="100" height="100" fill="#1d4a68" />
          {studioRef?.minimapUrl && <image href={studioRef.minimapUrl} x="0" y="0" width="100" height="100" preserveAspectRatio="none" />}
          {OFFICE.slots.map((slot, k) => {
            const p = tileToWorld(slot.i + 0.5, slot.j)
            const w = k === 0 ? BOSS_DESK_W : DESK_W
            return <rect key={k} x={((p.x - w / 2) / WORLD_W) * 100} y={((p.z - 26) / WORLD_D) * 100} width={(w / WORLD_W) * 100} height={(52 / WORLD_D) * 100} rx="0.4" fill={[...scene.seats.values()].includes(k) ? '#d6bc85' : '#8b7f63'} />
          })}
          <polygon ref={(el) => {
            viewportPolygon.current = el
            polygonDrawn.current = '' // a fresh outline has no points until the next frame writes them
          }} fill="#c9e3b516" stroke="#d7edbf" strokeWidth="0.8" />
        </svg>
      </div>}
      <div className="office-help">{u.studio.helpLeft} <span>·</span> {u.studio.helpRight} <span>·</span> {u.studio.helpWheel} <span>·</span> {u.studio.helpMiddle}</div>
      {session && <div className="office-metrics"><span>+{session.linesAdded}</span> −{session.linesRemoved}<i />{u.studio.edits(session.edits.length)} <i />{u.studio.turns(session.turns)}</div>}
    </section>
  )
}

const sameKeep = (a?: KeepSize, b?: KeepSize): boolean => a === b || (!!a && !!b && a.w === b.w && a.h === b.h)

/**
 * The studio renders again only when what it draws changed: the session it shows, its size, the
 * fold story's clock — and its own store subscriptions (the language, the welcome card's terminal,
 * the log requests) as any component does. App.tsx re-renders for every tab dot and usage tick and
 * hands the pane size in as a fresh object each time, which is compared by value here.
 */
export const DeskStudio = memo(
  DeskStudioView,
  (a, b) => a.session === b.session && a.height === b.height && a.fx === b.fx && a.story === b.story && a.shut === b.shut && sameKeep(a.keep, b.keep),
)
