// Keeping the speech bubbles apart (src/desk/declutter.ts): feeds that do not touch stay where
// they are, the one nearest the viewer keeps its place, the others move the shortest way clear —
// never off the canvas — and a pile keeps moving the way it moved last frame rather than flicking
// between two near-equal choices.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GAP, declutter, type FeedBox, type Shift } from '../../src/desk/declutter'

const W = 1000
type Rect = { l: number; r: number; t: number; b: number }
const rectOf = (f: FeedBox, s: Shift = { dx: 0, dy: 0 }): Rect => ({ l: f.x - f.w / 2 + s.dx, r: f.x + f.w / 2 + s.dx, t: f.y - f.h + s.dy, b: f.y + s.dy })
const overlap = (a: Rect, b: Rect): boolean => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t

function assertApart(feeds: FeedBox[], out: Map<string, Shift>, label: string): void {
  const rects = feeds.map((f) => ({ id: f.id, r: rectOf(f, out.get(f.id)) }))
  for (let a = 0; a < rects.length; a++) {
    for (let b = a + 1; b < rects.length; b++) assert.ok(!overlap(rects[a].r, rects[b].r), `${label}: ${rects[a].id} and ${rects[b].id} still overlap`)
    assert.ok(rects[a].r.l >= -1e-9 && rects[a].r.r <= W + 1e-9, `${label}: ${rects[a].id} was pushed off the canvas`)
  }
}

test('feeds that do not touch stay exactly where they are', () => {
  const feeds: FeedBox[] = [
    { id: 'a', x: 200, y: 300, w: 180, h: 40 },
    { id: 'b', x: 500, y: 300, w: 180, h: 40 },
    { id: 'c', x: 350, y: 120, w: 180, h: 40 },
  ]
  const out = declutter(feeds, W)
  for (const f of feeds) assert.deepEqual(out.get(f.id), { dx: 0, dy: 0 })
})

test('the one nearest the viewer keeps its place, and the other moves the shortest way clear', () => {
  // the boss behind (anchor higher up the screen) and a colleague in front, their bubbles on top of each other
  const front: FeedBox = { id: 'front', x: 400, y: 320, w: 220, h: 46 }
  const back: FeedBox = { id: 'back', x: 430, y: 300, w: 220, h: 46 }
  const out = declutter([back, front], W)
  assert.deepEqual(out.get('front'), { dx: 0, dy: 0 })
  const m = out.get('back')!
  assert.ok(Math.hypot(m.dx, m.dy) > 0, 'the one behind moved')
  assertApart([back, front], out, 'a pair')
  // the shortest way: up clear of it and the gap (30), not sideways by most of a width (194)
  assert.equal(m.dx, 0)
  assert.equal(m.dy, front.y - front.h - GAP - back.y)
  // two that barely overlap side by side move sideways instead of stacking
  const left: FeedBox = { id: 'left', x: 300, y: 300, w: 200, h: 60 }
  const right: FeedBox = { id: 'right', x: 490, y: 300, w: 200, h: 60 }
  const side = declutter([left, right], W)
  assert.equal(side.get('right')!.dy, 0)
  assert.ok(side.get('right')!.dx > 0 && side.get('right')!.dx <= 20)
  assertApart([left, right], side, 'side by side')
})

test('never off the canvas: at the right edge the way out is up or left, not right', () => {
  const edge: FeedBox = { id: 'edge', x: W - 110, y: 300, w: 200, h: 40 }
  const other: FeedBox = { id: 'other', x: W - 100, y: 310, w: 200, h: 40 }
  const out = declutter([edge, other], W)
  assertApart([edge, other], out, 'at the edge')
})

test('never up into the header band: with no sky left above, the way out is sideways', () => {
  const HEADER = 56
  const low: FeedBox = { id: 'low', x: 400, y: 110, w: 200, h: 40 }
  const high: FeedBox = { id: 'high', x: 420, y: 100, w: 200, h: 40 }
  // up would put the top of `high` at 110 - 40 - 4 - 40 = 26, inside the header
  const out = declutter([low, high], W, undefined, HEADER)
  const m = out.get('high')!
  assert.equal(m.dy, 0, 'pushed up into the header')
  assert.ok(m.dx !== 0)
  assertApart([low, high], out, 'under the header')
  // with no header to keep clear of, up is the shorter way, as before
  assert.ok(declutter([low, high], W).get('high')!.dy < 0)
})

test('a row of four colleagues and the boss, as the automatic framing shows them: all apart', () => {
  const feeds: FeedBox[] = [
    { id: 'main', x: 520, y: 150, w: 230, h: 56 },
    { id: 'a', x: 380, y: 250, w: 210, h: 30 },
    { id: 'b', x: 520, y: 262, w: 200, h: 56 },
    { id: 'c', x: 660, y: 250, w: 220, h: 30 },
    { id: 'd', x: 800, y: 262, w: 190, h: 30 },
  ]
  const out = declutter(feeds, W)
  assertApart(feeds, out, 'the room')
  // deterministic: the same boxes give the same answer
  assert.deepEqual([...declutter(feeds, W)], [...out])
})

test('a pile keeps moving the way it moved last frame when the other way is barely shorter', () => {
  const a: FeedBox = { id: 'a', x: 400, y: 300, w: 200, h: 40 }
  // up needs 40 + GAP, right 38 + GAP — right is shorter by 2, but last frame it went up
  const b: FeedBox = { id: 'b', x: 562, y: 300, w: 200, h: 40 }
  const fresh = declutter([a, b], W)
  assert.ok(fresh.get('b')!.dx > 0, 'with no history, the shorter way (sideways)')
  const sticky = declutter([a, b], W, new Map([['b', { dx: 0, dy: -48 }]]))
  assert.ok(sticky.get('b')!.dy < 0 && sticky.get('b')!.dx === 0, 'with history, the way it was already going')
  assertApart([a, b], sticky, 'sticky')
})
