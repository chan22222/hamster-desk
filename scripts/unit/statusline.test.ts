// The status line switch (electron/statusline.ts) writes into the user's own settings.json: it must
// never write over a file it could not read, must leave the rest of the file as it was, and keeps
// the file as it was next to it. And the snapshots folder it feeds does not grow for ever.
//
// First import, on purpose: statusline.ts fixes its folder (and the script paths) when it loads, so
// HAMSTER_HOME has to point at a temp folder before that — see temp-home.ts.
import { TEMP_HOME as HOME, TEMP_ROOT } from './temp-home'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { STATUS_DIR, STATUS_STALE_MS, StatusWatcher, installStatusLine, readSettings, statusLineState, uninstallStatusLine } from '../../electron/statusline'

// nothing below may run against the real ~/.hamster-desk: stop the whole file if the order ever changes
if (STATUS_DIR !== join(HOME, 'status')) throw new Error(`statusline.ts loaded before HAMSTER_HOME was set: ${STATUS_DIR}`)

after(() => rmSync(TEMP_ROOT, { recursive: true, force: true }))

let n = 0
/** a fresh account folder, with this settings.json in it (none when `text` is undefined) */
function account(text?: string): string {
  const dir = join(HOME, `acc-${++n}`)
  mkdirSync(dir, { recursive: true })
  if (text !== undefined) writeFileSync(join(dir, 'settings.json'), text, 'utf8')
  return dir
}
const settingsOf = (dir: string): Record<string, unknown> => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>

test('no settings.json yet: installed from nothing', () => {
  const dir = account()
  installStatusLine(dir)
  assert.equal(statusLineState(dir), 'installed')
  assert.ok(!existsSync(join(dir, 'settings.json.hamster-bak')), 'nothing to keep')
})

test('the rest of the file is kept, and the file as it was is kept beside it', () => {
  const before = { permissions: { allow: ['Bash(npm test)'] }, hooks: { Stop: [] }, env: { A: '1' }, model: 'opus' }
  const dir = account(JSON.stringify(before, null, 2))
  installStatusLine(dir)
  const after = settingsOf(dir)
  assert.deepEqual({ ...after, statusLine: undefined }, { ...before, statusLine: undefined })
  assert.equal(statusLineState(dir), 'installed')
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'settings.json.hamster-bak'), 'utf8')), before)
  uninstallStatusLine(dir)
  assert.deepEqual(settingsOf(dir), before, 'and taken back out, exactly')
  assert.ok(!readdirSync(dir).some((f) => f.endsWith('.hamster-tmp')), 'no temp file left behind')
})

test('a file saved with a BOM is still read', () => {
  const dir = account('﻿' + JSON.stringify({ model: 'sonnet' }))
  assert.deepEqual(readSettings(dir), { model: 'sonnet' })
  installStatusLine(dir)
  assert.equal(settingsOf(dir).model, 'sonnet')
})

test('a file that is not JSON is not written over — the install says so instead', () => {
  const broken = '{ "permissions": { "allow": ["Bash(ls)"], }, }' // a trailing comma from a hand edit
  const dir = account(broken)
  assert.throws(() => readSettings(dir))
  assert.throws(() => installStatusLine(dir))
  assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), broken, 'byte for byte as it was')
  assert.throws(() => uninstallStatusLine(dir))
  assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), broken)
  // what the UI shows until then: nothing configured (and the install button that will explain)
  assert.equal(statusLineState(dir), 'none')
  // an array or a string is JSON but not settings
  assert.throws(() => readSettings(account('[]')))
})

test('an empty file is an empty settings file', () => {
  const dir = account('')
  installStatusLine(dir)
  assert.equal(statusLineState(dir), 'installed')
})

test('the status folder: a snapshot older than a week is deleted, not reported', async () => {
  const dir = STATUS_DIR
  assert.ok(dir.startsWith(TEMP_ROOT), 'never the real folder')
  mkdirSync(dir, { recursive: true })
  const now = Date.now()
  const write = (name: string, ageMs: number): void => {
    const p = join(dir, name)
    writeFileSync(p, JSON.stringify({ session_id: name.replace(/\.\w+$/, ''), ts: now - ageMs }), 'utf8')
    const t = (now - ageMs) / 1000
    utimesSync(p, t, t)
  }
  write('fresh.json', 60_000)
  write('old.json', STATUS_STALE_MS + 60_000)
  write('left.tmp', STATUS_STALE_MS + 60_000) // a write the script never got to rename
  write('busy.tmp', 1000) // one being written right now
  const w = new StatusWatcher(() => now)
  const seen: string[] = []
  w.on('status', (s: { sessionId: string }) => seen.push(s.sessionId))
  await w.scan()
  assert.deepEqual(seen, ['fresh'])
  assert.deepEqual(readdirSync(dir).sort(), ['busy.tmp', 'fresh.json'])
})
