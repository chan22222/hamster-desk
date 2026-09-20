import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { debugClick, feedLife, runInTerminal, setFeedLife, useDesk, type Hamster, type HamsterState, type SessionState } from '../store'
import { animFor, screenColor, statusDot, tintFor, type IsoAnim } from './anim'
import { modelSkin } from './skins'
import { IconHome, IconMap, IconMinus, IconPlus, IconTarget } from '../widgets/icons'
import {
  OFFICE,
  FEED_RISE,
  H_OFFICE,
  SEAT_LIFT,
  advanceWalker,
  makeWalker,
  reconcileSeats,
  tileToWorld,
  walkTo,
  type Walker,
} from './office-world'
import {
  applyTo,
  autoFrameCamera,
  createCamera,
  feedLines,
  focusCamera,
  FRAME_PAD,
  orbitCamera,
  overviewCamera,
  panCamera,
  PLATE_MIN_SCALE,
  viewportGroundPolygon,
  worldToScreen,
  zoomCamera,
  type Camera,
} from './office-camera'
import { skyDome, swayDepthMaterial, voxMaterial, waterMaterial } from './vox/material'
import { buildHamster, FEED_ANCHOR, MAIN_SCALE, type HamsterRig } from './vox/hamster'
import { buildStudioWorld, COLS, ROWS, WATER_Y, WORLD_D, WORLD_W, type StudioWorld } from './vox/world'
import { BOSS_DESK_W, DESK_W } from './vox/props'

const STATE_LABEL: Record<Hamster['state'], string> = {
  idle: '쉬는 중', thinking: '생각 중', reading: '읽는 중', searching: '찾는 중', writing: '작성 중',
  running: '실행 중', hiring: '동료 호출', browsing: '조사 중', talking: '이야기 중', waiting: '확인 필요', arriving: '출근 중', leaving: '퇴근 중',
}
const GLYPH: Partial<Record<IsoAnim, string>> = { think: '···', wave: '!', sleep: 'z', phone: '♪' }

const FOG = 0xcfe3f2
/** how fast the automatic camera eases towards its target (the room it leaves is FRAME_PAD) */
const FRAME_EASE = 6
/** a lone seated hamster: closer than a manual focus (the framing pushes it down on its own) */
const SOLO_SCALE = 3.0
/** a feed row fades out over its last `FEED_FADE` ms (or half its life, whichever is shorter) */
const FEED_FADE = 600

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
}

interface Scene {
  seats: Map<string, number>
  walkers: Map<string, Walker>
  camera: Camera
  rigs: Map<string, RigState>
  auto: AutoFrame
  width: number
  height: number
}
const makeScene = (): Scene => ({
  seats: new Map(),
  walkers: new Map(),
  camera: createCamera(),
  rigs: new Map(),
  // a scene that has never been opened starts with whatever the saved preference says
  auto: { on: useDesk.getState().prefs.autoCam, key: '', target: null },
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
  minimapUrl: string
}
let studio: Studio | null = null
let studioFailed = false

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
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(dpr)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.35
  // software rasterisers (SwiftShader / llvmpipe) cannot afford shadows at full resolution
  try {
    const gl = renderer.getContext()
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const gpu = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '')
    if (/swiftshader|software|llvmpipe|basic render/i.test(gpu)) {
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
  sun.shadow.mapSize.set(2048, 2048)
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
  for (const chunk of world.chunks) {
    for (const [geo, mat] of [[chunk.static, staticMat], [chunk.sway, swayMat]] as const) {
      if (!geo) continue
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      if (mat === swayMat) mesh.customDepthMaterial = depthSway
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      scene.add(mesh)
    }
  }

  // Wide enough that its edge always sits beyond the sky dome horizon (4500 from the camera);
  // a 6000 plane left a visible chevron where the sea ran out during the overview.
  const waterGeo = new THREE.PlaneGeometry(16000, 16000, 224, 224)
  waterGeo.rotateX(-Math.PI / 2) // local y becomes world up, which the wave shader displaces
  const water = new THREE.Mesh(waterGeo, waterMaterial(uTime, new THREE.Color(FOG)))
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
    minimapUrl: minimapDataUrl(world),
  }
}

