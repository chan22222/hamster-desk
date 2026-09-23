import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { H_OFFICE, OFFICE, OFFICE_TILE, T, advanceWalker, makeWalker, reconcileSeats, tileToWorld, walkTo } from '../src/desk/office-world'
import { FEED_LINE_PX, FRAME_MAX_SCALE, FRAME_MIN_SCALE, FRAME_PAD, HEADER_PAD, autoFrameCamera, basisOf, createCamera, feedLines, feedTopY, focusCamera, frameCamera, frameHeadPad, frameSubject, groundHit, feedAnchorY, overviewCamera, worldToScreen, zoomCamera } from '../src/desk/office-camera'
import { HAMSTER_H, LEG_Y, buildHamster, coatOf } from '../src/desk/vox/hamster'
import { voxMaterial } from '../src/desk/vox/material'
import { WHITEBOARDS, WINDOWS, buildStudioWorld, COLS, ROWS } from '../src/desk/vox/world'
import { SIGN_H, SIGN_L_H, SIGN_L_W, SIGN_W } from '../src/desk/vox/props'
import { modelSkin } from '../src/desk/skins'
import { tintFor } from '../src/desk/anim'

test('growing occupancy never relocates an existing desk or hamster', () => {
  const seats = new Map<string, number>()
  const furniture = JSON.stringify(OFFICE)
  reconcileSeats(seats, ['main', 'a'])
  const seat = seats.get('a')!
  const position = { ...OFFICE.slots[seat].seat }
  for (const n of [3, 7, OFFICE.slots.length]) {
    reconcileSeats(seats, ['main', 'a', ...Array.from({ length: n - 2 }, (_, k) => `new-${k}`)])
    assert.equal(seats.get('a'), seat)
    assert.deepEqual(OFFICE.slots[seats.get('a')!].seat, position)
    assert.equal(JSON.stringify(OFFICE), furniture)
  }
})

test('removing or reordering earlier agents reuses only the vacant seat', () => {
  const seats = new Map<string, number>()
  reconcileSeats(seats, ['main', 'a', 'b', 'c'])
  const before = new Map(seats)
  reconcileSeats(seats, ['c', 'main', 'b'])
  for (const id of ['main', 'b', 'c']) assert.equal(seats.get(id), before.get(id))
  reconcileSeats(seats, ['c', 'main', 'b', 'replacement'])
  assert.equal(seats.get('replacement'), before.get('a'))
  assert.equal(seats.get('b'), before.get('b'))
})

test('capacity is explicit and waiting agents take a vacancy without shifting anyone', () => {
  const seats = new Map<string, number>()
  const ids = ['main', ...Array.from({ length: OFFICE.slots.length + 3 }, (_, k) => `agent-${k}`)]
  reconcileSeats(seats, ids)
  assert.equal(seats.size, OFFICE.slots.length)
  assert.equal(new Set(seats.values()).size, OFFICE.slots.length)
  assert.equal(seats.get('main'), 0)
  const waiting = ids.find(id => !seats.has(id))!
  const released = seats.get('agent-3')
  reconcileSeats(seats, ids.filter(id => id !== 'agent-3'))
  assert.equal(seats.get(waiting), released)
  assert.equal(seats.get('main'), 0)
})

test("the boss's seat is slot 0, alone along the north wall, and agents never take it", () => {
  const boss = OFFICE.slots[0]
  const staff = OFFICE.slots.slice(1)
  assert.equal(staff.length, OFFICE.staff)
  assert.equal(staff.length, 12)
  // three clear tiles between the boss's desk row and the first staff row
  assert.ok(staff.every((s) => s.j >= boss.j + 4), `staff desk in the boss's rows: ${JSON.stringify(staff.map((s) => s.j))}`)
  assert.ok(boss.seat.j < boss.j, 'the boss sits north of the desk, facing +z like everyone else')
  assert.ok(boss.j + 1 < OFFICE.D && boss.i + 2 <= OFFICE.W, 'the boss desk is inside the room')
  // staff seats are handed out nearest the boss first: distance never decreases along the list
  const dist = (s: typeof staff[number]) => Math.hypot(s.seat.i - boss.seat.i, s.seat.j - boss.seat.j)
  for (let k = 1; k < staff.length; k++) assert.ok(dist(staff[k]) >= dist(staff[k - 1]) - 1e-9, `seat ${k} is closer to the boss than seat ${k - 1}`)
  assert.ok(staff.slice(0, 4).every((s) => s.j === staff[0].j), 'the first four seats should be the row nearest the boss')
  const seats = new Map<string, number>()
  reconcileSeats(seats, ['a', 'b', 'c'])
  assert.ok([...seats.values()].every((k) => k >= 1), 'an agent took the boss seat while main was away')
  reconcileSeats(seats, ['a', 'b', 'main', 'c'])
  assert.equal(seats.get('main'), 0)
})

