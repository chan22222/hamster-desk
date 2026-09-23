// src/widgets/focus.ts: where a key sends the focus. The DOM half (which elements, `.focus()`) needs a
// window; the arithmetic under it — wrap in a menu and the tab strip, stop in a list under a search
// box, go round in a trapped panel — is here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listStep, tabStep, wrapStep } from '../../src/widgets/focus'

test('wrapStep: ↑ ↓ go round a menu, Home End go to its ends, other keys are not moves', () => {
  assert.equal(wrapStep('ArrowDown', 0, 3), 1)
  assert.equal(wrapStep('ArrowDown', 2, 3), 0, 'past the last row: the first')
  assert.equal(wrapStep('ArrowUp', 0, 3), 2, 'before the first row: the last')
  assert.equal(wrapStep('Home', 2, 3), 0)
  assert.equal(wrapStep('End', 0, 3), 2)
  assert.equal(wrapStep('Enter', 1, 3), null)
  assert.equal(wrapStep('ArrowRight', 1, 3), null, 'a menu is vertical: → is not a move in it')
  assert.equal(wrapStep('ArrowDown', 0, 0), null, 'nothing to move to')
})

test('wrapStep from outside the list (-1): ↓ takes the first, ↑ the last', () => {
  assert.equal(wrapStep('ArrowDown', -1, 4), 0)
  assert.equal(wrapStep('ArrowUp', -1, 4), 3)
})

test('wrapStep on the tab strip is horizontal', () => {
  assert.equal(wrapStep('ArrowRight', 1, 3, 'h'), 2)
  assert.equal(wrapStep('ArrowLeft', 0, 3, 'h'), 2)
  assert.equal(wrapStep('ArrowDown', 0, 3, 'h'), null)
})

test('listStep: stops at the bottom, and ↑ off the first row is -1 (back to the search box)', () => {
  assert.equal(listStep('ArrowDown', 0, 3), 1)
  assert.equal(listStep('ArrowDown', 2, 3), 2)
  assert.equal(listStep('ArrowUp', 1, 3), 0)
  assert.equal(listStep('ArrowUp', 0, 3), -1)
  assert.equal(listStep('End', 0, 3), 2)
  assert.equal(listStep('Home', 2, 3), 0)
  assert.equal(listStep('Tab', 0, 3), null)
  assert.equal(listStep('ArrowDown', 0, 0), null)
})

test('tabStep: Tab and Shift+Tab go round, and start from an end when the focus is on none of the stops', () => {
  assert.equal(tabStep(false, 0, 3), 1)
  assert.equal(tabStep(false, 2, 3), 0)
  assert.equal(tabStep(true, 0, 3), 2)
  assert.equal(tabStep(true, 2, 3), 1)
  assert.equal(tabStep(false, -1, 3), 0)
  assert.equal(tabStep(true, -1, 3), 2)
})
