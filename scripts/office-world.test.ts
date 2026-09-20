import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { H_OFFICE, OFFICE, advanceWalker, makeWalker, reconcileSeats, tileToWorld, walkTo } from '../src/desk/office-world'
import { createCamera, focusCamera, groundHit, overviewCamera, worldToScreen, zoomCamera } from '../src/desk/office-camera'
import { buildHamster } from '../src/desk/vox/hamster'
import { voxMaterial } from '../src/desk/vox/material'
import { buildStudioWorld, COLS, ROWS } from '../src/desk/vox/world'
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
    const rig = buildHamster({ skin, tint: tintFor(model === 'claude-fable-5-1' ? 'main' : 'Explore'), main: model === 'claude-fable-5-1' }, material)
    const box = new THREE.Box3().setFromObject(rig.group)
    const height = box.max.y - box.min.y
    assert.ok(height > 55 && height < 80, `${model}: height ${height}`)
    assert.ok(box.min.y >= -1, `${model}: sunk into the floor at ${box.min.y}`)
    assert.equal(rig.legs.length, 4)
    const geos = rig.legs.map((l) => (l.children[0] as THREE.Mesh).geometry)
    assert.ok(geos.every((gg) => gg === geos[0]), `${model}: limbs must share one geometry`)
    if (skin.accessory !== 'none') assert.ok(rig.headG.children.length >= 2, `${model}: accessory missing`)
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
