// The corridor routes (office-world.ts `walkTo` / `corridorRoute`) and the queue by the door
// (`LOBBY`), walked frame by frame against the furniture as the world places it (furniture.ts): a
// colleague comes in at the door, down the corridor, along the aisle behind its row and only then
// onto its own chair — never through another chair and the colleague in it, a desk, the water
// cooler or a plant — and leaves the same way. The queue stands clear of every route, moves up one
// step along its own file, a newcomer joins it straight from the corridor, and the one at its head
// walks to the desk it is given without going through the others still waiting.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CORRIDOR_I, GAP_LANES, HUB_J, LOBBY, OFFICE, WALK_BACK, advanceWalker, corridorRoute, makeWalker, walkTo, type Point, type Walker } from '../../src/desk/office-world'
import { FURNITURE, HALF, touching, type Box } from './furniture'

const FRAME = 1 / 60
const near = (a: Point, b: Point): boolean => Math.hypot(a.i - b.i, a.j - b.j) < 0.01
/** the staff rows' seat lines, and the aisle behind each */
const ROWS = [...new Set(OFFICE.slots.slice(1).map((s) => s.seat.j))]
const AISLES = ROWS.map((j) => j - WALK_BACK)
/** somebody standing at `p`, as an obstacle */
const standing = (p: Point, what: string): Box => ({ i0: p.i - HALF, i1: p.i + HALF, j0: p.j - HALF, j1: p.j + HALF, what })

/** walk until the path runs out, noting everything the walker touched on the way */
function walk(w: Walker, obstacles: readonly Box[]): string[] {
  const hits = new Map<string, string>()
  for (let f = 0; f < 60 * 60 && w.path.length; f++) {
    advanceWalker(w, FRAME)
    const hit = touching(w, obstacles)
    if (hit && !hits.has(hit.what)) hits.set(hit.what, `${hit.what} at ${w.i.toFixed(2)},${w.j.toFixed(2)}`)
  }
  return [...hits.values()]
}

test('every desk, there and back: down the corridor and along the aisle behind the row, never through a chair, a desk, the cooler or a plant', () => {
  OFFICE.slots.forEach((slot, k) => {
    const obstacles = FURNITURE.filter((b) => b.what !== `chair ${k}`) // its own chair is where it is going
    const w = makeWalker(OFFICE.door)
    walkTo(w, slot.seat)
    // a staff row's seat line is never walked along: every other chair of the row stands on it
    // (the boss's row has no other chair, and its walkway is the seat line)
    if (k) assert.ok(w.path.slice(0, -1).every((p) => Math.abs(p.j - slot.seat.j) > 1e-9), `desk ${k}: the route runs along the seat line ${JSON.stringify(w.path)}`)
    assert.deepEqual(walk(w, obstacles), [], `desk ${k}: walking in`)
    assert.ok(near(w, slot.seat), `desk ${k}: stopped at ${w.i},${w.j}`)
    assert.equal(w.moving, false)
    walkTo(w, OFFICE.door)
    assert.deepEqual(walk(w, obstacles), [], `desk ${k}: walking out`)
    assert.ok(near(w, OFFICE.door), `desk ${k}: never reached the door`)
  })
})

test('turned round half-way — in to its desk, then sent home — it goes back by the corridor, not through the room', () => {
  for (const k of [2, 6, OFFICE.slots.length - 1]) {
    const slot = OFFICE.slots[k]
    const obstacles = FURNITURE.filter((b) => b.what !== `chair ${k}`)
    for (const frames of [30, 90, 150, 210]) {
      const w = makeWalker(OFFICE.door)
      walkTo(w, slot.seat)
      for (let f = 0; f < frames && w.path.length; f++) advanceWalker(w, FRAME)
      walkTo(w, OFFICE.door)
      assert.deepEqual(walk(w, obstacles), [], `desk ${k}, turned after ${frames} frames`)
      assert.ok(near(w, OFFICE.door))
    }
  }
})

test('the queue stands by the door in one file, clear of the corridor, the lanes, the aisles and the furniture', () => {
  assert.ok(LOBBY.length >= 4, 'room for a few')
  assert.deepEqual(OFFICE.lobby, LOBBY[0])
  LOBBY.forEach((q, k) => {
    assert.equal(touching(q), undefined, `spot ${k} is in the ${touching(q)?.what}`)
    assert.ok(q.i - HALF >= CORRIDOR_I + HALF, `spot ${k} is on the corridor`)
    for (const lane of GAP_LANES) assert.ok(Math.abs(q.i - lane) >= 2 * HALF, `spot ${k} is on the lane at ${lane}`)
    for (const aisle of [HUB_J, ...AISLES]) assert.ok(Math.abs(q.j - aisle) >= 2 * HALF, `spot ${k} is on the aisle at ${aisle}`)
    if (k) {
      assert.equal(q.i, LOBBY[0].i, 'one file')
      assert.ok(q.j - LOBBY[k - 1].j >= 2 * HALF, `spots ${k - 1} and ${k} overlap`)
      // moving up the queue is one step along its own file
      assert.deepEqual(corridorRoute(q, LOBBY[k - 1]), [LOBBY[k - 1]])
    }
  })
  // by the door: its head is less than a tile along the wall from it
  assert.ok(Math.abs(LOBBY[0].j - OFFICE.door.j) < 1, 'the head of the queue is by the door')
})

test('a newcomer joins the end of the queue from the corridor, and the head walks to the desk it is given past nobody', () => {
  LOBBY.forEach((spot, k) => {
    // the ones before it are standing in their places already
    const waiting = LOBBY.slice(0, k).map((q, n) => standing(q, `queued ${n}`))
    const w = makeWalker(OFFICE.door)
    walkTo(w, spot)
    assert.deepEqual(walk(w, [...FURNITURE, ...waiting]), [], `joining at ${k}`)
    assert.ok(near(w, spot))
  })
  OFFICE.slots.slice(1).forEach((slot, n) => {
    const k = n + 1
    // the rest of the queue is still standing behind the head
    const behind = LOBBY.slice(1).map((q, m) => standing(q, `queued ${m + 1}`))
    const w = makeWalker(LOBBY[0])
    walkTo(w, slot.seat)
    assert.deepEqual(walk(w, [...FURNITURE.filter((b) => b.what !== `chair ${k}`), ...behind]), [], `from the head of the queue to desk ${k}`)
    assert.ok(near(w, slot.seat))
  })
})
