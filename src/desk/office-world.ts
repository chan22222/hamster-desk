// The office floor plan and who sits where. Pure data + math: no three, no DOM, so the node
// test can drive it directly. The 3D camera lives in office-camera.ts and the voxel geometry in
// vox/world.ts; both read the constants below.
import { FEED_ANCHOR, HEAD_Y, MAIN_SCALE, SIT_DROP } from './vox/hamster'

export interface Point { i: number; j: number }
export interface Seat extends Point { seat: Point; chair: Point }

/** floor tile size in world units */
export const T = 64
/** the office's north-west corner, in world tiles */
export const OFFICE_TILE = { i: 10, j: 8 } as const
/** the office deck sits one step above the island */
export const H_OFFICE = 24

/** the chair's seat top (the `chair` prop's cushion), in the same units as everything else here */
export const SEAT_TOP = 18
/**
 * How far the studio lifts a seated hamster off the floor. One unit shallower than the cushion's
 * own top, which is the most the (short-legged) torso can rise and still stay in the seat through
 * the breathing bob.
 */
export const SEAT_LIFT = SEAT_TOP - 1
/** the chat feed floats this far over its anchor */
export const FEED_RISE = 20
/**
 * How high above the office floor a hamster's chat bubbles hang — the point the stack grows
 * *upward* from, and therefore the one the automatic framing has to keep clear of the header.
 *
 * It is written out of the rig's own numbers rather than measured off a screenshot, so reshaping
 * the character moves the framing with it. The case that matters is the worst one: the session's
 * main hamster (a tenth larger than a colleague), seated (the chair lifts more than the sit pose
 * drops), which is exactly what `DeskStudio` computes for its DOM overlay.
 */
export const BUBBLE_H = SEAT_LIFT + (HEAD_Y - SIT_DROP + FEED_ANCHOR) * MAIN_SCALE + FEED_RISE

/** office tile point → world centre. (0,0) is the middle of the office's first tile. */
export function tileToWorld(i: number, j: number): { x: number; z: number } {
  return { x: (OFFICE_TILE.i + i + 0.5) * T, z: (OFFICE_TILE.j + j + 0.5) * T }
}

// The office is a fixed place: the boss's desk alone along the north wall, then a dozen staff
// desks in three rows. Claude Code rarely runs more than a handful of subagents at once, so extra
// hamsters queue by the door (`LOBBY`) instead of growing the room.
export const DESK_COLS = 4
export const DESK_ROWS = 3
const PITCH_I = 4
const PITCH_J = 4
/** the staff grid starts three tiles below the boss's row */
const ORIGIN = { i: 3, j: 6 }

/**
 * Where a hamster sits relative to its desk's near tile: half a tile along i (the desk spans two)
 * and three quarters of a tile towards -j, which puts it 48 units in front of the desk edge —
 * on the chair, facing +z across the desktop.
 */
export const SEAT = { di: 0.5, dj: -0.75 } as const

const seatAt = (i: number, j: number): Seat => ({
  i,
  j,
  seat: { i: i + SEAT.di, j: j + SEAT.dj },
  chair: { i: i + SEAT.di, j: j + SEAT.dj },
})

/**
 * Slot 0 is the boss's desk: two tiles wide at i 9..10 on the row j = 2, with the chair on the
 * walkway at j 1.25, facing +z like everyone else so the whole staff grid lies in front of it.
 */
export const BOSS_SLOT: Seat = seatAt(9, 2)

/** distance from the boss's chair to a seat — agents fill the room outwards from the boss */
const fromBoss = (s: Seat): number => Math.hypot(s.seat.i - BOSS_SLOT.seat.i, s.seat.j - BOSS_SLOT.seat.j)

