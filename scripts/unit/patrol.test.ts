// The boss's rounds (src/desk/patrol.ts) and the direct route they take (office-world.ts
// `directRoute`), played against a fake clock and a real Walker: when a round starts, where the
// boss stops, how long it stays, what sends it home early — and that the route is far shorter
// than the door corridor, threads between the furniture without touching any of it, never
// leaves the desk with nobody to scold, and never while a real prompt is waiting.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BOSS_LANES, BOSS_SLOT, GAP_LANES, HUB_J, OFFICE, WALK_BACK, advanceWalker, corridorRoute, directRoute, makeWalker, walkDirect, type Point } from '../../src/desk/office-world'
import { BACK, FIRST_DELAY, REST, SCOLD, SIDE, makePatrol, patrolGoal, scoldSpot, setPatrolMode, stepPatrol, type Patrol, type PatrolInput } from '../../src/desk/patrol'
import { touching } from './furniture'

const FRAME = 1000 / 60
const worker = (id: string, slot: number) => ({ id, seat: OFFICE.slots[slot].seat })
const at = (w: { i: number; j: number }): Point => ({ i: w.i, j: w.j })
const same = (a: Point, b: Point): boolean => Math.hypot(a.i - b.i, a.j - b.j) < 0.01

/**
 * One frame of what the studio does: ask the machine, walk the boss towards whatever it says
 * (the direct route, as DeskStudio does for the boss), advance the clock.
 */
function frame(p: Patrol, clock: { now: number }, walker: ReturnType<typeof makeWalker>, input: Omit<PatrolInput, 'now' | 'boss'> & { state?: PatrolInput['boss']['state']; said?: string }, rand: () => number = () => 0.5): void {
  stepPatrol(p, { now: clock.now, workers: input.workers, boss: { state: input.state ?? 'hiring', at: at(walker), said: input.said ?? '' } }, rand)
  walkDirect(walker, patrolGoal(p) ?? BOSS_SLOT.seat)
  advanceWalker(walker, FRAME / 1000)
  clock.now += FRAME
}

/** run frames until the phase changes (or `limit` ms pass), returning the ms it took */
function until(p: Patrol, clock: { now: number }, walker: ReturnType<typeof makeWalker>, input: Parameters<typeof frame>[3], phase: Patrol['phase'], limit: number, rand?: () => number): number {
  const t0 = clock.now
  while (p.phase !== phase && clock.now - t0 < limit) frame(p, clock, walker, input, rand)
  return clock.now - t0
}

// ---- the furniture, as the world actually places it: scripts/unit/furniture.ts ----------------
const length = (from: Point, path: Point[]): number => path.reduce((sum, q) => { const d = Math.hypot(q.i - from.i, q.j - from.j); from = q; return sum + d }, 0)
/** what the colleagues walk: the west corridor and the aisle behind the row (office-world.ts `walkTo`) */
const corridor = (from: Point, to: Point): number => length(from, corridorRoute(from, to))

test('with nobody working the boss never leaves its desk', () => {
  setPatrolMode('on')
  const p = makePatrol()
  const clock = { now: 1_000 }
  const walker = makeWalker(BOSS_SLOT.seat)
  for (let k = 0; k < 60 * 60 * 10; k++) frame(p, clock, walker, { workers: [] }, Math.random) // ten minutes
  assert.equal(p.phase, 'idle')
  assert.deepEqual(at(walker), BOSS_SLOT.seat)
  assert.equal(patrolGoal(p), null)
})