test('a seated hamster stays stationary across many frames and occupancy changes', () => {
  const seats = new Map<string, number>()
  reconcileSeats(seats, ['main', 'a'])
  const goal = OFFICE.slots[seats.get('a')!].seat
  const walker = makeWalker(goal)
  for (let k = 0; k < 1000; k++) {
    reconcileSeats(seats, k % 2 ? ['main', 'a', 'b', 'c', 'd'] : ['a', 'main'])
    walkTo(walker, OFFICE.slots[seats.get('a')!].seat)
    advanceWalker(walker, 1 / 60)
    assert.deepEqual({ i: walker.i, j: walker.j }, goal)
    assert.equal(walker.moving, false)
    assert.equal(walker.path.length, 0)
  }
})

test('arrivals reach every seat through the corridor, stop, and can leave', () => {
  for (const slot of OFFICE.slots) {
    const walker = makeWalker(OFFICE.door)
    walkTo(walker, slot.seat)
    for (let f = 0; f < 2400; f++) {
      advanceWalker(walker, 1 / 60)
      for (const desk of OFFICE.slots) {
        assert.ok(!(walker.i > desk.i && walker.i < desk.i + 2 && walker.j > desk.j && walker.j < desk.j + 1), 'route crossed a desk')
      }
    }
    assert.deepEqual({ i: walker.i, j: walker.j }, slot.seat)
    assert.equal(walker.moving, false)
    walkTo(walker, slot.seat)
    assert.equal(walker.path.length, 0)
    walkTo(walker, OFFICE.door)
    for (let f = 0; f < 2400; f++) advanceWalker(walker, 1 / 60)
    assert.deepEqual({ i: walker.i, j: walker.j }, OFFICE.door)
    assert.equal(walker.moving, false)
  }
})

test('independent session maps never confuse their shared main hamster id', () => {
  const a = new Map<string, number>(), b = new Map<string, number>()
  reconcileSeats(a, ['main', 'alice', 'bob'])
  reconcileSeats(b, ['main', 'bob', 'alice'])
  const aBefore = new Map(a)
  reconcileSeats(b, ['main', 'alice'])
  assert.deepEqual(a, aBefore)
  assert.notEqual(a.get('alice'), b.get('alice'))
})

/** the controls bar owns the bottom strip (FRAME_PAD is the room the framing leaves each hamster) */
const BOTTOM_PAD = 44
const clampScale = (v: number) => Math.max(FRAME_MIN_SCALE, Math.min(FRAME_MAX_SCALE, v))
type Box = { minX: number; maxX: number; minZ: number; maxZ: number }
const boundsOf = (pts: { x: number; z: number }[]): Box => ({
  minX: Math.min(...pts.map((p) => p.x)) - FRAME_PAD, maxX: Math.max(...pts.map((p) => p.x)) + FRAME_PAD,
  minZ: Math.min(...pts.map((p) => p.z)) - FRAME_PAD, maxZ: Math.max(...pts.map((p) => p.z)) + FRAME_PAD,
})
const seatPoints = (slots: readonly number[]) =>
  slots.flatMap((k) => {
    const s = OFFICE.slots[k].seat
    return [tileToWorld(s.i, s.j), tileToWorld(s.i, s.j + 1)]
  })
const cornersOf = (b: Box) => [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ]] as const
/** the zoom the first pass settles on: the bounds fitted into the whole frame, no strip reserved */
const firstPass = (b: Box, w: number, h: number): number => {
  const probe = createCamera()
  overviewCamera(probe, b, w, h, 0, BOTTOM_PAD)
  return clampScale(probe.scale)
}
/**
 * How much sky the framing actually left, read back off the result. `frameCamera` centres the
 * bounds in the band below the strip, so the centre lands at `(top + h - BOTTOM_PAD) / 2` — which
 * inverts exactly. Measuring it this way means the test never has to trust the implementation.
 */
