// How often the studio draws, and at which quality (src/desk/pace.ts): the whole table of rates,
// what a rate comes to on a real display's vsync clock, and when the picture drops to the cheaper
// tier and comes back.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FPS, QUALITY, SAVER_AFTER_MS, frameDue, frameRate, pixelRatio, qualityFor } from '../../src/desk/pace'

const rate = (focused: boolean, mini: boolean, lively: boolean, input: boolean): number => frameRate({ focused, mini, lively, input })

test('full rate for input and for motion, half at rest, less again behind other windows and in the mini window', () => {
  assert.equal(rate(true, false, true, false), FPS.lively)
  assert.equal(rate(true, false, false, false), FPS.calm)
  assert.equal(rate(false, false, true, false), FPS.backLively)
  assert.equal(rate(false, false, false, false), FPS.backCalm)
  assert.equal(rate(true, true, false, false), FPS.backCalm, 'the mini window counts as the background even with the focus')
  assert.equal(rate(true, true, true, false), FPS.backLively)
  // the user at the studio always gets the full rate: a drag must never stutter, not even in mini
  for (const focused of [true, false]) for (const mini of [true, false]) for (const lively of [true, false]) assert.equal(rate(focused, mini, lively, true), FPS.input)
  assert.ok(FPS.lively > FPS.calm && FPS.calm > FPS.backCalm && FPS.backLively >= FPS.backCalm)
})

/** how many frames a second a rate comes to on a display refreshing at `hz`, with ±1 ms of jitter on its clock */
function drawn(fps: number, hz: number): number {
  const vsync = 1000 / hz
  let last = 0
  let frames = 0
  for (let k = 1; k * vsync <= 10_000; k++) {
    const t = k * vsync + (k % 3 === 0 ? 1 : k % 3 === 1 ? -1 : 0)
    if (frameDue(t - last, fps)) {
      frames++
      last = t
    }
  }
  return frames / 10
}

test('on the display clock: 60 is every vsync of a 60 Hz screen, 30 every second, 20 every third — and never more than the screen', () => {
  assert.equal(Math.round(drawn(60, 60)), 60)
  assert.equal(Math.round(drawn(30, 60)), 30)
  assert.equal(Math.round(drawn(20, 60)), 20)
  // a fast screen is held down to about the rate asked for, not run at its own
  for (const hz of [120, 144, 165]) {
    const d60 = drawn(60, hz)
    const d30 = drawn(30, hz)
    assert.ok(d60 >= 55 && d60 <= 75, `60 fps on a ${hz} Hz screen drew ${d60}`)
    assert.ok(d30 >= 27 && d30 <= 37, `30 fps on a ${hz} Hz screen drew ${d30}`)
  }
  assert.ok(drawn(60, 30) <= 30, 'never more frames than the screen shows')
})

test('the cheaper picture comes on in the mini window at once, behind other windows only after a while, and goes at once', () => {
  assert.equal(qualityFor({ mini: false, unfocusedFor: 0 }), 'full')
  assert.equal(qualityFor({ mini: true, unfocusedFor: 0 }), 'saver')
  // a quick alt-tab and back is not worth reallocating the buffer and the shadow map twice
  assert.equal(qualityFor({ mini: false, unfocusedFor: SAVER_AFTER_MS - 1 }), 'full')
  assert.equal(qualityFor({ mini: false, unfocusedFor: SAVER_AFTER_MS }), 'saver')
})

test('each tier costs less than the one above it, and the pixel ratio never goes above the display', () => {
  assert.ok(QUALITY.saver.dpr < QUALITY.full.dpr)
  assert.ok(QUALITY.saver.shadow < QUALITY.full.shadow)
  assert.ok(QUALITY.saver.sea < QUALITY.full.sea)
  assert.ok(QUALITY.saver.bump <= QUALITY.full.bump)
  assert.equal(pixelRatio('full', 2), 1.5, 'a 200 % display is drawn at 1.5')
  assert.equal(pixelRatio('full', 1.25), 1.25)
  assert.equal(pixelRatio('full', 1), 1)
  assert.equal(pixelRatio('saver', 2), 1)
  assert.equal(pixelRatio('saver', 0.8), 0.8)
  assert.equal(pixelRatio('full', 0), 1, 'no ratio reported: 1')
})
