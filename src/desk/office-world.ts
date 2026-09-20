// The office floor plan and who sits where. Pure data + math: no three, no DOM, so the node
// test can drive it directly. The 3D camera lives in office-camera.ts and the voxel geometry in
// vox/world.ts; both read the constants below.

export interface Point { i: number; j: number }
export interface Seat extends Point { seat: Point; chair: Point }

/** floor tile size in world units */
export const T = 64
/** the office's north-west corner, in world tiles */
export const OFFICE_TILE = { i: 10, j: 8 } as const
/** the office deck sits one step above the island */
export const H_OFFICE = 24

/** office tile point → world centre. (0,0) is the middle of the office's first tile. */
export function tileToWorld(i: number, j: number): { x: number; z: number } {
  return { x: (OFFICE_TILE.i + i + 0.5) * T, z: (OFFICE_TILE.j + j + 0.5) * T }
}

// The office is a fixed place: the boss's desk alone along the north wall, then a dozen staff
// desks in three rows. Claude Code rarely runs more than a handful of subagents at once, so extra
// hamsters wait by the door instead of growing the room.
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

const slots: Seat[] = [
  BOSS_SLOT,
  ...Array.from({ length: DESK_COLS * DESK_ROWS }, (_, k) =>
    seatAt(ORIGIN.i + (k % DESK_COLS) * PITCH_I, ORIGIN.j + Math.floor(k / DESK_COLS) * PITCH_J),
  ).sort((a, b) => a.i + a.j - b.i - b.j || a.j - b.j),
]

export const OFFICE = {
  W: ORIGIN.i + DESK_COLS * PITCH_I + 1,
  D: ORIGIN.j + DESK_ROWS * PITCH_J + 2,
  slots,
  door: { i: 0.5, j: 6.5 },
  /** where hamsters without a desk wait (near the door, along the left wall) */
  lobby: { i: 1.2, j: 8.5 },
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
}

export function makeWalker(at: Point): Walker {
  return { ...at, target: { ...at }, path: [], facing: 'se', moving: false }
}

/**
 * Travel through the left corridor and the aisle behind each row, never through desks. The boss's
 * seat is reached the same way: up the corridor to the north walkway (j 1.25), then east along it.
 */
export function walkTo(walker: Walker, goal: Point): void {
  if (walker.target.i === goal.i && walker.target.j === goal.j) return
  walker.target = { ...goal }
  if (Math.hypot(walker.i - goal.i, walker.j - goal.j) < 0.01) { walker.path = []; return }
  walker.path = [
    { i: 0.5, j: walker.j },
    { i: 0.5, j: goal.j },
    { ...goal },
  ]
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
