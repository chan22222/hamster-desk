// src/layout.ts: how big the studio gets against the window. The saved size is a wish; the terminal
// keeps its minimum. It used not to: the defaults alone took the whole column of a 760px window.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dragRange, SPLITTER, STUDIO_FLOOR, STUDIO_H, STUDIO_W, studioRoom, studioSize, TERM_MIN } from '../../src/layout'

test('studioRoom: what the column leaves once the splitter and the terminal minimum are taken; unmeasured is unlimited', () => {
  assert.equal(studioRoom('w', 1000), 1000 - SPLITTER - TERM_MIN.w)
  assert.equal(studioRoom('h', 800), 800 - SPLITTER - TERM_MIN.h)
  assert.equal(studioRoom('w', 0), Infinity, 'the first frame, before the column has been measured, clamps nothing')
})

test('studioSize: the saved size while it fits, the room when it does not, never under the floor', () => {
  // a wide window: the wish stands
  assert.equal(studioSize('w', 520, 1600), 520)
  // 760px window, sidebar 248, splitter: the column is 512 — the terminal keeps 360, the studio gets the floor
  assert.equal(studioSize('w', 520, 512), STUDIO_FLOOR.w)
  // a 1024px window without the sidebar: the studio gives up what the terminal needs
  assert.equal(studioSize('w', 900, 1024), 1024 - SPLITTER - TERM_MIN.w)
  // above the terminal: same rule, downwards
  assert.equal(studioSize('h', 420, 1000), 420)
  assert.equal(studioSize('h', 700, 600), 600 - SPLITTER - TERM_MIN.h)
  assert.equal(studioSize('h', 420, 200), STUDIO_FLOOR.h)
  assert.equal(studioSize('h', 420, 0), 420, 'unmeasured: the saved size')
})

test('studioSize never takes the terminal under its minimum while the floor allows', () => {
  for (const col of [700, 800, 1000, 1400, 2000]) {
    for (const saved of [STUDIO_W.min, STUDIO_W.def, STUDIO_W.max]) {
      const w = studioSize('w', saved, col)
      if (w > STUDIO_FLOOR.w) assert.ok(col - SPLITTER - w >= TERM_MIN.w, `col ${col}, saved ${saved}: terminal ${col - SPLITTER - w}`)
    }
  }
})

test('dragRange: the splitter stops where the terminal would go under its minimum', () => {
  assert.deepEqual(dragRange('w', 2000), { lo: STUDIO_W.min, hi: STUDIO_W.max })
  assert.deepEqual(dragRange('w', 1000), { lo: STUDIO_W.min, hi: 1000 - SPLITTER - TERM_MIN.w })
  // less room than the usual minimum: the range shrinks to what there is, never inverted
  const tight = dragRange('w', 600)
  assert.deepEqual(tight, { lo: 600 - SPLITTER - TERM_MIN.w, hi: 600 - SPLITTER - TERM_MIN.w })
  // less room than even the floor: the floor
  assert.deepEqual(dragRange('w', 500), { lo: STUDIO_FLOOR.w, hi: STUDIO_FLOOR.w })
  assert.deepEqual(dragRange('h', 0), { lo: STUDIO_H.min, hi: STUDIO_H.max }, 'unmeasured: the usual range')
})