test('a round: up after the first delay, beside the colleague (never on the chair), a few seconds over it, back, then a long rest', () => {
  setPatrolMode('on')
  const p = makePatrol()
  const clock = { now: 5_000 }
  const walker = makeWalker(BOSS_SLOT.seat)
  const staff = [worker('a', 1), worker('b', 2), worker('c', 3)]
  // the first delay is measured from the first frame with somebody to scold
  const armed = until(p, clock, walker, { workers: staff }, 'going', FIRST_DELAY[1] + 1_000)
  assert.equal(p.phase, 'going', 'the boss should have got up')
  assert.ok(armed >= FIRST_DELAY[0] - FRAME && armed <= FIRST_DELAY[1] + FRAME, `first round after ${armed}ms, wanted ${FIRST_DELAY.join('–')}`)
  // a fixed die of 0.5 picks the middle colleague
  assert.equal(p.target, 'b')
  const spot = p.spot!
  assert.deepEqual(spot, scoldSpot(staff[1].seat))
  assert.ok(Math.abs(staff[1].seat.j - spot.j - BACK) < 1e-9 && BACK > 0 && BACK < 1, 'a shade behind the chair, in its own row')
  assert.ok(Math.abs(staff[1].seat.i - spot.i - SIDE) < 1e-9 && SIDE > 0.5, 'beside the chair, not on it')
  assert.ok(spot.j > HUB_J && spot.j - HUB_J < 0.5, 'a first-row spot is one short step off the walkway every route turns on')
  // it walks there and stops on the spot
  const walked = until(p, clock, walker, { workers: staff }, 'scolding', 20_000)
  assert.equal(p.phase, 'scolding')
  assert.ok(same(at(walker), spot), `stopped at ${walker.i},${walker.j} instead of the spot`)
  assert.ok(walked > 1_000 && walked < 4_000, `the walk took ${walked}ms`)
  // the telling-off lasts a few seconds, during which the boss does not move
  const t0 = clock.now
  while (p.phase === 'scolding' && clock.now - t0 < SCOLD[1] + 1_000) {
    assert.ok(same(at(walker), spot), 'the boss wandered off mid-sentence')
    frame(p, clock, walker, { workers: staff })
  }
  const scolded = clock.now - t0
  assert.equal(p.phase, 'returning')
  assert.ok(scolded >= SCOLD[0] - FRAME && scolded <= SCOLD[1] + FRAME, `scolded for ${scolded}ms, wanted ${SCOLD.join('–')}`)
  assert.equal(p.target, null)
  assert.equal(patrolGoal(p), null, 'on the way back the goal is the desk again')
  // and it sits back down, after which the next round is a long way off
  until(p, clock, walker, { workers: staff }, 'idle', 20_000)
  assert.equal(p.phase, 'idle')
  assert.ok(same(at(walker), BOSS_SLOT.seat), 'the boss did not get back to its desk')
  const rest = p.at - clock.now
  assert.ok(rest >= REST[0] - 2 * FRAME && rest <= REST[1], `next round in ${rest}ms, wanted ${REST.join('–')}`)
})

test('the direct route is a fraction of the corridor, and the round never touches a desk, a chair, a plant or a fixture — whichever colleague it visits', () => {
  setPatrolMode('hurry')
  try {
    for (let slot = 1; slot < OFFICE.slots.length; slot++) {
      const spot = scoldSpot(OFFICE.slots[slot].seat)
      assert.equal(touching(spot), undefined, `slot ${slot}: the spot itself is in the ${touching(spot)?.what}`)
      const direct = length(BOSS_SLOT.seat, directRoute(BOSS_SLOT.seat, spot))
      const old = corridor(BOSS_SLOT.seat, spot)
      assert.ok(direct < old, `slot ${slot}: the direct route (${direct}) is no shorter than the corridor (${old})`)
      // the seats handed out first (nearest the boss, the first row's middle two) are the ones that matter
      if (slot <= 2) assert.ok(direct <= old * 0.4, `slot ${slot}: the direct route (${direct.toFixed(2)}) should be well under half the corridor (${old.toFixed(2)})`)
      const back = length(spot, directRoute(spot, BOSS_SLOT.seat))
      assert.ok(Math.abs(back - direct) < 1e-9, `slot ${slot}: the way back (${back}) differs from the way there (${direct})`)

      const p = makePatrol()
      const clock = { now: 0 }
      const walker = makeWalker(BOSS_SLOT.seat)
      const staff = [worker('x', slot)]
      for (let k = 0; k < 60 * 40 && !(p.phase === 'idle' && p.at > clock.now && clock.now > 5_000); k++) {
        frame(p, clock, walker, { workers: staff })
        const hit = touching(at(walker))
        assert.equal(hit, undefined, `slot ${slot}: the boss walked into ${hit?.what} at ${walker.i.toFixed(2)},${walker.j.toFixed(2)}`)
      }
      assert.ok(same(at(walker), BOSS_SLOT.seat), `slot ${slot}: the boss never made it back`)
    }
  } finally {
    setPatrolMode('on')
  }
})