function getStudio(): Studio | null {
  if (studio || studioFailed) return studio
  studio = createStudio()
  if (!studio) studioFailed = true
  return studio
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
    default:
      legs[0].rotation.x = -1.0
      legs[1].rotation.x = -1.0
  }
}

export function DeskStudio({ session, height }: { session: SessionState | null; height: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasHost = useRef<HTMLDivElement>(null)
  const feeds = useRef(new Map<string, HTMLDivElement>())
  const plates = useRef(new Map<string, HTMLDivElement>())
  const glyphs = useRef(new Map<string, HTMLDivElement>())
  const viewportPolygon = useRef<SVGPolygonElement>(null)
  const [zoom, setZoom] = useState(250)
  const [selected, setSelected] = useState('main')
  const [showMap, setShowMap] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [noGl, setNoGl] = useState(false)
  // Automatic framing keeps every present hamster in view. Any manual gesture switches it off;
  // ⌂ switches it back on. The scene holds the truth (the render loop reads it); this state only
  // draws the button, and the preference remembers the answer across restarts.
  const [autoFrame, setAutoFrameState] = useState(useDesk.getState().prefs.autoCam)
  const setAuto = (on: boolean): void => {
    sceneFor().auto.on = on
    setAutoFrameState(on)
    if (useDesk.getState().prefs.autoCam !== on) useDesk.getState().setPrefs({ autoCam: on })
  }
  const manual = (): void => { if (sceneFor().auto.on) setAuto(false) }
  /** DOM nodes the render loop has already hidden once, so a re-render does not blank them again */
  const primed = useRef(new WeakSet<HTMLElement>())
  const dismissFeedItem = useDesk((s) => s.dismissFeedItem)
  // The welcome card can start claude for the user, but only in a terminal this window owns:
  // an external session's tab has no pty of ours to type into.
  const activeTab = useDesk((s) => s.activeTab)
  const workspaces = useDesk((s) => s.workspaces)
  const welcomePty = workspaces.find((w) => `ws:${w.id}` === activeTab)?.ptyId ?? null
  const runInShell = (cmd: string): void => {
    if (welcomePty !== null) runInTerminal(welcomePty, cmd)
  }
  // debug/e2e: `HAMSTER_CLICK=welcome-run` presses `claude 실행` by itself once the tab has a pty
  // and the shell has had time to print a prompt, so a blind capture run can prove it really
  // starts Claude Code. Never armed in a packaged build (main.ts drops the env var there).
  const autoClicked = useRef(false)
  useEffect(() => {
    if (autoClicked.current || welcomePty === null || debugClick() !== 'welcome-run') return
    autoClicked.current = true
    const t = setTimeout(() => wrapRef.current?.querySelector<HTMLButtonElement>('.owa-run')?.click(), 3000)
    return () => clearTimeout(t)
  }, [welcomePty])
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
  /** Look at one hamster's seat (the follow menu, double-click): a manual view. */
  const focus = (id = 'main'): void => {
    const s = sceneFor()
    const k = s.seats.get(id)
    if (k === undefined && id !== 'main') return
    manual()
    const slot = OFFICE.slots[k ?? 0]
    const w = tileToWorld(slot.seat.i, slot.seat.j)
    focusCamera(s.camera, w, size.current.w, size.current.h)
    setSelected(id)
    updateZoom()
  }
  /** ⌂: back to automatic framing. With only the main hamster present that is the 250% desk view. */
  const home = (): void => {
    const s = sceneFor()
    s.auto.target = null
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

  useEffect(() => {
    setSelected('main')
    // a session's scene keeps its own camera and framing mode; a fresh one starts automatic
    setAutoFrameState(sceneFor().auto.on)
    updateZoom()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.info.sessionId])

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
        apply({ kind: 'agent_start', sessionId: sid, agentId: id, agentType, description: '새 동료', toolUseId: null, depth: 1, background: false, ts })
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
    canvas.setAttribute('aria-label', `복셀 스튜디오, 책상 ${OFFICE.slots.length}개`)
    host.appendChild(canvas)
    return () => {
      if (canvas.parentNode === host) host.removeChild(canvas)
    }
  }, [])

  useEffect(() => {
    const el = wrapRef.current!
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      size.current = { w: Math.max(1, Math.floor(rect.width)), h: Math.max(1, Math.floor(rect.height)) }
      const st = getStudio()
      if (!st) return
      st.renderer.setSize(size.current.w, size.current.h, false)
      st.camera.aspect = size.current.w / size.current.h
      st.camera.updateProjectionMatrix()
    })
    ro.observe(el)
    let drag: { id: number; x: number; y: number; orbit: boolean } | null = null
    const wheel = (e: WheelEvent): void => {
      if ((e.target as HTMLElement).closest('[data-office-ui]')) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const c = sceneFor().camera
      manual()
      zoomCamera(c, c.scale * Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top, size.current.w, size.current.h)
      updateZoom()
    }
    const down = (e: PointerEvent): void => {
      if ((e.button !== 0 && e.button !== 2) || (e.target as HTMLElement).closest('[data-office-ui]')) return
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, orbit: e.button === 2 || e.shiftKey }
      el.setPointerCapture(e.pointerId)
      setDragging(true)
    }
    const move = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id) return
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
    const up = (): void => { drag = null; setDragging(false) }
    const dbl = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('[data-office-ui]')) focus()
    }
    const menu = (e: Event): void => e.preventDefault()
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('lostpointercapture', up)
    el.addEventListener('dblclick', dbl)
    el.addEventListener('contextmenu', menu)
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('lostpointercapture', up)
      el.removeEventListener('dblclick', dbl)
      el.removeEventListener('contextmenu', menu)
    }
  }, [])

  const renderRef = useRef<(t: number, dt: number) => void>(() => {})
  renderRef.current = (t, dt) => {
    const st = getStudio()
    if (!st) return
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

    const hams = s ? s.order.map((id) => s.hamsters[id]).filter(Boolean) : []
    reconcileSeats(world.seats, hams.map((h) => h.id))
    const bySeat = new Map<number, Hamster>()
    hams.forEach((h) => {
      const k = world.seats.get(h.id)
      if (k !== undefined) bySeat.set(k, h)
    })

    // ---- desks: screen colour, blinking keys, status lamp, and the glow they spill -----------
    st.world.deskParts.forEach((parts, k) => {
      const dyn = st.deskDynamic[k]
      const h = bySeat.get(parts.slot)
      const state = h?.state ?? 'idle'
      const sc = screenColor(state, t)
      const typing = state === 'writing' || state === 'running'
      dyn.screen.material = flat(h ? sc.bg : '#243c36')
      dyn.keys.material = flat(typing && Math.floor(t / 180) % 2 ? '#ccddc3' : '#8892aa')
      dyn.lamp.material = flat(h ? statusDot(state) : '#506358')
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

    const seen = new Set<string>()
    hams.forEach((h) => {
      seen.add(h.id)
      const index = world.seats.get(h.id)
      const plate = plates.current.get(h.id)
      const feed = feeds.current.get(h.id)
      const glyph = glyphs.current.get(h.id)
      if (index === undefined) {
        const idle = world.rigs.get(h.id)
        if (idle) idle.rig.group.visible = false
        if (plate) plate.style.display = 'none'
        if (feed) {
          feed.style.opacity = '0'
          feed.style.visibility = 'hidden'
        }
        if (glyph) glyph.style.display = 'none'
        return
      }
      const slot = OFFICE.slots[index]
      let walker = world.walkers.get(h.id)
      if (!walker) {
        walker = makeWalker(h.state === 'arriving' ? OFFICE.door : slot.seat)
        world.walkers.set(h.id, walker)
      }
      walkTo(walker, h.state === 'leaving' ? OFFICE.door : slot.seat)
      advanceWalker(walker, dt)

      const skin = modelSkin(h.model)
      const rigKey = `${skin.family}|${skin.accessory}|${tintFor(h.agentType)}|${h.id === 'main'}`
      let rs = world.rigs.get(h.id)
      if (!rs || rs.key !== rigKey) {
        if (rs) group!.remove(rs.rig.group)
        const rig = buildHamster({ skin, tint: tintFor(h.agentType), main: h.id === 'main' }, st.hamsterMat)
        rs = { rig, key: rigKey, yaw: 0 }
        group!.add(rig.group)
        world.rigs.set(h.id, rs)
      }
      rs.rig.group.visible = true

      // Arriving/leaving are lifecycle states. Only an actual path plays the walk cycle.
      const seated = !walker.path.length && h.state !== 'leaving'
      const anim: IsoAnim = walker.moving ? 'walk' : ['arriving', 'leaving'].includes(h.state) ? 'idle' : animFor(h.state, Date.now() - h.since)
      const pos = tileToWorld(walker.i, walker.j)
      // Sitting lays the folded legs (8.4 thick, pinned at rig y 4) across the chair seat and
      // still lifts the short-legged hamster's head and arms clear of the desk top (y 40). SEAT_LIFT
      // is the most the torso can rise and still stay in the cushion through the breathing bob: its
      // underside lands at y 16.5, and ±0.8 of breath never takes it past the seat's own 18.
      const groundY = H_OFFICE + (seated ? SEAT_LIFT : 0)
      const scaleF = h.id === 'main' ? MAIN_SCALE : 1
      rs.rig.group.position.set(pos.x, groundY, pos.z)
      // face the way we are walking; standing still we face +z, across the desk and at the camera
      const next = walker.path[0]
      const targetYaw = walker.moving && next ? Math.atan2(next.i - walker.i, next.j - walker.j) : 0
      let d = targetYaw - rs.yaw
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      rs.yaw += d * Math.min(1, dt * 8)
      rs.rig.group.rotation.y = rs.yaw
      poseRig(rs, anim, seated && !walker.moving, t / 1000)

      // ---- DOM overlays ---------------------------------------------------------------------
      const scale = c.scale
      const headTop = groundY + (rs.rig.headG.position.y + FEED_ANCHOR) * scaleF
      const deskCentre = tileToWorld(slot.i + 0.5, slot.j)
      const plateWorld = seated
        ? { x: deskCentre.x, y: H_OFFICE + 42, z: deskCentre.z + 26 }
        : { x: pos.x, y: groundY + 4, z: pos.z }
      if (plate) {
        const p = worldToScreen(c, plateWorld, W, H)
        const show = scale >= PLATE_MIN_SCALE && !p.behind && p.x > -60 && p.x < W + 60 && p.y > -20 && p.y < H + 20
        plate.style.display = show ? '' : 'none'
        if (show) plate.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, 0)`
      }
      if (glyph) {
        const symbol = GLYPH[anim]
        const p = worldToScreen(c, { x: pos.x + 14, y: headTop + 14, z: pos.z }, W, H)
        const show = !!symbol && !walker.moving && scale >= 1.5 && !p.behind && p.x > 0 && p.x < W && p.y > 0 && p.y < H
        glyph.style.display = show ? '' : 'none'
        if (show) {
          glyph.textContent = symbol as string
          glyph.className = `office-glyph${anim === 'wave' ? ' is-alert' : ''}`
          // the little hop makes the glyph read as a thought rather than a label
          glyph.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - (Math.floor(t / 600) % 2) * 3)}px) translate(-50%, -100%)`
        }
      }
      if (feed) {
        // how many rows this zoom carries — the same answer the automatic framing reserved sky for
        const lines = feedLines(scale)
        const p = worldToScreen(c, { x: pos.x, y: headTop + FEED_RISE, z: pos.z }, W, H)
        const show = lines > 0 && !p.behind && p.x > 70 && p.x < W - 70 && p.y > 40 && p.y < H + 70
        feed.style.opacity = show ? '1' : '0'
        // `visibility` takes the rows out of hit testing too; the container itself never gets clicks
        feed.style.visibility = show ? '' : 'hidden'
        if (show) {
          feed.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`
          // Each row ages out on its own, and zooming out drops the oldest ones. React must not
          // re-render for either, so which rows are shown, the fade, and the step-back of the rows
          // that got pushed up are all written straight onto the elements here.
          const rows = feed.children
          const now = Date.now()
          const first = Math.max(0, rows.length - lines) // only the newest `lines` rows are drawn
          for (let k = 0; k < rows.length; k++) {
            const row = rows[k] as HTMLElement
            if (k < first) {
              row.style.display = 'none'
              continue
            }
            row.style.display = ''
            const life = Number(row.dataset.life) || 3000
            const age = now - (Number(row.dataset.ts) || now)
            const fade = Math.min(FEED_FADE, life * 0.5)
            const dying = Math.max(0, Math.min(1, (age - (life - fade)) / fade))
            const back = k < rows.length - 1 // anything but the newest row has been pushed up
            row.style.opacity = String((back ? 0.8 : 1) * (1 - dying))
            row.style.transform = back ? 'scale(0.96)' : ''
          }
        }
      }
    })
    for (const [id, rs] of world.rigs) {
      if (!seen.has(id)) {
        group.remove(rs.rig.group)
        world.rigs.delete(id)
      }
    }
    for (const id of world.walkers.keys()) if (!seen.has(id)) world.walkers.delete(id)

    // ---- automatic framing: only the hamsters that are actually here ------------------------
    if (world.auto.on) {
      const pts: { x: number; z: number }[] = []
      const ids: string[] = []
      let moving = false
      for (const h of hams) {
        const k = world.seats.get(h.id)
        const walker = world.walkers.get(h.id)
        if (k === undefined || !walker) continue
        ids.push(h.id)
        if (walker.path.length) {
          moving = true
          pts.push(tileToWorld(walker.i, walker.j))
        } else {
          const seat = OFFICE.slots[k].seat
          pts.push(tileToWorld(seat.i, seat.j), tileToWorld(seat.i, seat.j + 1)) // the seat and the desk in front
        }
      }
      // Recompute only when the occupancy changes, the viewport resizes or somebody is walking;
      // otherwise keep easing towards the target we already have. The size is in the signature
      // because the framing is measured in pixels — how much sky a feed row needs is the same 26px
      // in a 420-tall desk as in a 700-tall one, so dragging the splitter really does change the
      // answer. It is quantised to 8px so a drag recomputes a handful of times, not every frame.
      const sig = `${ids.sort().join(',')}|${Math.round(W / 8)}x${Math.round(H / 8)}${moving ? '|walk' : ''}`
      if (!world.auto.target || moving || sig !== world.auto.key) {
        world.auto.key = sig
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
      updateZoom()
    }

    applyTo(st.camera, c, W, H)
    st.sky.position.copy(st.camera.position)
    if (!document.hidden) st.renderer.render(st.scene, st.camera)

    if (viewportPolygon.current) {
      const pts = viewportGroundPolygon(c, W, H)
        .map((p) => `${(p.x / WORLD_W) * 100},${(p.z / WORLD_D) * 100}`)
        .join(' ')
      viewportPolygon.current.setAttribute('points', pts)
    }
  }

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (t: number): void => {
      renderRef.current(t, Math.min(0.1, (t - last) / 1000))
      last = t
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const studioRef = getStudio()
  return (
    <section ref={wrapRef} className={`desk-wrap desk-studio ${dragging ? 'is-dragging' : ''}`} style={{ height }} aria-label="햄스터 스튜디오">
      <div ref={canvasHost} className="desk-canvas-host" />
      {noGl && <div className="office-nogl">3D 화면을 열 수 없어요.<br />그래픽 드라이버나 하드웨어 가속 설정을 확인해 주세요.</div>}
      <div className="office-vignette" />
      <div className="desk3d-overlay">
        {list.map((h) => (
          <div key={`plate:${session?.info.sessionId}:${h.id}`} className={`office-nameplate ${h.id === selected ? 'is-selected' : ''}`} data-id={h.id} ref={(el) => {
            if (!el) return
            if (!primed.current.has(el)) { el.style.display = 'none'; primed.current.add(el) }
            plates.current.set(h.id, el)
            return () => { if (plates.current.get(h.id) === el) plates.current.delete(h.id) }
          }}>
            <span className="np-dot" style={{ background: statusDot(h.state) }} />
            <span className={`np-name ${h.id === 'main' ? 'is-main' : ''}`}>{h.id === 'main' ? '메인' : h.name.length > 13 ? `${h.name.slice(0, 12)}…` : h.name}</span>
            <span className="np-sub">{[modelSkin(h.model).label, h.effort].filter(Boolean).join(' · ') || STATE_LABEL[h.state]}</span>
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
              // only forget the element we registered: a stale cleanup must never drop a newer node
              return () => { if (feeds.current.get(h.id) === el) feeds.current.delete(h.id) }
            }}
          >
            {h.feed.map((f) => (
              <div
                key={f.id}
                className={`ob-item kind-${f.kind} tone-${f.tone}`}
                data-ts={f.ts}
                data-life={feedLife(f)}
                title={f.raw}
                onClick={() => { if (session) dismissFeedItem(session.info.sessionId, h.id, f.id) }}
              >
                <span className="ob-text">{f.text}</span>
                {f.count > 1 && <span className="ob-count">×{f.count}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="office-header" data-office-ui>
        <div className="office-heading">
          <span className="office-eyebrow"><span className="office-live-dot" /> THE HAMSTER STUDIO <span className="office-floor">01F</span></span>
          <span className="office-title" title={session?.info.cwd}>{session?.title || session?.info.name || '작은 동료들의 작업실'}</span>
        </div>
        <div className="office-status"><span><i className="status-active" />작업 {active}</span><span><i />휴식 {list.length - active - waiting}</span>{waiting > 0 && <span className="needs-attention"><i />확인 {waiting}</span>}<span className="office-occupancy" title="사장 자리를 뺀 동료 자리"><small>동료</small> {Math.min(list.filter((h) => h.id !== 'main').length, OFFICE.staff)} <small>/ {OFFICE.staff}</small></span></div>
      </div>
      {!session && (
        <div className="office-welcome" data-office-ui>
          <span>자리는 준비되어 있어요</span>
          <p>
            터미널에서 <code>claude</code>를 실행하거나<br />아래 버튼을 누르세요.
          </p>
          {welcomePty !== null && (
            <div className="office-welcome-actions">
              <button className="owa-run" onClick={() => runInShell('claude')} title="이 터미널에서 claude 시작">
                claude 실행
              </button>
              <button onClick={() => runInShell('claude --continue')} title="이 폴더의 마지막 대화를 이어서 시작">
                이어서 실행 <code>--continue</code>
              </button>
            </div>
          )}
        </div>
      )}
      <div className="office-bottom" data-office-ui>
        <div className="office-follow">
          <span className="office-follow-icon"><IconTarget size={14} /></span>
          <select aria-label="햄스터 위치 찾기" value={list.some((h) => h.id === selected && scene.seats.has(h.id)) ? selected : ''} onChange={(e) => focus(e.target.value)}>
            <option value="" disabled>동료 위치 찾기</option>
            {list.map((h) => <option key={h.id} value={h.id} disabled={!scene.seats.has(h.id)}>{h.id === 'main' ? '메인 햄스터' : h.name} · {scene.seats.has(h.id) ? STATE_LABEL[h.state] : '빈자리 대기'}</option>)}
          </select>
          {overflow > 0 && <span className="office-overflow" role="status">{overflow}마리 빈자리 대기</span>}
        </div>
        <div className="office-controls">
          <button onClick={home} title="메인 햄스터로 이동 (자동 카메라 켜기)" aria-label="메인 햄스터로 이동"><IconHome size={14} /></button>
          <button className={autoFrame ? 'is-on' : ''} aria-pressed={autoFrame} title="있는 햄스터들만 화면에 담는 자동 카메라" onClick={() => (autoFrame ? manual() : home())}>자동</button>
          <span className="control-divider" />
          <button onClick={() => zoomBy(0.8)} aria-label="축소" title="축소"><IconMinus size={14} /></button>
          <span className="office-zoom">{zoom}%</span>
          <button onClick={() => zoomBy(1.25)} aria-label="확대" title="확대"><IconPlus size={14} /></button>
          <span className="control-divider" />
          <button onClick={overview}>전체 보기</button>
          <button className={showMap ? 'is-on' : ''} aria-pressed={showMap} onClick={() => setShowMap(!showMap)}><IconMap className="ctl-ico" size={13} />지도</button>
        </div>
      </div>
      {showMap && <div className="office-minimap" data-office-ui>
        <span>OFFICE MAP <small>클릭하여 이동</small></span>
        <svg viewBox="0 0 100 100" role="img" aria-label="사무실 지도" onClick={(e) => {
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
          <polygon ref={viewportPolygon} fill="#c9e3b516" stroke="#d7edbf" strokeWidth="0.8" />
        </svg>
      </div>}
      <div className="office-help">드래그로 둘러보기 <span>·</span> 우클릭 드래그로 회전 <span>·</span> 휠로 확대</div>
      {session && <div className="office-metrics"><span>+{session.linesAdded}</span> −{session.linesRemoved}<i />{session.edits.length} edits <i />{session.turns} turns</div>}
    </section>
  )
}
