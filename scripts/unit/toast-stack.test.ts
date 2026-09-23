// The notification window's pure part (electron/toast-stack.ts): how many cards, for how long,
// what a hover does to the clocks, and where the window goes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CARD_GAP,
  CARD_HEIGHT,
  EDGE_MARGIN,
  SHADOW_PAD,
  TOAST_MAX,
  TOAST_WIDTH,
  TTL_MS,
  ToastStack,
  toastBounds,
  ttlFor,
} from '../../electron/toast-stack'
import { KIND_PATHS, kindOf } from '../../src/notify/kind'

/** a 1920×1080 screen with the Windows taskbar along the bottom */
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 }

const req = (tag: 'permission' | 'question' | 'turn', title: string = tag) => ({ title, body: 'b', tag, tab: 'ws:1' })

test('a question or permission request stays longer than a finished turn', () => {
  assert.ok(ttlFor('question') > ttlFor('turn'))
  assert.equal(ttlFor('permission'), ttlFor('question'))
  assert.equal(ttlFor('turn'), TTL_MS.turn)
})

test('every tag is a kind of its own, with a lifetime and an icon', () => {
  // permission and question used to share one amber card; the page and the banner tell them apart
  // through kindOf (src/notify/kind.ts), and a tag added to the stack must land somewhere there too
  const tags = Object.keys(TTL_MS) as (keyof typeof TTL_MS)[]
  assert.deepEqual(new Set(tags.map(kindOf)), new Set(['permission', 'question', 'done']), 'three tags, three kinds')
  for (const tag of tags) {
    assert.ok(ttlFor(tag) > 0, `${tag} has a lifetime`)
    assert.ok(KIND_PATHS[kindOf(tag)].length > 0, `${tag} has an icon`)
  }
})

test('the stack keeps the newest three, oldest first', () => {
  const s = new ToastStack()
  for (let i = 1; i <= TOAST_MAX; i++) s.push(req('turn', `t${i}`), 0)
  assert.deepEqual(
    s.items().map((i) => i.title),
    ['t1', 't2', 't3'],
  )
  const { item, dropped } = s.push(req('turn', 't4'), 0)
  assert.equal(item.title, 't4')
  assert.deepEqual(
    dropped.map((d) => d.title),
    ['t1'],
    'the oldest one made room',
  )
  assert.deepEqual(
    s.items().map((i) => i.title),
    ['t2', 't3', 't4'],
  )
  assert.ok(new Set(s.items().map((i) => i.id)).size === 3, 'ids are unique')
})

test('cards expire on their own clock, in order', () => {
  const s = new ToastStack()
  s.push(req('turn'), 1000) // gone at 9000
  s.push(req('question'), 2000) // gone at 17000
  assert.equal(s.nextDeadline(), 1000 + TTL_MS.turn)
  assert.deepEqual(s.expire(8999), [])
  assert.deepEqual(
    s.expire(9000).map((i) => i.tag),
    ['turn'],
  )
  assert.equal(s.size, 1)
  assert.equal(s.nextDeadline(), 2000 + TTL_MS.question)
  assert.deepEqual(
    s.expire(20000).map((i) => i.tag),
    ['question'],
  )
  assert.equal(s.nextDeadline(), null, 'nothing left to wait for')
})

test('a hover stops the clocks and gives the time back', () => {
  const s = new ToastStack()
  s.push(req('turn'), 0) // would go at 8000
  s.pause(5000)
  assert.equal(s.nextDeadline(), null, 'no timer while paused')
  assert.deepEqual(s.expire(30000), [], 'nothing expires under the pointer')
  s.resume(25000) // paused for 20 s
  assert.equal(s.nextDeadline(), 8000 + 20000)
  assert.deepEqual(s.expire(27999), [])
  assert.equal(s.expire(28000).length, 1)
})

test('a card pushed during a hover gets its whole time once the pointer leaves', () => {
  const s = new ToastStack()
  s.pause(1000)
  s.push(req('turn'), 4000)
  s.resume(6000)
  assert.equal(s.nextDeadline(), 6000 + TTL_MS.turn)
})

test('remove and clear take cards out by id', () => {
  const s = new ToastStack()
  const a = s.push(req('turn', 'a'), 0).item
  s.push(req('turn', 'b'), 0)
  assert.equal(s.remove(a.id)?.title, 'a')
  assert.equal(s.remove(a.id), null, 'already gone')
  assert.deepEqual(
    s.items().map((i) => i.title),
    ['b'],
  )
  assert.equal(s.clear().length, 1)
  assert.equal(s.size, 0)
})

test('the window sits in the bottom-right corner of the work area, cards 16px from the edges', () => {
  const one = toastBounds(1, WORK_AREA)
  assert.equal(one.width, TOAST_WIDTH + 2 * SHADOW_PAD)
  assert.equal(one.height, CARD_HEIGHT + 2 * SHADOW_PAD)
  // the cards' right/bottom edge — inside the shadow ring — is EDGE_MARGIN from the work area's
  assert.equal(one.x + one.width - SHADOW_PAD, WORK_AREA.width - EDGE_MARGIN)
  assert.equal(one.y + one.height - SHADOW_PAD, WORK_AREA.height - EDGE_MARGIN)
  const three = toastBounds(3, WORK_AREA)
  assert.equal(three.height, 3 * CARD_HEIGHT + 2 * CARD_GAP + 2 * SHADOW_PAD)
  assert.equal(three.y + three.height, one.y + one.height, 'anchored at the bottom: it grows upward')
  assert.equal(three.x, one.x)
  // a secondary-monitor-shaped work area: offsets carry through
  const off = toastBounds(1, { x: 1920, y: 200, width: 1280, height: 680 })
  assert.equal(off.x + off.width - SHADOW_PAD, 1920 + 1280 - EDGE_MARGIN)
  assert.equal(off.y + off.height - SHADOW_PAD, 200 + 680 - EDGE_MARGIN)
})

test('the count is clamped to what the stack can hold', () => {
  assert.deepEqual(toastBounds(0, WORK_AREA), toastBounds(1, WORK_AREA))
  assert.deepEqual(toastBounds(9, WORK_AREA), toastBounds(TOAST_MAX, WORK_AREA))
})

test('the stack moves up above a window that owns the corner (mini mode)', () => {
  // the mini window: 480×360, 12px from the corner (electron/window-state.ts)
  const mini = { x: 1920 - 480 - 12, y: 1040 - 360 - 12, width: 480, height: 360 }
  const b = toastBounds(2, WORK_AREA, mini)
  assert.equal(b.y + b.height - SHADOW_PAD, mini.y - CARD_GAP, 'its cards end one gap above the mini window')
  assert.equal(b.x, toastBounds(2, WORK_AREA).x, 'same column')
  // a window elsewhere is not in the way
  assert.deepEqual(toastBounds(2, WORK_AREA, { x: 0, y: 0, width: 800, height: 600 }), toastBounds(2, WORK_AREA))
})