test('the lanes themselves are clear, and a route cut short mid-lane turns round instead of looping', () => {
  for (const lane of [...BOSS_LANES, ...GAP_LANES]) {
    for (let j = lane === BOSS_LANES[0] || lane === BOSS_LANES[1] ? 1.25 : HUB_J; j <= (lane === BOSS_LANES[0] || lane === BOSS_LANES[1] ? HUB_J : OFFICE.D - 1.5); j += 0.05) {
      const hit = touching({ i: lane, j })
      assert.equal(hit, undefined, `lane ${lane} runs into ${hit?.what} at j ${j.toFixed(2)}`)
    }
  }
  // the seat row from the chair out to either lane, and the hub across the whole room
  for (let i = BOSS_LANES[0]; i <= BOSS_LANES[1]; i += 0.05) assert.equal(touching({ i, j: BOSS_SLOT.seat.j }), undefined, `the seat row is blocked at i ${i.toFixed(2)}`)
  for (let i = GAP_LANES[0]; i <= GAP_LANES[GAP_LANES.length - 1]; i += 0.05) assert.equal(touching({ i, j: HUB_J }), undefined, `the hub is blocked at i ${i.toFixed(2)}`)

  // half way down the lane, sent home: straight back up it, no detour via the hub
  const lane = BOSS_LANES[0]
  const midLane = { i: lane, j: (BOSS_SLOT.seat.j + HUB_J) / 2 }
  assert.deepEqual(directRoute(midLane, BOSS_SLOT.seat), [{ i: lane, j: BOSS_SLOT.seat.j }, { ...BOSS_SLOT.seat }])
  // still on the seat row, sent home: straight back along it
  assert.deepEqual(directRoute({ i: BOSS_SLOT.seat.i - 1, j: BOSS_SLOT.seat.j }, BOSS_SLOT.seat), [{ ...BOSS_SLOT.seat }])
  // from a deeper row's spot: back onto the row's walkway, along it to the gap, up the gap, along
  // the hub, up past the plant, along the seat row
  const deep = scoldSpot(OFFICE.slots[OFFICE.slots.length - 1].seat)
  const home = directRoute(deep, BOSS_SLOT.seat)
  assert.equal(home[home.length - 1].i, BOSS_SLOT.seat.i)
  assert.deepEqual(home[0], { i: deep.i, j: deep.j + BACK - WALK_BACK }, 'the first step is straight back onto the walkway')
  assert.ok(home.some((q) => Math.abs(q.j - HUB_J) < 1e-9), 'the way home passes the hub')
  assert.ok(home.every((q, k) => k === 0 || q.i === home[k - 1].i || q.j === home[k - 1].j), 'every leg runs along a lane')
  // and from a first-row spot the walkway *is* the hub
  const near = scoldSpot(OFFICE.slots[1].seat)
  assert.deepEqual(directRoute(near, BOSS_SLOT.seat)[0], { i: near.i, j: HUB_J })
  assert.deepEqual(directRoute(BOSS_SLOT.seat, BOSS_SLOT.seat), [])
})

test('the die picks any colleague', () => {
  setPatrolMode('on')
  const staff = [worker('a', 1), worker('b', 2), worker('c', 3)]
  const pick = (die: number): string | null => {
    const p = makePatrol()
    const clock = { now: 0 }
    const walker = makeWalker(BOSS_SLOT.seat)
    until(p, clock, walker, { workers: staff }, 'going', FIRST_DELAY[1] + 1_000, () => die)
    return p.target
  }
  assert.equal(pick(0), 'a')
  assert.equal(pick(0.5), 'b')
  assert.equal(pick(0.999), 'c')
})