const reservedPixels = (c: ReturnType<typeof createCamera>, b: Box, w: number, h: number): number => {
  const p = worldToScreen(c, { x: (b.minX + b.maxX) / 2, y: H_OFFICE, z: (b.minZ + b.maxZ) / 2 }, w, h)
  return 2 * p.y - h + BOTTOM_PAD
}

/**
 * The contract between the two halves of the feature: the sky a framing reserves is exactly the
 * sky the rows it draws will use — and when it reserves none, it is because it kept the closer
 * first pass rather than because it forgot.
 */
const assertStrip = (c: ReturnType<typeof createCamera>, b: Box, w: number, h: number, label: string): void => {
  const reserved = reservedPixels(c, b, w, h)
  const s0 = firstPass(b, w, h)
  if (reserved > 1) {
    assert.ok(feedLines(c.scale) > 0, `${label}: reserved ${reserved}px of sky for a feed that is never drawn`)
    assert.ok(
      Math.abs(reserved - frameHeadPad(h, feedLines(s0))) < 2,
      `${label}: a ${reserved}px strip for the ${feedLines(s0)} rows the first pass promised (${frameHeadPad(h, feedLines(s0))}px)`,
    )
  } else {
    assert.ok(Math.abs(c.scale - s0) < 1e-9, `${label}: no strip reserved, so the framing must keep the first pass (${c.scale} vs ${s0})`)
  }
}

test('auto framing: one hamster gets the close-up desk view, a full room stays in frame or at the floor scale, and the feed gets its strip of sky', () => {
  assert.equal(FRAME_MAX_SCALE, 3.4)
  assert.equal(FRAME_MIN_SCALE, 0.75)
  assert.equal(FEED_LINE_PX, 26)
  for (const [w, h] of [[900, 420], [1280, 700], [420, 220]]) {
    // one hamster at the boss's desk: never closer than the close-up cap, centred below the strip
    const one = createCamera()
    const seat = tileToWorld(OFFICE.slots[0].seat.i, OFFICE.slots[0].seat.j)
    const oneBounds = boundsOf([seat, { x: seat.x, z: seat.z + 64 }])
    const oneS0 = firstPass(oneBounds, w, h)
    frameCamera(one, oneBounds, w, h)
    // a close-up carries the whole stack, so this is the widest strip the framing ever reserves
    assert.equal(feedLines(oneS0), 4, `one hamster should carry four feed rows, got ${feedLines(oneS0)} at ${oneS0}`)
    const pad = frameHeadPad(h, 4)
    if (h >= 700) assert.equal(pad, 4 * FEED_LINE_PX + 10, 'a tall viewport fits the full four-row strip')
    // (a 420x220 viewport cannot hold even one desk at 340%, so only the real sizes must clamp)
    if (h >= 400) assert.equal(one.scale, FRAME_MAX_SCALE, `one hamster should sit at the max scale, got ${one.scale}`)
    else assert.ok(one.scale > FRAME_MIN_SCALE && one.scale <= FRAME_MAX_SCALE, `one hamster in a tiny viewport: ${one.scale}`)
    const midY = pad + (h - pad - BOTTOM_PAD) / 2
    const centre = { x: (oneBounds.minX + oneBounds.maxX) / 2, y: H_OFFICE, z: (oneBounds.minZ + oneBounds.maxZ) / 2 }
    const p = worldToScreen(one, centre, w, h)
    assert.ok(Math.abs(p.x - w / 2) < w * 0.03 && Math.abs(p.y - midY) < h * 0.03, `off centre: ${p.x},${p.y} (wanted ${w / 2},${midY})`)
    // the strip is what pushes the subject down; in a viewport so short that it ends up smaller
    // than the controls bar at the bottom, the centre is simply the centre
    if (pad > BOTTOM_PAD) assert.ok(p.y > h / 2, `the framed subject must sit below the middle of the screen, got ${p.y} of ${h}`)
    else assert.ok(p.y >= h / 2 - 6, `even without a usable strip the subject must stay centred, got ${p.y} of ${h}`)
    assert.equal(one.initialized, true)
    // nothing of the subject reaches into the strip: that is where the bubbles stack
    for (const [x, z] of cornersOf(oneBounds)) {
      const sp = worldToScreen(one, { x, y: H_OFFICE, z }, w, h)
      assert.ok(sp.behind || sp.y >= pad, `a corner projected ${sp.y}px down, inside the ${pad}px strip`)
    }

    // every seat taken: either every point is on screen, or the camera stopped at the floor scale
    const all = createCamera()
    const pts = seatPoints(OFFICE.slots.map((_, k) => k))
    const allBounds = boundsOf(pts)
    frameCamera(all, allBounds, w, h)
    assert.ok(all.scale >= FRAME_MIN_SCALE && all.scale <= FRAME_MAX_SCALE, `scale out of range: ${all.scale}`)
    assert.ok(all.scale < one.scale, 'a full room must zoom out from the single-hamster view')
    const inside = pts.every((q) => {
      const sp = worldToScreen(all, { x: q.x, y: H_OFFICE, z: q.z }, w, h)
      return !sp.behind && sp.x >= 0 && sp.x <= w && sp.y >= 0 && sp.y <= h
    })
    assert.ok(inside || all.scale === FRAME_MIN_SCALE, `hamsters cut off at scale ${all.scale} in ${w}x${h}`)
    // and it reserves exactly as much sky as the rows it will actually draw, no more
    assertStrip(all, allBounds, w, h, `full room in ${w}x${h}`)
  }
})

