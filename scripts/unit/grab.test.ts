// Picking a hamster up and throwing it (src/desk/grab.ts), against a toy island: the office deck,
// grass out to a shore, water beyond. A still hand drops the hamster where it is and it lands on
// the deck; a flick throws it, capped, in an arc; over the water it splashes, sinks and is gone; a
// fall onto a desk is pushed off the furniture; and the way home is the boss's lanes inside the
// office and, from outside, round the building to the door — never through a wall or a desk.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GAP_LANES, H_OFFICE, HUB_J, LOBBY, OFFICE, OFFICE_TILE, T, corridorRoute, directRoute, tileToWorld, type Point } from '../../src/desk/office-world'
import { BOSS_DESK_W, DESK_D, DESK_W } from '../../src/desk/vox/props'
import {
  DROP_SPEED,
  GRAVITY,
  LIFT,
  MAX_THROW,
  PORCH_I,
  SINK_S,
  THROW_ARC,
  THROW_UP,
  TRAIL_MS,
  carry,
  fly,
  grab,
  hang,
  landingSpot,
  release,
  returnPath,
  worldToTile,
  type Flight,
  type FlightEvent,
  type Ground,
} from '../../src/desk/grab'

const WATER_Y = -22
const FRAME = 1 / 60
/** the island as the flight sees it: the deck, grass for five tiles beyond it, then the sea */
const DECK = { x0: OFFICE_TILE.i * T, x1: (OFFICE_TILE.i + OFFICE.W) * T, z0: OFFICE_TILE.j * T, z1: (OFFICE_TILE.j + OFFICE.D) * T }
const SHORE = 5 * T
const ground: Ground = (x, z) => {
  if (x >= DECK.x0 && x < DECK.x1 && z >= DECK.z0 && z < DECK.z1) return H_OFFICE
  if (x >= DECK.x0 - SHORE && x < DECK.x1 + SHORE && z >= DECK.z0 - SHORE && z < DECK.z1 + SHORE) return 0
  return null
}

const seat = OFFICE.slots[3].seat
const seatW = tileToWorld(seat.i, seat.j)
/** where the hand is when it takes the hamster: a little off to one side of it */
const HAND = { x: seatW.x + 20, z: seatW.z - 30 }
/** a hamster on its chair, taken by that hand */
const pickUp = (now = 0) => grab('a1', { x: seatW.x, y: H_OFFICE + 17, z: seatW.z }, HAND, now)

/** fly until it is on the ground or gone; the distinct events in order, and how long it took */
function flyOut(f: Flight, limit = 10): { events: FlightEvent[]; time: number } {
  const events: FlightEvent[] = []
  let time = 0
  while (time < limit) {
    const ev = fly(f, FRAME, ground, WATER_Y)
    time += FRAME
    if (ev !== events[events.length - 1]) events.push(ev)
    if (ev === 'landed' || ev === 'gone') break
  }
  return { events, time }
}

