// The sidebar's two long lists (src/log): which rows of a windowed list are rendered for a view
// (src/log/window.ts), the changed-files rows the sidebar works out once per edit and shares
// between its count and its list (src/log/changed.ts), and the diffs kept for a file row that is
// scrolled out of the window and back (src/git/diff-cache.ts).
import './dom-shim'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rowSpan, typicalHeight } from '../../src/log/window'
import { changedFiles } from '../../src/log/changed'
import { DIFF_FRESH_MS, DiffCache, diffKey, isFresh } from '../../src/git/diff-cache'
import type { GitDiff } from '../../shared/events'
import type { EditEntry } from '../../src/store'

const sum = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0)

/** the padding stands in for exactly the rows that are not rendered, whatever the view */
function assertSpan(hs: number[], top: number, bottom: number, keep = -1): ReturnType<typeof rowSpan> {
  const s = rowSpan(hs, top, bottom, keep)
  assert.equal(s.before, sum(hs.slice(0, s.start)), `before, view ${top}..${bottom}`)
  assert.equal(s.after, sum(hs.slice(s.end)), `after, view ${top}..${bottom}`)
  assert.ok(s.start <= s.end && s.end <= hs.length)
  return s
}

test('a full log renders the rows in view, not all 500', () => {
  const hs = Array.from({ length: 500 }, () => 26)
  // at the top: 0..200px is rows 0..7 (the eighth ends at 208)
  const top = assertSpan(hs, 0, 200)
  assert.deepEqual([top.start, top.end], [0, 8])
  // scrolled halfway: the rows that cross the view's edges are in, the ones past them are not
  const mid = assertSpan(hs, 6500, 6700)
  assert.deepEqual([mid.start, mid.end], [250, 258])
  assert.equal(mid.before, 6500)
  // a row that ends exactly where the view begins is not in view
  assert.equal(rowSpan(hs, 26, 52).start, 1)
})

test('an opened row is as tall as it was measured, and moves the rows after it', () => {
  const hs = Array.from({ length: 100 }, () => 26)
  hs[3] = 240
  const s = assertSpan(hs, 0, 300)
  // rows 0..2 (78px) + the open one (240px) already reach past 300
  assert.deepEqual([s.start, s.end], [0, 4])
  const below = assertSpan(hs, 318, 400)
  assert.equal(below.start, 4, 'the first row after the open one starts at 3*26 + 240')
})

test('a view past the end, or an empty list, still makes sense', () => {
  assert.deepEqual(rowSpan([], 0, 500), { start: 0, end: 0, before: 0, after: 0 })
  const hs = [26, 26, 26]
  const past = assertSpan(hs, 5000, 5400)
  assert.deepEqual([past.start, past.end], [2, 3], 'the last row stays, so there is one to measure')
  const none = assertSpan(hs, 10, 10)
  assert.equal(none.end - none.start, 1, 'a zero-height view still renders the row it sits on')
})

test('a row being scrolled to is rendered wherever the view is', () => {
  const hs = Array.from({ length: 500 }, () => 26)
  // the view at the top, the row asked for (End, a bubble clicked) at the bottom: the span reaches it
  const far = assertSpan(hs, 0, 200, 499)
  assert.deepEqual([far.start, far.end], [0, 500])
  // already in the span: nothing changes
  assert.deepEqual(rowSpan(hs, 0, 200, 3), rowSpan(hs, 0, 200))
  // above the view
  const up = assertSpan(hs, 6500, 6700, 10)
  assert.deepEqual([up.start, up.end], [10, 258])
  // a row that is not in the list (-1, or gone) keeps nothing
  assert.deepEqual(rowSpan(hs, 0, 200, 900), rowSpan(hs, 0, 200))
})

test('a row never measured counts as high as most rows are, not as the one opened last', () => {
  assert.equal(typicalHeight(new Map()), 26, 'before anything is measured: a one-line log row')
  // 40 closed rows and one opened: the opened one must not make 400 unseen rows 240px each
  assert.equal(typicalHeight(new Map([[26, 40], [240, 1]])), 26)
  // the changed files are mostly two-line rows, with the odd file at the root on one line
  assert.equal(typicalHeight(new Map([[29, 3], [45.5, 20]])), 45.5)
})

