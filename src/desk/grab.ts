// Picking a hamster up and throwing it — the one thing the pointer can do to a hamster. Drag one
// and it dangles from the hand, all four paws going; let go and it falls, or flies the way the
// pointer was moving. On the floor it walks back to its desk by itself; in the sea it is gone, and
// another one walks in through the door to the same seat.
//
// It is all pantomime, like the boss's rounds (patrol.ts): nothing here touches the store. The
// session's agent is still running whatever happens to its hamster, so a thrown one is not "gone"
// in any sense but the studio's — the studio simply builds a new rig (a shade different, so it
// reads as somebody else: vox/hamster.ts `variant`) and has it arrive.
//
// Pure, like office-world.ts: no three, no DOM. Positions are world units (x/z on the deck plane,
// y up), the pointer and the clock are inputs and the ground is a callback, so the unit test can
// throw one into the sea without building the island.
import { BOSS_SLOT, H_OFFICE, LOBBY, OFFICE, OFFICE_TILE, T, WALK_BACK, corridorRoute, directRoute, type Point } from './office-world'
import { BOSS_DESK_W, DESK_D, DESK_W } from './vox/props'

/** how high a held hamster hangs above the deck (its feet), world units — about its own height */
export const LIFT = 70
/** the point on the hamster the hand holds, above its feet: the scruff, at the top of the torso */
export const SCRUFF = 40
/** world units/s²; a hamster is 64 tall, so this is a cartoon's gravity, not the earth's */
export const GRAVITY = 1400
/** the fastest a throw goes, world units/s — about 25 tiles a second, enough to clear the island */
export const MAX_THROW = 1600
/** every throw gets this much upward speed, plus a share of its horizontal speed, so it arcs */
export const THROW_UP = 220
export const THROW_ARC = 0.3
/** pointer samples older than this do not count towards the throw; a hand held still that long lets go softly */
export const TRAIL_MS = 110
/** a release slower than this is a drop, not a throw */
export const DROP_SPEED = 90
/** how long a hamster keeps sinking after the splash before it is gone, seconds, and how fast */
export const SINK_S = 0.45
export const SINK_SPEED = 70

export interface Held {
  id: string
  /** where the hamster hangs: x/z under the hand, y its feet (eased up to `H_OFFICE + LIFT`) */
  x: number
  y: number
  z: number
  /** the hamster's offset from the hand when it was picked up, kept so it does not jump into the hand */
  dx: number
  dz: number
  /** where the hand has been over the last `TRAIL_MS` — the throw is read off this */
  trail: { x: number; z: number; t: number }[]
}

export interface Flight {
  id: string
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** in the air until it meets the ground or the water; sinking after the splash */
  phase: 'air' | 'sink'
  /** seconds in the current phase */
  age: number
}

/** height of the ground at a world point, or null over water (and off the map) */
export type Ground = (x: number, z: number) => number | null

export type FlightEvent = 'air' | 'landed' | 'splash' | 'sink' | 'gone'

/** Pick a hamster up: `at` is where it stands (its feet), `hand` the point under the pointer on the grab plane. */
export function grab(id: string, at: { x: number; y: number; z: number }, hand: { x: number; z: number }, now: number): Held {
  return { id, x: at.x, y: at.y, z: at.z, dx: at.x - hand.x, dz: at.z - hand.z, trail: [{ x: at.x, z: at.z, t: now }] }
}

/** The hand moved: the hamster follows, and the move is remembered for the throw. */
export function carry(h: Held, hand: { x: number; z: number } | null, now: number): void {
  if (!hand) return
  h.x = hand.x + h.dx
  h.z = hand.z + h.dz
  h.trail.push({ x: h.x, z: h.z, t: now })
  while (h.trail.length > 1 && now - h.trail[0].t > TRAIL_MS) h.trail.shift()
}

/** One frame in the hand: ease up off the floor (or the chair) to the carrying height. */
export function hang(h: Held, dt: number): void {
  h.y += (H_OFFICE + LIFT - h.y) * Math.min(1, dt * 9)
}

/**
 * Let go. The throw is the hand's average speed over its last `TRAIL_MS`: a still hand (or one
 * that stopped a while ago) drops the hamster where it is; a flick throws it, capped at
 * `MAX_THROW`, with an upward share so it arcs rather than skids.
 */
export function release(h: Held, now: number): Flight {
  const a = h.trail[0]
  const b = h.trail[h.trail.length - 1]
  const dt = (b.t - a.t) / 1000
  let vx = 0
  let vz = 0
  if (dt > 0.016 && now - b.t <= TRAIL_MS) {
    vx = (b.x - a.x) / dt
    vz = (b.z - a.z) / dt
  }
  const speed = Math.hypot(vx, vz)
  if (speed < DROP_SPEED) {
    vx = 0
    vz = 0
  } else if (speed > MAX_THROW) {
    vx *= MAX_THROW / speed
    vz *= MAX_THROW / speed
  }
  const s = Math.hypot(vx, vz)
  return { id: h.id, x: h.x, y: h.y, z: h.z, vx, vz, vy: s > 0 ? THROW_UP + s * THROW_ARC : 0, phase: 'air', age: 0 }
}

