// The furniture on the office floor, in tiles, as the world really places it (vox/world.ts
// `FIXTURES` and `PLANTS`, the desks and chairs from office-world.ts, the sizes from vox/props.ts)
// — what every walking test checks its routes against: the boss's rounds (patrol.test.ts), the
// corridor and the queue (walk.test.ts). A hamster is a box `HALF` a tile either side of where it
// stands; `touching` says what it would walk into there.

import { OFFICE, T, type Point } from '../../src/desk/office-world'
import { BOSS_DESK_W, DESK_D, DESK_W } from '../../src/desk/vox/props'
import { FIXTURES, PLANTS } from '../../src/desk/vox/world'

export type Box = { i0: number; i1: number; j0: number; j1: number; what: string }
const box = (ci: number, cj: number, hw: number, hd: number, what: string, back = hd): Box => ({ i0: ci - hw, i1: ci + hw, j0: cj - back, j1: cj + hd, what })

/** the fixtures' footprints, half a side each way (props.ts), in world units */
const FOOT: Record<(typeof FIXTURES)[number]['id'], [number, number]> = { cooler: [13, 12], coffee: [21, 17], printer: [17, 15] }

export const FURNITURE: Box[] = [
  // desks are centred half a tile east of their slot and on the slot's row
  ...OFFICE.slots.map((s, k) => box(s.i + 0.5, s.j, (k === 0 ? BOSS_DESK_W : DESK_W) / 2 / T, DESK_D / 2 / T, `desk ${k}`)),
  // the colleagues' chairs: 26 wide, and the back reaches 16 behind the seat point (the boss's
  // own chair is where it starts and ends, so it is no obstacle)
  ...OFFICE.slots.slice(1).map((s, k) => box(s.chair.i, s.chair.j, 13 / T, 13 / T, `chair ${k + 1}`, 16 / T)),
  // plants (27 wide)
  ...PLANTS.map((p) => box(p.i, p.j, 13.5 / T, 13.5 / T, `plant at ${p.i},${p.j}`)),
  ...FIXTURES.map((f) => box(f.i, f.j, FOOT[f.id][0] / T, FOOT[f.id][1] / T, f.id)),
]

/** half the hamster's footprint (its torso is 28 × 22) */
export const HALF = 0.2

export const touching = (p: Point, list: readonly Box[] = FURNITURE): Box | undefined =>
  list.find((b) => p.i + HALF > b.i0 && p.i - HALF < b.i1 && p.j + HALF > b.j0 && p.j - HALF < b.j1)