// Staff seats are handed out nearest the boss first (ties: the northern one, then the western
// one), so a handful of agents cluster around the boss's desk and the auto camera stays close.
const slots: Seat[] = [
  BOSS_SLOT,
  ...Array.from({ length: DESK_COLS * DESK_ROWS }, (_, k) =>
    seatAt(ORIGIN.i + (k % DESK_COLS) * PITCH_I, ORIGIN.j + Math.floor(k / DESK_COLS) * PITCH_J),
  ).sort((a, b) => fromBoss(a) - fromBoss(b) || a.j - b.j || a.i - b.i),
]

/** the corridor down the west wall, in from the door: every walk to or from a desk runs along it */
export const CORRIDOR_I = 0.5

// The queue for hamsters without a desk: one file just inside the door, from the water cooler at
// its head (vox/world.ts) back towards the second row, between the strip the boss's rounds walk
// (`GAP_LANES[0]`, i 1.5) and the first column of desks. One file on purpose — a newcomer steps
// straight across from the corridor to the end of it, the queue shuffles up along its own line,
// and the one at the head steps back onto the corridor for the desk it was given, so nobody walks
// through anybody. Every spot clears the corridor, that lane, the aisles behind the first two rows
// and the desks by a hamster's width (scripts/unit/walk.test.ts); a longer queue waits out of sight.
const LOBBY_I = 2.2
const LOBBY_STEP = 0.45
/** where the hamsters that have no desk yet stand, head of the queue first — its head right across from the door */
export const LOBBY: readonly Point[] = Array.from({ length: 5 }, (_, k) => ({ i: LOBBY_I, j: 6.35 + k * LOBBY_STEP }))

export const OFFICE = {
  W: ORIGIN.i + DESK_COLS * PITCH_I + 1,
  D: ORIGIN.j + DESK_ROWS * PITCH_J + 2,
  slots,
  door: { i: CORRIDOR_I, j: 6.5 },
  /** the head of the queue for hamsters without a desk (`LOBBY`): by the door, along the left wall */
  lobby: LOBBY[0],
  /** how many staff desks there are (every slot but the boss's) */
  staff: DESK_COLS * DESK_ROWS,
} as const

/** Reuse vacancies without ever compacting or reordering occupied seats. Main owns the boss's seat 0; agents only ever take 1 and up. */
export function reconcileSeats(seats: Map<string, number>, ids: readonly string[]): void {
  const live = new Set(ids)
  for (const id of seats.keys()) if (!live.has(id)) seats.delete(id)
  if (live.has('main')) seats.set('main', 0)
  const taken = new Set([0, ...seats.values()])
  for (const id of ids) {
    if (seats.has(id)) continue
    const free = slots.findIndex((_, k) => !taken.has(k))
    if (free < 0) break
    seats.set(id, free)
    taken.add(free)
  }
}

export interface Walker extends Point {
  target: Point
  path: Point[]
  facing: 'se' | 'sw' | 'ne' | 'nw'
  moving: boolean
  /**
   * Off the corridor and its aisles: landed wherever a throw put it (grab.ts). Until it is home, a
   * new goal is reached by the lanes or round the building (`returnPath`), never by `walkTo` —
   * whose legs start from the corridor network and would cut straight through a desk or a wall.
   */
  free?: boolean
}

export function makeWalker(at: Point): Walker {
  return { ...at, target: { ...at }, path: [], facing: 'se', moving: false }
}

/**
 * Travel through the left corridor and the aisle behind each row, never through desks, chairs or
 * whoever sits on them. The boss's seat is reached the same way: up the corridor to the north
 * walkway (j 1.25), then east along it — the boss's row has no other chair on it.
 */
export function walkTo(walker: Walker, goal: Point): void {
  if (walker.target.i === goal.i && walker.target.j === goal.j) return
  walker.target = { ...goal }
  walker.path = corridorRoute(walker, goal)
}

/** the seat line of each staff row (j): the chairs stand on it, their backs to the aisle behind */
const STAFF_ROWS: readonly number[] = Array.from({ length: DESK_ROWS }, (_, r) => ORIGIN.j + r * PITCH_J + SEAT.dj)
const EPS = 1e-6

