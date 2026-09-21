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

import { flushUi, loadUi, saveUi } from '../../electron/ui-store'

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