test('auto framing: every zoom bucket reserves exactly its own rows worth of sky', () => {
  const seat = tileToWorld(OFFICE.slots[0].seat.i, OFFICE.slots[0].seat.j)
  const square = (r: number): Box => ({ minX: seat.x - r, maxX: seat.x + r, minZ: seat.z - r, maxZ: seat.z + r })
  assert.deepEqual([3.4, 2.2, 1.9, 1.5, 1.4, 1.1, 0.9, 0.8, 0.76, 0.75, 0.74, 0.2].map(feedLines), [4, 4, 3, 3, 2, 2, 1, 1, 1, 1, 0, 0])
  // the automatic framing never goes further out than its floor, so it always carries a row
  assert.equal(feedLines(FRAME_MIN_SCALE), 1, 'the floor scale must still show each hamster its newest line')
  for (const [w, h] of [[900, 420], [1280, 700]]) {
    // the subject only ever gets bigger, so the first-pass zoom only ever falls: bisect for the
    // size that lands each bucket, then check what the framing actually left clear
    const radiusFor = (target: number): number => {
      let lo = 1, hi = 8000
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2
        if (firstPass(square(mid), w, h) >= target) lo = mid
        else hi = mid
      }
      return lo
    }
    for (const [target, expected] of [[2.6, 4], [1.8, 3], [1.3, 2], [0.9, 1]] as const) {
      const bounds = square(radiusFor(target))
      const s0 = firstPass(bounds, w, h)
      assert.equal(feedLines(s0), expected, `${target} should be a ${expected}-row bucket, got ${feedLines(s0)} at ${s0}`)
      const c = createCamera()
      frameCamera(c, bounds, w, h)
      assertStrip(c, bounds, w, h, `the ${expected}-row bucket in ${w}x${h}`)
      // a bucket with room to spare keeps its strip outright
      if (expected >= 2) {
        const want = frameHeadPad(h, expected)
        const got = reservedPixels(c, bounds, w, h)
        assert.ok(Math.abs(got - want) < 2, `${expected} rows should reserve ${want}px, got ${got}`)
      }
      for (const [x, z] of cornersOf(bounds)) {
        const sp = worldToScreen(c, { x, y: H_OFFICE, z }, w, h)
        assert.equal(sp.behind, false, `corner behind the camera in the ${expected}-row bucket`)
        assert.ok(sp.x >= 0 && sp.x <= w && sp.y >= 0 && sp.y <= h, `corner off screen in the ${expected}-row bucket: ${sp.x},${sp.y}`)
      }
    }
    // Far out, the default floor still carries one row (`feedLines(FRAME_MIN_SCALE)`): a room too
    // big to fit stops there and keeps a one-row strip — never a framing with nothing to say.
    const wide = square(8000)
    const floor = createCamera()
    frameCamera(floor, wide, w, h)
    assert.equal(floor.scale, FRAME_MIN_SCALE)
    assert.ok(Math.abs(reservedPixels(floor, wide, w, h) - frameHeadPad(h, 1)) < 2, 'the floor keeps its one-row strip')
    // Down on a floor of the caller's own that carries no row at all: no strip, and no zoom paid for one.
    const low = 0.5
    const probe = createCamera()
    overviewCamera(probe, wide, w, h, 0, BOTTOM_PAD)
    const s0 = Math.max(low, Math.min(FRAME_MAX_SCALE, probe.scale))
    assert.equal(feedLines(s0), 0)
    assert.equal(frameHeadPad(h, 0), 0)
    const zero = createCamera()
    frameCamera(zero, wide, w, h, low)
    assert.ok(Math.abs(reservedPixels(zero, wide, w, h)) < 2, 'a framing with no feed must reserve nothing')
    assert.equal(zero.scale, s0, 'a framing with no feed must keep the first pass')
  }
})