/**
 * The aisle `p` reaches its staff row by, when it is on one — a seat, the step down from the aisle
 * to a chair, or the aisle itself — and null anywhere else (the corridor, the boss's row, the queue).
 */
function aisleOf(p: Point): number | null {
  if (p.i <= CORRIDOR_I + EPS) return null
  for (const row of STAFF_ROWS) {
    const aisle = row - WALK_BACK
    if (p.j >= aisle - EPS && p.j <= row + EPS) return aisle
  }
  return null
}

/** `p` stands in the queue's file (`LOBBY`) */
const inLobby = (p: Point): boolean => Math.abs(p.i - LOBBY_I) < EPS && p.j >= LOBBY[0].j - EPS && p.j <= LOBBY[LOBBY.length - 1].j + EPS

/**
 * The corridor route `walkTo` walks. Out of a staff row it is back from the chair onto the aisle
 * behind its row, along that aisle to the corridor; into one, the same in reverse — along the aisle
 * to the desk's column and only then the step down onto the chair. The seat line itself is never
 * walked along: every other chair of the row stands on it, with a colleague in it. Anywhere else
 * (the door, the boss's row, the queue) is left and reached straight across from the corridor, and
 * two spots of the queue are one step along its file.
 */
export function corridorRoute(from: Point, to: Point): Point[] {
  if (sameSpot(from, to)) return []
  const a = aisleOf(from)
  const b = aisleOf(to)
  let legs: Point[]
  if (inLobby(from) && inLobby(to)) legs = [{ ...to }]
  else if (a !== null && a === b) legs = [{ i: from.i, j: a }, { i: to.i, j: b }, { ...to }]
  else {
    legs = a !== null ? [{ i: from.i, j: a }, { i: CORRIDOR_I, j: a }] : [{ i: CORRIDOR_I, j: from.j }]
    legs.push(...(b !== null ? [{ i: CORRIDOR_I, j: b }, { i: to.i, j: b }, { ...to }] : [{ i: CORRIDOR_I, j: to.j }, { ...to }]))
  }
  const out: Point[] = []
  let prev = from
  for (const p of legs) {
    if (!sameSpot(p, prev)) out.push(p)
    prev = p
  }
  return out
}

// ---- the boss's rounds: a direct route (src/desk/patrol.ts) --------------------------------
// The corridor route above is what colleagues take to their seats: in at the door, up the west
// wall, along the row. From the boss's chair that is the long way round — the first staff row is
// three tiles south of it with nothing in between but its own desk and the plant either side.
// So the rounds use the room's free lanes instead: off the seat row past a plant, down to the
// walkway behind the first row of chairs (the hub every route turns on), along it, and — for a
// desk in a deeper row — down the gap between two desk columns. Every leg is a straight line
// along a lane that nothing stands in, and the way back is the same in reverse; a route cut
// short mid-leg simply turns round on the lane it is on.

/**
 * How far behind a row's chairs its walkway runs (tiles). A chair reaches 0.25 behind its seat
 * point and a hamster is 0.17 deep, so 0.65 leaves a clear gap; the boss also stops on this
 * line when it stands over a colleague.
 */
export const WALK_BACK = 0.65
/** the walkway behind the first staff row: where every direct route changes direction */
export const HUB_J = ORIGIN.j + SEAT.dj - WALK_BACK
/**
 * Down from the seat row, either side of the boss's desk. The plants stand two tiles out from
 * its chair (vox/world.ts) and are 0.21 wide, so 2.75 out clears them by a hamster's width.
 */
export const BOSS_LANES: readonly number[] = [BOSS_SLOT.seat.i - 2.75, BOSS_SLOT.seat.i + 2.75]
/** the gaps between desk columns (and the strips either side of the grid), by their centre line */
export const GAP_LANES: readonly number[] = Array.from({ length: DESK_COLS + 1 }, (_, k) => ORIGIN.i + k * PITCH_I - 1.5)

