// electron/ui-store.ts must never be the reason settings are lost. The file also holds the list of
// accounts and the saved tabs, so "could not read it" and "there is none" are different answers.
//
// The first test has to be first: it needs the module before anything was loaded (cache === null).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'hd-uistore-'))
process.env.HAMSTER_HOME = HOME
const FILE = join(HOME, 'ui.json')

import { flushUi, loadUi, saveUi, setUiReadOnly } from '../../electron/ui-store'

const onDisk = (): Record<string, any> => JSON.parse(readFileSync(FILE, 'utf8'))
/** what another process — the installed app beside a dev run — does: it writes the whole file itself */
const otherProcessWrites = (state: unknown): void => writeFileSync(FILE, JSON.stringify(state))
const paths = (rows: unknown): string[] => (rows as { path: string }[]).map((r) => r.path)

test('a settings file that exists but cannot be read is never written over', () => {
  mkdirSync(FILE) // a folder of that name: every read fails, and not with "no such file"
  assert.deepEqual(saveUi({ window: { x: 1 } }), {}) // refused, rather than merged into nothing
  flushUi()
  assert.deepEqual(loadUi(), {})
  assert.ok(statSync(FILE).isDirectory()) // untouched
  assert.equal(existsSync(`${FILE}.tmp`), false)
  rmSync(FILE, { recursive: true })
})

test('no file at all is a first run: saving works and lands on disk', () => {
  assert.deepEqual(loadUi(), {})
  saveUi({ profiles: { list: [{ id: 'acc-2' }] }, prefs: { lang: 'ko' } })
  flushUi()
  assert.deepEqual(JSON.parse(readFileSync(FILE, 'utf8')).profiles, { list: [{ id: 'acc-2' }] })
})

test('a damaged file is set aside and the previous good one is used instead', () => {
  saveUi({ lastCwd: 'C:/work' }) // the second write: ui.bak.json now holds the first
  flushUi()
  writeFileSync(FILE, Buffer.alloc(64)) // what a power cut leaves behind: the right file, full of zeros
  const state = loadUi()
  assert.deepEqual(state.profiles, { list: [{ id: 'acc-2' }] }) // the accounts survived
  assert.ok(existsSync(join(HOME, 'ui.corrupt.json')))
})

test('a damaged file with no backup still starts clean instead of throwing', () => {
  rmSync(join(HOME, 'ui.bak.json'), { force: true })
  writeFileSync(FILE, 'not json')
  assert.deepEqual(loadUi(), {})
})

// ---- two processes on one file --------------------------------------------------------------
// The installed app and an `npm run dev` / capture run share ~/.hamster-desk/ui.json. Each used to
// write its own in-memory copy back whole, so whatever the other had added since was gone from the
// file — and gone for good once the first restarted and read it back. The other process is played
// here by writing the file directly between this module's saves.

test('what another process added to the file survives a write that did not touch it', () => {
  otherProcessWrites({ prefs: { lang: 'ko' }, recents: [{ path: 'C:\\a', at: 1, count: 1 }] })
  assert.deepEqual(paths(loadUi().recents), ['C:\\a']) // read: this is what this process knows
  // meanwhile the other one opens a folder, stars it and adds an account
  otherProcessWrites({
    prefs: { lang: 'ko' },
    recents: [{ path: 'C:\\b', at: 2, count: 1 }, { path: 'C:\\a', at: 1, count: 1 }],
    favs: ['C:\\b'],
    profiles: { list: [{ id: 'acc-2' }], currentId: 'acc-2' },
  })
  saveUi({ window: { x: 1 } }) // this process only moved its window …
  flushUi()
  const disk = onDisk()
  assert.deepEqual(disk.window, { x: 1 })
  assert.deepEqual(paths(disk.recents), ['C:\\b', 'C:\\a']) // … and the other's folder is still there
  assert.deepEqual(disk.favs, ['C:\\b'])
  assert.deepEqual(disk.profiles.currentId, 'acc-2')
})