test('auto framing: a handful of colleagues is framed closer than it used to be, and still shows two feed rows', () => {
  // the real desk: the boss plus the three seats nearest to it — the `shot-autoframe-4` scene
  const w = 1280, h = 520
  const bounds = boundsOf(seatPoints([0, 1, 2, 3]))
  const four = createCamera()
  frameCamera(four, bounds, w, h)
  // it used to sit at 1.04 (pad 80 around each hamster, a flat 56px top pad, cap 2.5)
  assert.ok(four.scale > 1.1, `four hamsters should be framed well inside the old 1.04, got ${four.scale}`)
  // and the point of all of it: the bubbles are actually on screen there
  assert.ok(feedLines(four.scale) >= 2, `four hamsters must carry at least two feed rows, got ${feedLines(four.scale)} at ${four.scale}`)
  assertStrip(four, bounds, w, h, 'four hamsters on the real desk')
})

/**
 * The regression the head-based framing exists for. `frameCamera` reserves its strip from the
 * *floor*, but the bubbles stack from the ear tips — a fixed number of world units up, which is a
 * different number of pixels at every viewport height. At the app's default 420px desk the top of
 * a four-row stack used to land above the canvas; here it has to clear the header at every height.
 */
test('auto framing: a lone hamster keeps its whole feed stack under the header at every desk height', () => {
  const w = 1280
  const seat = OFFICE.slots[0].seat
  const seatW = tileToWorld(seat.i, seat.j)
  const deskW_ = tileToWorld(seat.i, seat.j + 1)
  const bounds = boundsOf([seatW, deskW_])
  for (const h of [420, 520, 700]) {
    const c = createCamera()
    autoFrameCamera(c, bounds, w, h, FRAME_MIN_SCALE, 3.0)
    const lines = feedLines(c.scale)
    // measured over where the hamsters actually stand, not over the empty floor the fit pads them with
    const top = feedAnchorY(c, frameSubject(bounds), w, h)
    assert.ok(top !== null, `${h}px: the bubble anchors projected behind the camera`)
    assert.ok(lines > 0, `${h}px: a lone hamster must still carry feed rows, got ${lines} at ${c.scale}`)
    assert.ok(
      feedTopY(top as number, lines) >= HEADER_PAD - 0.5,
      `${h}px: ${lines} rows over an anchor at ${top} reach ${feedTopY(top as number, lines)}, above the ${HEADER_PAD}px header`,
    )
    // and it is still a close-up of a desk, with the hamster and its desk on screen
    assert.ok(c.scale > 1.5, `${h}px: a lone hamster must stay a close-up, got ${c.scale}`)
    for (const q of [seatW, deskW_]) {
      const p = worldToScreen(c, { x: q.x, y: H_OFFICE, z: q.z }, w, h)
      assert.equal(p.behind, false, `${h}px: the desk went behind the camera`)
      assert.ok(p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h, `${h}px: the desk is off screen at ${p.x},${p.y}`)
    }
  }
})