const edit = (n: number, file: string, who = 'main', whoName = '메인'): EditEntry => ({
  id: `tu${n}`,
  ts: 1000 + n,
  who,
  whoName,
  file,
  op: 'edit',
  added: 3,
  removed: 1,
  preview: null,
})

test('one row per file, newest first, with what was done to it', () => {
  const edits = [edit(1, 'C:/p/src/a.ts'), edit(2, 'C:/p/src/b.ts', 'ag1', '조수'), edit(3, 'C:/p/src/a.ts', 'ag1', '조수'), edit(4, 'README.md')]
  const files = changedFiles(edits, 'MAIN')
  assert.deepEqual(
    files.map((f) => [f.name, f.dir, f.count, f.added, f.removed, [...f.who].join(',')]),
    [
      ['README.md', '', 1, 3, 1, 'MAIN'],
      ['a.ts', 'C:/p/src', 2, 6, 2, 'MAIN,조수'],
      ['b.ts', 'C:/p/src', 1, 3, 1, '조수'],
    ],
  )
  // the row keeps the last edit itself, the very entry from the list (a row re-renders on it)
  assert.equal(files[1].last, edits[2])
})

test('a file whose edits are unchanged keeps its numbers and its last edit when another file is edited', () => {
  // what lets a memoized row skip rendering: equal numbers and the same `last` object
  const edits = Array.from({ length: 30 }, (_, i) => edit(i, `f${i % 6}.ts`))
  const before = new Map(changedFiles(edits, 'M').map((f) => [f.file, f]))
  const after = changedFiles([...edits, edit(30, 'f0.ts')], 'M')
  assert.equal(after[0].file, 'f0.ts', 'the file just edited goes to the top')
  for (const f of after.slice(1)) {
    const was = before.get(f.file)!
    assert.deepEqual([f.count, f.added, f.removed, f.last], [was.count, was.added, was.removed, was.last], f.file)
  }
})

const diff = (text: string, error: string | null = null): GitDiff => ({ text, truncated: false, untracked: false, error })

test('a diff read for one edit of a file is found again for that edit only', () => {
  const cache = new DiffCache()
  cache.set(diffKey('C:/p', 'src/a.ts', 'tu1'), diff('+a'), 1000)
  assert.equal(cache.get(diffKey('C:/p', 'src/a.ts', 'tu1'))?.diff.text, '+a', 'the row scrolled back: there at once')
  // the file was edited again: that is another key, and the diff read before it is not it
  assert.equal(cache.get(diffKey('C:/p', 'src/a.ts', 'tu2')), undefined)
  assert.equal(cache.get(diffKey('C:/p', 'src/b.ts', 'tu1')), undefined)
  assert.equal(cache.get(diffKey('C:/q', 'src/a.ts', 'tu1')), undefined)
})

test('a failed read is not kept, so the next open asks git again', () => {
  const cache = new DiffCache()
  cache.set('k', diff('', 'timeout'), 1000)
  assert.equal(cache.get('k'), undefined)
})

test('the cache keeps the diffs used last, and no more than it may', () => {
  const cache = new DiffCache(3)
  for (const k of ['a', 'b', 'c']) cache.set(k, diff(k), 0)
  cache.get('a') // used again: the youngest now
  cache.set('d', diff('d'), 0)
  assert.equal(cache.size, 3)
  assert.equal(cache.get('b'), undefined, 'the one used longest ago goes')
  assert.ok(cache.get('a') && cache.get('c') && cache.get('d'))
})

test('a diff is taken as it is only while it is young', () => {
  // a commit or a formatter between edits changes the tree without a new key
  const hit = { diff: diff('+a'), at: 1000 }
  assert.equal(isFresh(hit, 1000 + DIFF_FRESH_MS - 1), true)
  assert.equal(isFresh(hit, 1000 + DIFF_FRESH_MS), false)
})