const sameSpot = (a: Point, b: Point): boolean => Math.abs(a.i - b.i) < 1e-6 && Math.abs(a.j - b.j) < 1e-6
const onLane = (lanes: readonly number[], i: number): number | undefined => lanes.find((l) => Math.abs(l - i) < 1e-6)
const cheapest = (lanes: readonly number[], cost: (lane: number) => number): number => lanes.reduce((best, l) => (cost(l) < cost(best) ? l : best))

/**
 * Waypoints from `at` to the hub walkway. `towards` is where the route is ultimately headed: from
 * the seat row it decides which side of the boss's desk to go round, so the boss never walks the
 * long way round its own desk.
 */
function toHub(at: Point, towards: Point): Point[] {
  if (Math.abs(at.j - HUB_J) < 1e-6) return []
  if (at.j < HUB_J) {
    // north of the hub: the boss's own row. Off the seat row past a plant, then straight down.
    const lane = onLane(BOSS_LANES, at.i) ?? cheapest(BOSS_LANES, (l) => Math.abs(at.i - l) + Math.abs(l - towards.i))
    return Math.abs(lane - at.i) < 1e-6 ? [{ i: lane, j: HUB_J }] : [{ i: lane, j: at.j }, { i: lane, j: HUB_J }]
  }
  // south of the hub: in a gap between desk columns, on a row's walkway, or a step off one (where
  // the boss stands over a colleague). Back to the walkway first, along it to the gap, up the gap.
  const lane = onLane(GAP_LANES, at.i) ?? cheapest(GAP_LANES, (l) => Math.abs(at.i - l))
  if (Math.abs(lane - at.i) < 1e-6) return [{ i: lane, j: HUB_J }]
  const walkway = HUB_J + PITCH_J * Math.round((at.j - HUB_J) / PITCH_J)
  // a step off the hub itself (a first-row spot) goes straight back up onto it
  if (Math.abs(walkway - HUB_J) < 1e-6) return [{ i: at.i, j: HUB_J }]
  return [{ i: at.i, j: walkway }, { i: lane, j: walkway }, { i: lane, j: HUB_J }]
}

/** The lanes from `from` to `to`: up to the hub, along it, down again — minus any retraced leg. */
export function directRoute(from: Point, to: Point): Point[] {
  if (sameSpot(from, to)) return []
  const up = toHub(from, to)
  const down = toHub(to, from)
  // both halves reach the hub on some lane; where they would walk the same lane there and back, cut the loop
  while (up.length && down.length && sameSpot(up[up.length - 1], down[down.length - 1])) {
    up.pop()
    down.pop()
  }
  const out: Point[] = []
  let prev = from
  for (const p of [...up, ...down.reverse(), { ...to }]) {
    if (!sameSpot(p, prev)) out.push(p)
    prev = p
  }
  return out
}

/** `walkTo` for the boss's rounds: the same contract, the direct route instead of the corridor. */
export function walkDirect(walker: Walker, goal: Point): void {
  if (walker.target.i === goal.i && walker.target.j === goal.j) return
  walker.target = { ...goal }
  walker.path = directRoute(walker, goal)
}

export function advanceWalker(walker: Walker, dt: number): void {
  let distance = Math.min(Math.max(dt, 0), 0.1) * 4.5
  walker.moving = false
  while (walker.path.length && distance > 0) {
    const next = walker.path[0]
    const di = next.i - walker.i, dj = next.j - walker.j
    const length = Math.hypot(di, dj)
    if (length < 0.001) { walker.i = next.i; walker.j = next.j; walker.path.shift(); continue }
    walker.facing = Math.abs(di) > Math.abs(dj) ? (di > 0 ? 'se' : 'nw') : (dj > 0 ? 'sw' : 'ne')
    const step = Math.min(length, distance)
    walker.i += di / length * step
    walker.j += dj / length * step
    distance -= step
    walker.moving = true
    if (step === length) { walker.i = next.i; walker.j = next.j; walker.path.shift() }
  }
  if (!walker.path.length) walker.moving = false
}