test('auto framing: a handful of colleagues still shows two feed rows under the header', () => {
  const w = 1280
  const bounds = boundsOf(seatPoints([0, 1, 2, 3]))
  for (const h of [420, 520]) {
    const c = createCamera()
    autoFrameCamera(c, bounds, w, h)
    assert.ok(c.scale > 1.1, `${h}px: four hamsters should stay well inside the old 1.04, got ${c.scale}`)
    const lines = feedLines(c.scale)
    assert.ok(lines >= 2, `${h}px: four hamsters must carry at least two feed rows, got ${lines} at ${c.scale}`)
    const top = feedAnchorY(c, frameSubject(bounds), w, h) as number
    assert.ok(feedTopY(top, lines) >= HEADER_PAD - 0.5, `${h}px: the stack reaches ${feedTopY(top, lines)}, above the header`)
  }
})

test('zoom keeps the ground point under the cursor exactly where it was', () => {
  const c = createCamera()
  const slot = OFFICE.slots[0]
  focusCamera(c, tileToWorld(slot.seat.i, slot.seat.j), 900, 420)
  const x = 261, y = 193
  const before = groundHit(c, x, y, 900, 420)!
  assert.ok(before)
  zoomCamera(c, 4, x, y, 900, 420)
  const after = groundHit(c, x, y, 900, 420)!
  assert.ok(Math.abs(after.x - before.x) < 1e-6, `x drifted ${after.x - before.x}`)
  assert.ok(Math.abs(after.z - before.z) < 1e-6, `z drifted ${after.z - before.z}`)
})

test('overview frames the whole island even in a compact viewport', () => {
  const world = buildStudioWorld()
  for (const [w, h] of [[900, 420], [420, 220]]) {
    const c = createCamera()
    overviewCamera(c, world.bounds, w, h)
    assert.ok(c.scale < 2.5, `overview should zoom out, got ${c.scale}`)
    for (const [x, z] of [[world.bounds.minX, world.bounds.minZ], [world.bounds.maxX, world.bounds.minZ], [world.bounds.minX, world.bounds.maxZ], [world.bounds.maxX, world.bounds.maxZ]]) {
      const p = worldToScreen(c, { x, y: H_OFFICE, z }, w, h)
      assert.equal(p.behind, false)
      assert.ok(p.x >= 0 && p.x <= w, `corner off screen horizontally: ${p.x}`)
      assert.ok(p.y >= 56 && p.y <= h - 44, `corner off screen vertically: ${p.y}`)
    }
  }
})

test('focus puts its target at the middle of the viewport', () => {
  const c = createCamera()
  for (const slot of OFFICE.slots) {
    const target = tileToWorld(slot.seat.i, slot.seat.j)
    focusCamera(c, target, 900, 420)
    const p = worldToScreen(c, { x: target.x, y: H_OFFICE, z: target.z }, 900, 420)
    assert.ok(Math.abs(p.x - 450) < 900 * 0.03, `off centre horizontally: ${p.x}`)
    assert.ok(Math.abs(p.y - 210) < 420 * 0.03, `off centre vertically: ${p.y}`)
  }
})

test('every model skin builds a hamster that stands on the floor at a readable size', () => {
  const material = voxMaterial({ localDetail: true })
  const models = ['claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-newmodel-7', null]
  for (const model of models) {
    const skin = modelSkin(model)
    const main = model === 'claude-fable-5-1'
    const rig = buildHamster({ skin, tint: tintFor(main ? 'main' : 'Explore'), main }, material)
    const box = new THREE.Box3().setFromObject(rig.group)
    const height = box.max.y - box.min.y
    assert.ok(height > 55 && height < 80, `${model}: height ${height}`)
    // the soles are the lowest thing in the rig and they rest exactly on y 0 — a hamster neither
    // sinks into the deck nor hovers over it, whatever the skin does to the head
    assert.ok(Math.abs(box.min.y) < 0.01, `${model}: feet at ${box.min.y}, not on the floor`)
    assert.equal(rig.legY, LEG_Y)
    assert.equal(rig.legs.length, 4)
    const geos = rig.legs.map((l) => (l.children[0] as THREE.Mesh).geometry)
    assert.ok(geos.every((gg) => gg === geos[0]), `${model}: limbs must share one geometry`)
    if (skin.accessory !== 'none') assert.ok(rig.headG.children.length >= 2, `${model}: accessory missing`)
    // HAMSTER_H is what the bubbles and glyphs anchor to, so it has to be the ear tips for real
    else assert.ok(Math.abs(box.max.y - HAMSTER_H) < 0.01, `${model}: HAMSTER_H ${HAMSTER_H} but the ears top out at ${box.max.y}`)
  }
})

