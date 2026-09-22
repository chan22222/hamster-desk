// The boss's rounds. Every so often, while at least one colleague is seated and working, the
// main hamster gets up, walks over to one of them, stands over it for a few seconds and walks
// back to its desk. The telling-off is all pantomime — an anger mark over the boss, a sweat mark
// and a flinch on the colleague; nothing is said — and it is a joke for whoever is watching the
// office, nothing more: this module never touches the store — no hamster state, no feed row, no
// log line — the studio's render loop asks it what the boss is up to this frame and poses the
// rigs to match. The boss keeps its seat throughout (`reconcileSeats` is not involved); only its
// walker leaves the chair, and it walks the direct lanes (`walkDirect`), not the door corridor.
//
// Pure, like office-world.ts: no three, no DOM, the clock and the dice are inputs, so the unit
// test can play a whole afternoon of rounds in a millisecond.
import { BOSS_SLOT, type Point } from './office-world'
import type { HamsterState } from '../store'

export type PatrolPhase = 'idle' | 'going' | 'scolding' | 'returning'

export interface Patrol {
  phase: PatrolPhase
  /** the colleague being visited, while going or scolding */
  target: string | null
  /** where the boss stands to do it: beside the colleague's chair, never on it */
  spot: Point | null
  /** idle: when the next round may start (0 = not armed yet); scolding: when it ends */
  at: number
  /** the boss's newest real sentence when the round began; a newer one cuts the round short */
  said: string
}

export interface PatrolInput {
  now: number
  /** colleagues that are seated and working — who the boss can pick on */
  workers: { id: string; seat: Point }[]
  boss: {
    state: HamsterState
    /** where the boss's walker is this frame */
    at: Point
    /** the id of the boss's newest real `say` row ('' when there is none) */
    said: string
  }
}

/** ms ranges; the first round comes sooner so whoever just watched a colleague sit down sees it */
export const FIRST_DELAY: readonly [number, number] = [12_000, 25_000]
export const REST: readonly [number, number] = [45_000, 120_000]
export const SCOLD: readonly [number, number] = [2_200, 4_000]

/**
 * Where the boss stops, in tiles from the colleague's chair: a tile to the west and a fifth of a
 * tile behind it. Beside, a shade over the shoulder — how a boss looms — and, seen from the
 * south-east camera, level with the colleague rather than behind it: any further back and the
 * boss's head rises into the band where the colleague's own feed rows hang, which hid the
 * telling-off. The walkway the boss arrives by runs `WALK_BACK` behind the chairs; the last
 * half-tile down to this spot is the one leg that leaves it.
 */
export const SIDE = 1.0
export const BACK = 0.2

/**
 * `off` parks the boss (a capture script that wants a still office), `hurry` makes the first
 * round start the moment a colleague sits down, keeps the rest short and fixes the dice, so a
 * blind capture run can photograph the walk and the telling-off at known delays. Neither exists
 * for a user: the app runs `on`, and the switches are reached only through the debug plumbing.
 */
export type PatrolMode = 'on' | 'off' | 'hurry'
let mode: PatrolMode = 'on'
export function setPatrolMode(m: PatrolMode): void {
  mode = m
}
export function patrolMode(): PatrolMode {
  return mode
}

export function makePatrol(): Patrol {
  return { phase: 'idle', target: null, spot: null, at: 0, said: '' }
}

/** Where to stand to scold the hamster sitting at `seat`: beside and a little behind its chair. */
export function scoldSpot(seat: Point): Point {
  return { i: seat.i - SIDE, j: seat.j - BACK }
}

/** The boss's walking goal this frame, or null when it belongs at its desk. */
export function patrolGoal(p: Patrol): Point | null {
  return p.phase === 'going' || p.phase === 'scolding' ? p.spot : null
}

const near = (a: Point, b: Point): boolean => Math.hypot(a.i - b.i, a.j - b.j) < 0.01

const span = ([lo, hi]: readonly [number, number], rand: () => number): number => lo + (hi - lo) * rand()

/** Whatever must send the boss straight back, mid-walk or mid-sentence. */
function cutShort(p: Patrol, input: PatrolInput): boolean {
  const { boss, workers } = input
  if (mode === 'off') return true
  // a real prompt (permission, question) must not hide behind a joke
  if (boss.state === 'waiting') return true
  // the boss actually said something: that bubble belongs at the desk, in the frame the user expects
  if (boss.said !== p.said) return true
  // the colleague went home (or stopped working) before the boss got there
  return !workers.some((w) => w.id === p.target)
}

function goBack(p: Patrol): void {
  p.phase = 'returning'
  p.target = null
  p.spot = null
}

/**
 * Advance the machine one frame. `rand` is only read when a round starts or ends (who to pick
 * on, how long for), so a fixed die gives a fully predictable round — what `hurry` relies on.
 */
export function stepPatrol(p: Patrol, input: PatrolInput, rand: () => number = Math.random): void {
  const { now, boss, workers } = input
  const dice = mode === 'hurry' ? () => 0.5 : rand
  switch (p.phase) {
    case 'idle': {
      // nobody to scold, or the boss is not free: disarm, so the next colleague to sit down gets
      // the short first delay again rather than the tail of an old one
      const free = boss.state !== 'waiting' && boss.state !== 'arriving' && boss.state !== 'leaving'
      if (mode === 'off' || workers.length === 0 || !free) {
        p.at = 0
        return
      }
      if (!p.at) {
        p.at = mode === 'hurry' ? now : now + span(FIRST_DELAY, dice)
        return
      }
      if (now < p.at) return
      // still walking in (a fresh session)? wait at the door rather than scold from it
      if (!near(boss.at, BOSS_SLOT.seat)) return
      const w = workers[Math.min(workers.length - 1, Math.floor(dice() * workers.length))]
      p.phase = 'going'
      p.target = w.id
      p.spot = scoldSpot(w.seat)
      p.said = boss.said
      return
    }
    case 'going': {
      if (cutShort(p, input)) return goBack(p)
      if (p.spot && near(boss.at, p.spot)) {
        p.phase = 'scolding'
        p.at = now + (mode === 'hurry' ? 3_000 : span(SCOLD, dice))
      }
      return
    }
    case 'scolding': {
      if (cutShort(p, input) || now >= p.at) goBack(p)
      return
    }
    case 'returning': {
      if (near(boss.at, BOSS_SLOT.seat)) {
        p.phase = 'idle'
        p.at = now + (mode === 'hurry' ? 6_000 : span(REST, dice))
      }
      return
    }
  }
}