test('a list both processes changed is merged by difference: additions from both, removals kept', () => {
  // this process's copy, after the write above, holds recents [b, a] and favs [b]. The renderer
  // works from its own copy of the lists, and sends the value it is replacing as `base`.
  otherProcessWrites({
    recents: [{ path: 'C:\\d', at: 4, count: 1 }, { path: 'C:\\b', at: 2, count: 1 }, { path: 'C:\\a', at: 1, count: 1 }],
    favs: ['C:\\b', 'c:\\c\\'], // the other one starred c (as it spells it) …
  })
  // … while this one un-starred b and starred e, and took b off the recent list with its ×
  saveUi({ favs: ['C:\\e'] }, { favs: ['C:\\b'] })
  saveUi({ recents: [{ path: 'C:\\a', at: 1, count: 1 }] }, { recents: [{ path: 'C:\\b', at: 2, count: 1 }, { path: 'C:\\a', at: 1, count: 1 }] })
  flushUi()
  const disk = onDisk()
  assert.deepEqual(disk.favs, ['C:\\e', 'c:\\c\\'], 'e added here, c added there, b removed here')
  assert.deepEqual(paths(disk.recents), ['C:\\a', 'C:\\d'], 'b removed here, d added there')
})

test('the same folder in both copies is one folder, whichever way it is spelled', () => {
  otherProcessWrites({ favs: ['C:\\x', 'c:\\shared\\'] })
  saveUi({ favs: ['C:\\x', 'C:\\Shared'] }, { favs: ['C:\\x'] })
  flushUi()
  assert.deepEqual(onDisk().favs, ['C:\\x', 'C:\\Shared'])
})

test('two changes to one list in the same 300 ms are one difference from where the author started', () => {
  otherProcessWrites({ favs: ['C:\\x', 'C:\\theirs'] })
  saveUi({ favs: ['C:\\x', 'C:\\one'] }, { favs: ['C:\\x'] })
  saveUi({ favs: ['C:\\one'] }, { favs: ['C:\\x', 'C:\\one'] }) // then x un-starred
  flushUi()
  assert.deepEqual(onDisk().favs, ['C:\\one', 'C:\\theirs'])
})

test('a list the other process left alone is replaced outright, removals included', () => {
  otherProcessWrites({ favs: ['C:\\x', 'C:\\y'] })
  loadUi()
  saveUi({ favs: ['C:\\y'] }, { favs: ['C:\\x', 'C:\\y'] })
  flushUi()
  assert.deepEqual(onDisk().favs, ['C:\\y'])
})

test('a key deleted here is deleted, and a key the other process deleted stays deleted', () => {
  otherProcessWrites({ favs: ['C:\\y'], fiveHourStart: { a: 1 }, lastCwd: 'C:\\y' })
  loadUi()
  otherProcessWrites({ favs: ['C:\\y'], lastCwd: 'C:\\y' }) // the other dropped fiveHourStart
  saveUi({ lastCwd: null })
  flushUi()
  assert.deepEqual(onDisk(), { favs: ['C:\\y'] })
})

test('a capture run keeps its changes in memory and never writes', () => {
  const before = readFileSync(FILE, 'utf8')
  setUiReadOnly(true)
  try {
    assert.equal(saveUi({ lastCwd: 'C:\\capture' }).lastCwd, 'C:\\capture')
    assert.equal(loadUi().lastCwd, 'C:\\capture', 'the run itself sees what it did')
    flushUi()
    assert.equal(readFileSync(FILE, 'utf8'), before)
    assert.equal(existsSync(`${FILE}.tmp`), false)
  } finally {
    setUiReadOnly(false)
  }
  assert.equal(loadUi().lastCwd, undefined, 'and the next read is the file again')
})

test('a file that cannot be read when the write is due is not written over; the change lands once it can be', () => {
  saveUi({ lastCwd: 'C:\\later' })
  const raw = readFileSync(FILE, 'utf8')
  rmSync(FILE)
  mkdirSync(FILE) // a folder of that name: the file "exists" and every read fails
  flushUi()
  assert.ok(statSync(FILE).isDirectory(), 'untouched')
  assert.equal(existsSync(`${FILE}.tmp`), false)
  rmSync(FILE, { recursive: true })
  writeFileSync(FILE, raw)
  flushUi() // the retry that was scheduled, run now
  assert.equal(onDisk().lastCwd, 'C:\\later')
  assert.deepEqual(onDisk().favs, ['C:\\y'], 'the rest of the file is still the file')
})