/**
 * One frame in the air (or in the water). Returns what happened this frame: `landed` puts the
 * hamster's feet on the ground at (x, z); `splash` is the moment it hits the water, after which
 * it sinks for `SINK_S` and is `gone`.
 */
export function fly(f: Flight, dt: number, ground: Ground, waterY: number): FlightEvent {
  f.age += dt
  if (f.phase === 'sink') {
    f.y -= SINK_SPEED * dt
    return f.age >= SINK_S ? 'gone' : 'sink'
  }
  f.x += f.vx * dt
  f.z += f.vz * dt
  f.y += f.vy * dt - 0.5 * GRAVITY * dt * dt
  f.vy -= GRAVITY * dt
  if (f.vy > 0) return 'air'
  const g = ground(f.x, f.z)
  if (g === null) {
    if (f.y > waterY) return 'air'
    f.y = waterY
    f.phase = 'sink'
    f.age = 0
    return 'splash'
  }
  if (f.y > g) return 'air'
  f.y = g
  return 'landed'
}

/** world point → office tile coordinates (the inverse of `tileToWorld`) */
export function worldToTile(p: { x: number; z: number }): Point {
  return { i: p.x / T - OFFICE_TILE.i - 0.5, j: p.z / T - OFFICE_TILE.j - 0.5 }
}

/** the walker is inside the office's own floor (its walls and its open sides alike) */
const inside = (p: Point): boolean => p.i > -0.5 && p.i < OFFICE.W - 0.5 && p.j > -0.5 && p.j < OFFICE.D - 0.5

/** clearance kept around a desk's real footprint, in tiles — a hamster is 0.44 wide */
const DESK_PAD = 0.25

/**
 * Where a hamster that fell at `at` (tiles) actually stands: a spot inside a desk's footprint —
 * the desk, its chair and the strip between — is pushed out through the nearest side, so it
 * never starts its walk home from inside the furniture.
 */
export function landingSpot(at: Point): Point {
  for (const slot of OFFICE.slots) {
    const boss = slot === BOSS_SLOT
    const hw = (boss ? BOSS_DESK_W : DESK_W) / T / 2 + DESK_PAD
    const ci = slot.i + 0.5
    const i0 = ci - hw
    const i1 = ci + hw
    const j0 = slot.seat.j - WALK_BACK
    const j1 = slot.j + DESK_D / T / 2 + DESK_PAD
    if (at.i <= i0 || at.i >= i1 || at.j <= j0 || at.j >= j1) continue
    const outs = [
      { d: at.i - i0, p: { i: i0, j: at.j } },
      { d: i1 - at.i, p: { i: i1, j: at.j } },
      { d: at.j - j0, p: { i: at.i, j: j0 } },
      { d: j1 - at.j, p: { i: at.i, j: j1 } },
    ]
    return outs.reduce((best, o) => (o.d < best.d ? o : best)).p
  }
  return at
}

/** a tile and a half outside the west wall: the steps under the door */
export const PORCH_I = -1.6
/** how far outside the deck the way round the building runs */
const AROUND = 1.2

/** a spot in the queue for a desk (office-world.ts `LOBBY`) */
const queued = (p: Point): boolean => LOBBY.some((q) => Math.abs(q.i - p.i) < 1e-6 && Math.abs(q.j - p.j) < 1e-6)

/**
 * The way from wherever a hamster landed, `from` (tiles), to `goal`: its seat, the door (it was
 * on its way out) or its place in the queue. Inside the office it is the boss's own lanes
 * (`directRoute`: walkways and the gaps between desk columns, never through a desk) — to the door
 * as well, which they reach down the corridor from the first row's walkway. The queue stands off
 * those lanes, so a queued hamster goes to the door that way and joins the queue from the corridor
 * the way a newcomer does. Outside, the hamster goes round the building on the grass to the steps,
 * in through the door and on as a colleague arriving would (`corridorRoute`) — the north and west
 * sides have walls, and the open sides have desks right up to the edge.
 */
export function returnPath(from: Point, goal: Point): Point[] {
  const door = OFFICE.door
  let legs: Point[]
  if (inside(from)) {
    if (!queued(goal)) return directRoute(from, goal)
    legs = [...directRoute(from, door), ...corridorRoute(door, goal)]
  } else {
    const porch: Point = { i: PORCH_I, j: door.j }
    legs = []
    if (from.i >= -0.5) {
      // north, east or south of the building: along that side to the west, then down (or up) to the steps
      let j = from.j
      if (from.j > -0.5 && from.j < OFFICE.D - 0.5) {
        // east of it, between its rows: out past the nearer corner first
        j = from.j < OFFICE.D / 2 ? -AROUND : OFFICE.D - 1 + AROUND
        legs.push({ i: from.i, j })
      }
      legs.push({ i: PORCH_I, j })
    }
    legs.push(porch, { ...door }, ...corridorRoute(door, goal))
  }
  const out: Point[] = []
  let prev = from
  for (const p of legs) {
    if (Math.abs(p.i - prev.i) > 1e-6 || Math.abs(p.j - prev.j) > 1e-6) out.push(p)
    prev = p
  }
  return out
}