test('a real prompt, a real sentence, or the colleague leaving sends the boss straight back', () => {
  setPatrolMode('on')
  const staff = [worker('a', 1), worker('b', 2)]
  const start = (): { p: Patrol; clock: { now: number }; walker: ReturnType<typeof makeWalker> } => {
    const p = makePatrol()
    const clock = { now: 0 }
    const walker = makeWalker(BOSS_SLOT.seat)
    until(p, clock, walker, { workers: staff, said: 'main:1' }, 'going', FIRST_DELAY[1] + 1_000)
    assert.equal(p.phase, 'going')
    for (let k = 0; k < 20; k++) frame(p, clock, walker, { workers: staff, said: 'main:1' }) // a third of a second along the way
    return { p, clock, walker }
  }
  // waiting for permission mid-walk: the '!' belongs at the desk, not in an aisle
  {
    const { p, clock, walker } = start()
    frame(p, clock, walker, { workers: staff, state: 'waiting', said: 'main:1' })
    assert.equal(p.phase, 'returning')
    until(p, clock, walker, { workers: staff, state: 'waiting', said: 'main:1' }, 'idle', 20_000)
    assert.ok(same(at(walker), BOSS_SLOT.seat))
    // and no new round starts while it is still waiting
    for (let k = 0; k < 60 * 60 * 3; k++) frame(p, clock, walker, { workers: staff, state: 'waiting', said: 'main:1' })
    assert.equal(p.phase, 'idle')
  }
  // a new sentence from the assistant
  {
    const { p, clock, walker } = start()
    frame(p, clock, walker, { workers: staff, said: 'main:2' })
    assert.equal(p.phase, 'returning')
  }
  // the colleague it was going to see went home
  {
    const { p, clock, walker } = start()
    const gone = staff.filter((w) => w.id !== p.target)
    frame(p, clock, walker, { workers: gone, said: 'main:1' })
    assert.equal(p.phase, 'returning')
  }
  // ...but a different colleague leaving changes nothing
  {
    const { p, clock, walker } = start()
    const others = staff.filter((w) => w.id === p.target)
    frame(p, clock, walker, { workers: others, said: 'main:1' })
    assert.equal(p.phase, 'going')
  }
  // mid-sentence too
  {
    const { p, clock, walker } = start()
    until(p, clock, walker, { workers: staff, said: 'main:1' }, 'scolding', 20_000)
    assert.equal(p.phase, 'scolding')
    frame(p, clock, walker, { workers: staff, state: 'waiting', said: 'main:1' })
    assert.equal(p.phase, 'returning')
  }
})

test('the first delay starts over once the office empties, and `off` parks the boss', () => {
  setPatrolMode('on')
  const p = makePatrol()
  const clock = { now: 0 }
  const walker = makeWalker(BOSS_SLOT.seat)
  const staff = [worker('a', 1)]
  for (let k = 0; k < 60 * 5; k++) frame(p, clock, walker, { workers: staff }) // five seconds with a colleague
  const armedAt = p.at
  assert.ok(armedAt > 0)
  for (let k = 0; k < 60; k++) frame(p, clock, walker, { workers: [] }) // everybody left
  assert.equal(p.at, 0, 'the timer should be disarmed with nobody to scold')
  for (let k = 0; k < 2; k++) frame(p, clock, walker, { workers: staff }) // somebody new sits down
  assert.ok(p.at >= clock.now + FIRST_DELAY[0] - 3 * FRAME, 're-armed with the full first delay')
  assert.notEqual(p.at, armedAt)

  setPatrolMode('off')
  try {
    const q = makePatrol()
    const c2 = { now: 0 }
    const w2 = makeWalker(BOSS_SLOT.seat)
    for (let k = 0; k < 60 * 60 * 3; k++) frame(q, c2, w2, { workers: staff })
    assert.equal(q.phase, 'idle')
    assert.deepEqual(at(w2), BOSS_SLOT.seat)
  } finally {
    setPatrolMode('on')
  }
})

test('`hurry` gets up the moment somebody sits down, on fixed dice, and rests only seconds', () => {
  setPatrolMode('hurry')
  try {
    const p = makePatrol()
    const clock = { now: 0 }
    const walker = makeWalker(BOSS_SLOT.seat)
    const staff = [worker('a', 1), worker('b', 2), worker('c', 3)]
    const up = until(p, clock, walker, { workers: staff }, 'going', 5_000, Math.random)
    assert.ok(up < 5 * FRAME, `hurry took ${up}ms to get up`)
    assert.equal(p.target, 'b')
    until(p, clock, walker, { workers: staff }, 'scolding', 20_000, Math.random)
    const scolded = until(p, clock, walker, { workers: staff }, 'returning', 10_000, Math.random)
    assert.ok(Math.abs(scolded - 3_000) < 2 * FRAME, `hurry scolds for ${scolded}ms`)
    until(p, clock, walker, { workers: staff }, 'idle', 20_000, Math.random)
    assert.ok(p.at - clock.now <= 6_000 && p.at - clock.now > 5_000, `hurry rests ${p.at - clock.now}ms`)
  } finally {
    setPatrolMode('on')
  }
})