const near = (a: number, b: number, eps: number): void => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} ± ${eps}`)

test('a held hamster keeps its offset from the hand and rises to carrying height', () => {
  const h = pickUp()
  assert.equal(h.dx, -20)
  assert.equal(h.dz, 30)
  carry(h, { x: 1000, z: 900 }, 16)
  assert.equal(h.x, 980)
  assert.equal(h.z, 930)
  carry(h, null, 32) // pointing at the sky: it stays where it was
  assert.equal(h.x, 980)
  for (let k = 0; k < 60; k++) hang(h, FRAME)
  near(h.y, H_OFFICE + LIFT, 0.5)
})

test('a still hand drops it straight down onto the deck, where it stands', () => {
  const h = pickUp()
  for (let k = 0; k < 60; k++) hang(h, FRAME)
  const f = release(h, 0)
  assert.deepEqual([f.vx, f.vy, f.vz], [0, 0, 0])
  const { events, time } = flyOut(f)
  assert.deepEqual(events, ['air', 'landed'])
  assert.equal(f.x, seatW.x)
  assert.equal(f.z, seatW.z)
  assert.equal(f.y, H_OFFICE)
  near(time, Math.sqrt((2 * LIFT) / GRAVITY), 0.05)
})

test('a hand that stopped moving a while ago drops rather than throws', () => {
  const h = pickUp()
  for (let t = 16; t <= 96; t += 16) carry(h, { x: HAND.x + t * 10, z: HAND.z }, t)
  const f = release(h, 96 + TRAIL_MS + 50)
  assert.deepEqual([f.vx, f.vy, f.vz], [0, 0, 0])
})

test('a slow move is a drop; a flick is a throw, capped, with an arc, in the direction of the move', () => {
  const slow = pickUp()
  for (let t = 16; t <= 96; t += 16) carry(slow, { x: HAND.x + t * 0.05, z: HAND.z }, t) // 50 units/s
  const fs = release(slow, 96)
  assert.ok(50 < DROP_SPEED)
  assert.deepEqual([fs.vx, fs.vy, fs.vz], [0, 0, 0])

  const fast = pickUp()
  for (let t = 16; t <= 96; t += 16) carry(fast, { x: HAND.x, z: HAND.z + t * 6 }, t) // 6000 units/s, north
  const ff = release(fast, 96)
  near(ff.vx, 0, 1e-9)
  near(ff.vz, MAX_THROW, 1e-6)
  near(ff.vy, THROW_UP + MAX_THROW * THROW_ARC, 1e-6)
  // only the last TRAIL_MS of the trail counts
  assert.ok(fast.trail.every((s) => 96 - s.t <= TRAIL_MS))
})

test('thrown hard from the deck it clears the shore, splashes, sinks and is gone', () => {
  const h = pickUp()
  for (let k = 0; k < 60; k++) hang(h, FRAME)
  for (let t = 16; t <= 96; t += 16) carry(h, { x: HAND.x + t * 6, z: HAND.z }, t) // east, flat out
  const f = release(h, 96)
  const { events, time } = flyOut(f)
  assert.deepEqual(events, ['air', 'splash', 'sink', 'gone'])
  assert.ok(f.x > DECK.x1 + SHORE, `splashed at x ${f.x}, past the shore at ${DECK.x1 + SHORE}`)
  assert.ok(f.y < WATER_Y, 'went under')
  near(f.age, SINK_S, FRAME)
  assert.ok(time < 3, `took ${time}s`)
})

test('a soft toss lands on the deck; one off its edge lands on the grass below', () => {
  const soft = pickUp()
  for (let k = 0; k < 60; k++) hang(soft, FRAME)
  for (let t = 16; t <= 96; t += 16) carry(soft, { x: HAND.x + t * 0.3, z: HAND.z }, t) // 300 units/s
  const f = release(soft, 96)
  assert.deepEqual(flyOut(f).events, ['air', 'landed'])
  assert.equal(f.y, H_OFFICE)
  assert.ok(f.x > seatW.x && f.x < DECK.x1)

  const edge: Flight = { id: 'a1', x: DECK.x1 - 10, y: H_OFFICE + LIFT, z: (DECK.z0 + DECK.z1) / 2, vx: 400, vy: 0, vz: 0, phase: 'air', age: 0 }
  assert.deepEqual(flyOut(edge).events, ['air', 'landed'])
  assert.equal(edge.y, 0)
  assert.ok(edge.x > DECK.x1)
})

// ---- where it stands after a fall, and the way home -----------------------------------------

/** the desk, its chair and the strip between, as landingSpot treats them (tiles) */
const inDesk = (p: Point): boolean =>
  OFFICE.slots.some((s) => {
    const hw = (s === OFFICE.slots[0] ? BOSS_DESK_W : DESK_W) / T / 2
    return p.i > s.i + 0.5 - hw && p.i < s.i + 0.5 + hw && p.j > s.seat.j - 0.65 && p.j < s.j + DESK_D / T / 2
  })

test('a fall onto a desk (or its chair) is pushed off the furniture, no further than it has to', () => {
  for (const s of OFFICE.slots) {
    for (const at of [{ i: s.i + 0.5, j: s.j }, { i: s.i + 0.5, j: s.seat.j }, { i: s.i + 1.1, j: s.j + 0.2 }]) {
      const spot = landingSpot(at)
      assert.ok(!inDesk(spot), `slot at (${s.i}, ${s.j}): (${at.i}, ${at.j}) → (${spot.i}, ${spot.j}) is still on the desk`)
      assert.ok(Math.hypot(spot.i - at.i, spot.j - at.j) < 1.6, 'a short push')
    }
  }
  const free = { i: GAP_LANES[1], j: HUB_J }
  assert.deepEqual(landingSpot(free), free)
})

test('worldToTile is the inverse of tileToWorld', () => {
  const p = worldToTile(tileToWorld(3.25, 7.5))
  near(p.i, 3.25, 1e-9)
  near(p.j, 7.5, 1e-9)
})

const inside = (p: Point): boolean => p.i > -0.5 && p.i < OFFICE.W - 0.5 && p.j > -0.5 && p.j < OFFICE.D - 0.5
const same = (a: Point, b: Point): boolean => Math.abs(a.i - b.i) < 1e-9 && Math.abs(a.j - b.j) < 1e-9

test('inside the office the way home is the direct lanes, ending on the seat', () => {
  const from = { i: GAP_LANES[2], j: HUB_J }
  const path = returnPath(from, seat)
  assert.deepEqual(path, directRoute(from, seat))
  assert.ok(same(path[path.length - 1], seat))
})

test('from outside it goes round the building to the steps, in at the door and up the corridor', () => {
  const door = OFFICE.door
  // in at the door, it walks on as a colleague arriving would: along the aisle behind its row, not the seat line
  const tail = [{ i: PORCH_I, j: door.j }, { ...door }, ...corridorRoute(door, seat)]
  assert.ok(tail.slice(2, -1).every((p) => Math.abs(p.j - seat.j) > 1e-9), 'the way in runs along the row of chairs')
  // west of the wall: straight to the steps
  assert.deepEqual(returnPath({ i: -3, j: 3 }, seat), tail)
  // north of it: along the north side to the west, then down to the steps
  assert.deepEqual(returnPath({ i: 5, j: -3 }, seat), [{ i: PORCH_I, j: -3 }, ...tail])
  // east of it, level with its rows: out past a corner first, and never through the floor
  for (const j of [2, 10, OFFICE.D - 2]) {
    const path = returnPath({ i: OFFICE.W + 2, j }, seat)
    const doorAt = path.findIndex((p) => same(p, door))
    assert.ok(doorAt > 1, 'reaches the door after going round')
    for (const p of path.slice(0, doorAt)) assert.ok(!inside(p), `(${p.i}, ${p.j}) cuts through the office`)
    assert.deepEqual(path.slice(doorAt + 1), tail.slice(2))
  }
})

test('one that was on its way out when it was thrown heads for the door from where it lands — never through a desk or a wall', () => {
  const door = OFFICE.door
  // inside: the lanes to the first row's walkway, then down the corridor to the door
  for (const from of [{ i: GAP_LANES[2], j: HUB_J }, { i: GAP_LANES[3], j: HUB_J + 8 }, landingSpot({ i: seat.i, j: seat.j })]) {
    const path = returnPath(from, door)
    assert.ok(same(path[path.length - 1], door), 'ends at the door')
    assert.deepEqual(path, directRoute(from, door))
    assert.ok(path.every((q, k) => { const p = k ? path[k - 1] : from; return Math.abs(q.i - p.i) < 1e-9 || Math.abs(q.j - p.j) < 1e-9 }), 'every leg runs along a lane')
  }
  // outside: round the building to the steps and in — and there it is at the door already
  const out = returnPath({ i: OFFICE.W + 2, j: 10 }, door)
  assert.ok(same(out[out.length - 1], door))
  for (const p of out.slice(0, -1)) assert.ok(!inside(p), `(${p.i}, ${p.j}) cuts through the office`)
})

test('one from the queue goes back to its place in the queue by way of the door, as a newcomer joins it', () => {
  const place = LOBBY[2]
  const from = { i: GAP_LANES[2], j: HUB_J }
  const path = returnPath(from, place)
  const doorAt = path.findIndex((p) => same(p, OFFICE.door))
  assert.ok(doorAt >= 0, 'by the door')
  assert.deepEqual(path.slice(0, doorAt + 1), directRoute(from, OFFICE.door))
  assert.deepEqual(path.slice(doorAt + 1), corridorRoute(OFFICE.door, place))
})
