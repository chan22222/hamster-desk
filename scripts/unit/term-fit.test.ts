// src/term/fit.ts: the refit throttle a terminal pane runs on every ResizeObserver callback.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { throttleTrailing, type Clock } from '../../src/term/fit'

/** a clock that only moves when told to, firing whatever falls due on the way */
function fakeClock(): Clock & { advance(to: number): void } {
  let t = 0
  let seq = 0
  const due = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => t,
    later: (fn, ms) => {
      due.set(++seq, { at: t + ms, fn })
      return seq
    },
    cancel: (h) => void due.delete(h as number),
    advance(to) {
      for (;;) {
        const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > to) break
        due.delete(next[0])
        t = next[1].at
        next[1].fn()
      }
      t = to
    },
  }
}

test('a resize burst refits at most every 100 ms, and once more after its last change', () => {
  // the studio folding: the pane's height changes on every frame for half a second
  for (const frame of [16, 7, 33, 100, 101]) {
    const clock = fakeClock()
    const runs: number[] = []
    const fit = throttleTrailing(() => runs.push(clock.now()), 100, clock)
    let lastPoke = 0
    for (let t = 0; t <= 500; t += frame) {
      clock.advance(t)
      fit.poke()
      lastPoke = t
    }
    clock.advance(10_000)
    assert.ok(runs.length > 0)
    for (let i = 1; i < runs.length; i++) assert.ok(runs[i] - runs[i - 1] >= 100, `frame ${frame}: runs ${runs}`)
    // the size the pane settled on is measured after it settled
    assert.ok(runs[runs.length - 1] >= lastPoke, `frame ${frame}: last run ${runs[runs.length - 1]} < last change ${lastPoke}`)
  }
})

test('a lone change after a quiet spell refits straight away', () => {
  const clock = fakeClock()
  const runs: number[] = []
  const fit = throttleTrailing(() => runs.push(clock.now()), 100, clock)
  clock.advance(5000)
  fit.poke()
  clock.advance(5000)
  assert.deepEqual(runs, [5000])
  // and the next one waits out the rest of the 100 ms
  clock.advance(5040)
  fit.poke()
  clock.advance(10_000)
  assert.deepEqual(runs, [5000, 5100])
})

test('a pane that goes away takes its pending refit with it', () => {
  const clock = fakeClock()
  let runs = 0
  const fit = throttleTrailing(() => runs++, 100, clock)
  fit.poke()
  clock.advance(0)
  fit.poke() // pending: due at 100
  fit.cancel()
  clock.advance(1000)
  assert.equal(runs, 1)
})