test('newcomers from the sea cycle through four coats, and the fifth shares the first one’s geometry instead of building its own', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 8, 9, 13].map(coatOf), [0, 1, 2, 3, 4, 1, 4, 1, 1])
  const material = voxMaterial({ localDetail: true })
  const skin = modelSkin('claude-opus-5')
  const rig = (variant: number) => buildHamster({ skin, tint: tintFor('Explore'), main: false, variant }, material)
  assert.equal(rig(5).bodyM.geometry, rig(1).bodyM.geometry, 'the geometry cache grew for a coat it already had')
  assert.equal(rig(41).bodyM.geometry, rig(1).bodyM.geometry)
  assert.notEqual(rig(2).bodyM.geometry, rig(1).bodyM.geometry, 'consecutive newcomers wear different coats')
  assert.notEqual(rig(1).bodyM.geometry, rig(0).bodyM.geometry)
})

test('a basis worked out once projects exactly as the one worldToScreen works out itself', () => {
  const c = createCamera()
  focusCamera(c, tileToWorld(7.5, 5.25), 900, 420, 1.7)
  c.yaw += 0.4
  c.pitch += 0.1
  const b = basisOf(c)
  for (const p of [{ x: 900, y: 24, z: 800 }, { x: 1200, y: 120, z: 1400 }, { x: 700, y: 60, z: 1000 }]) {
    assert.deepEqual(worldToScreen(c, p, 900, 420, b), worldToScreen(c, p, 900, 420))
  }
})

test('the island is deterministic, keeps the office on its deck and the trees outside it', () => {
  const a = buildStudioWorld()
  const b = buildStudioWorld()
  assert.equal(a.boxCount, b.boxCount)
  assert.deepEqual(a.bounds, b.bounds)
  assert.equal(JSON.stringify(a.mapColors), JSON.stringify(b.mapColors))
  assert.ok(a.chunks.length >= 6, `too few chunks: ${a.chunks.length}`)
  assert.equal(a.deskParts.length, OFFICE.slots.length)

  for (let j = 0; j < OFFICE.D; j++) for (let i = 0; i < OFFICE.W; i++) {
    const tx = 10 + i, ty = 8 + j
    assert.ok(a.land[ty][tx], `office tile ${tx},${ty} is water`)
    assert.equal(a.heights[ty][tx], H_OFFICE, `office tile ${tx},${ty} is not on the deck`)
  }
  // the ground outside the door must be walkable island, not sea
  const door = tileToWorld(OFFICE.door.i, OFFICE.door.j)
  const doorTx = Math.floor(door.x / 64) - 2
  const doorTy = Math.floor(door.z / 64)
  assert.ok(a.land[doorTy][doorTx], 'no land in front of the door')

  assert.ok(a.trees.length >= 10, `too few trees: ${a.trees.length}`)
  const inside = a.trees.filter((t) => {
    const tx = Math.floor(t.x / 64), ty = Math.floor(t.z / 64)
    return tx >= 10 && tx < 10 + OFFICE.W && ty >= 8 && ty < 8 + OFFICE.D
  })
  assert.equal(inside.length, 0, 'a tree grew through the office floor')
  assert.equal(a.mapColors.length, ROWS)
  assert.equal(a.mapColors[0].length, COLS)
})

test('the Spritfy prints hang on the north and west walls, each in a bay of its own, clear of everything else on the wall', () => {
  const world = buildStudioWorld()
  assert.equal(world.signs.length, 2)
  const x0 = OFFICE_TILE.i * T, x1 = (OFFICE_TILE.i + OFFICE.W) * T
  const z0 = OFFICE_TILE.j * T, z1 = (OFFICE_TILE.j + OFFICE.D) * T
  const deck = H_OFFICE
  for (const s of world.signs) {
    // under the trim (deck + 114), and hung on a wall — just in front of the plaster's inner face
    // (12 in from the deck's edge), like every other wall piece: never standing in the room, so
    // never on a seat, a lane or the corridor
    assert.ok(s.y + s.h / 2 + 3 <= deck + 114, `${s.id}: the frame reaches into the trim, top at ${s.y + s.h / 2 + 3}`)
    if (s.rot === 0) assert.ok(s.z > z0 + 12 && s.z < z0 + 15, `${s.id}: floats ${s.z - z0 - 12} in front of the north wall`)
    else if (s.rot === 1) assert.ok(s.x > x0 + 12 && s.x < x0 + 15, `${s.id}: floats ${s.x - x0 - 12} in front of the west wall`)
    else assert.fail(`${s.id}: the room has only a north and a west wall (rot ${s.rot})`)
  }

  // ---- north: between the second window and the second whiteboard, east of the boss ----------
  const n = world.signs.find((s) => s.id === 'spritfy-north')!
  assert.ok(n)
  assert.equal(n.rot, 0, 'a north-wall piece faces +z')
  assert.deepEqual([n.w, n.h], [SIGN_W, SIGN_H])
  // inside the room's width and above the wainscot (deck + 40)
  assert.ok(n.x - n.w / 2 > x0 + 12 && n.x + n.w / 2 < x1, `the print leaves the wall: ${n.x} ± ${n.w / 2}`)
  assert.ok(n.y - n.h / 2 - 3 > deck + 40, `the frame reaches into the wainscot: bottom at ${n.y - n.h / 2 - 3}`)
  // and its frame (3 wide) shares no wall with a window (frame 130 wide) or a whiteboard (122 wide)
  const nLeft = n.x - n.w / 2 - 3, nRight = n.x + n.w / 2 + 3
  const northFixtures = [
    ...WINDOWS.map((i) => ({ at: (OFFICE_TILE.i + i + 1) * T, half: 65, what: 'window' })),
    ...WHITEBOARDS.map((i) => ({ at: (OFFICE_TILE.i + i + 1) * T, half: 61, what: 'whiteboard' })),
  ]
  for (const f of northFixtures) {
    assert.ok(nRight < f.at - f.half || nLeft > f.at + f.half, `the print overlaps the ${f.what} at ${f.at}`)
  }
  // east of the boss's desk, not behind it: that bay is where the main hamster's bubbles stack
  const boss = tileToWorld(OFFICE.slots[0].seat.i, OFFICE.slots[0].seat.j)
  assert.ok(nLeft > boss.x + 80, `the print hangs over the boss's desk (left edge ${nLeft}, seat ${boss.x})`)

  // ---- west: the bigger one, between the door and the poster below it ------------------------
  const w = world.signs.find((s) => s.id === 'spritfy-west')!
  assert.ok(w)
  assert.equal(w.rot, 1, 'a west-wall piece faces +x')
  assert.deepEqual([w.w, w.h], [SIGN_L_W, SIGN_L_H])
  assert.ok(w.w > n.w && w.h > n.h, 'the west print is the larger of the two')
  assert.ok(w.z - w.w / 2 > z0 + 12 && w.z + w.w / 2 < z1, `the print leaves the wall: ${w.z} ± ${w.w / 2}`)
  assert.ok(w.y - w.h / 2 - 3 > deck + 12, `the frame reaches the floor: bottom at ${w.y - w.h / 2 - 3}`)
  // its frame shares no wall with the door (jambs 80 apart), the posters (44 wide), the clock
  // (30) or the bookshelf (120 deep, 96 tall, against this wall) — the wall's other fixtures
  const wLeft = w.z - w.w / 2 - 3, wRight = w.z + w.w / 2 + 3
  const westFixtures = [
    { at: tileToWorld(0, OFFICE.door.j).z, half: 40, what: 'door' },
    ...[4.8, 12, 16].map((j) => ({ at: tileToWorld(0, j).z, half: 22, what: `poster at ${j}` })),
    { at: tileToWorld(0, 2.6).z, half: 15, what: 'clock' },
    { at: tileToWorld(0, 1.8).z, half: 60, what: 'bookshelf' },
  ]
  for (const f of westFixtures) {
    assert.ok(wRight < f.at - f.half || wLeft > f.at + f.half, `the print overlaps the ${f.what} at ${f.at}`)
  }
  // on the wall, it is a clear tile away from the corridor (i 0.5) that every colleague walks in
  // along and from the lobby where the ones without a desk wait
  const corridor = tileToWorld(0.5, 0).x
  assert.ok(w.x + 3 < corridor - 20, `the print reaches into the corridor: front at ${w.x + 3}, lane at ${corridor}`)
})
