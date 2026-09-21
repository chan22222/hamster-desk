// The pure parts of the app's own update check (electron/app-update.ts) and of the boot log
// (electron/boot-log.ts). Nothing here touches the network: what GitHub answers is fed in as data.
//
// HAMSTER_HOME is read once, when electron/statusline.ts is first evaluated — so it is set before
// the dynamic import below, and the boot log lands in a temp folder instead of the real one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCommit, checkAppUpdate, parseCompare, repoDirOf } from '../../electron/app-update'

const commit = (n: number, message: string): unknown => ({ sha: String(n).repeat(40).slice(0, 40), commit: { message } })

test('parseCompare counts what main has and lists it newest first, first line only', () => {
  const r = parseCompare({ status: 'ahead', ahead_by: 2, behind_by: 0, commits: [commit(1, 'older\n\nbody'), commit(2, 'newer')] })
  assert.equal(r.behind, 2)
  assert.deepEqual(r.commits, [
    { sha: '2222222', title: 'newer' },
    { sha: '1111111', title: 'older' },
  ])
})

test('parseCompare says "not behind" for a build that is level with main or ahead of it', () => {
  assert.deepEqual(parseCompare({ status: 'identical', ahead_by: 0, commits: [] }), { behind: 0, commits: [] })
  // `behind` = this build has commits main lacks; its commits are not an update
  assert.deepEqual(parseCompare({ status: 'behind', ahead_by: 0, behind_by: 3, commits: [] }), { behind: 0, commits: [] })
})

test('parseCompare survives an answer that is not what the API documents', () => {
  for (const junk of [null, 'nope', 42, [], { ahead_by: '2' }, { ahead_by: 1, commits: 'x' }, { ahead_by: 1, commits: [null, {}] }]) {
    const r = parseCompare(junk)
    assert.ok(r.behind === 0 || r.behind === 1)
    assert.deepEqual(r.commits, [])
  }
})

test('parseCompare keeps the list short however far behind the build is', () => {
  const many = Array.from({ length: 40 }, (_, i) => commit(i % 10, `c${i}`))
  const r = parseCompare({ ahead_by: 40, commits: many })
  assert.equal(r.behind, 40)
  assert.equal(r.commits.length, 12)
  assert.equal(r.commits[0].title, 'c39')
})

test('repoDirOf finds the checkout above release/win-unpacked, and only a checkout of this app', () => {
  const root = mkdtempSync(join(tmpdir(), 'hd-update-'))
  const exe = join(root, 'release', 'win-unpacked', 'Hamster Desk.exe')
  assert.equal(repoDirOf(exe, root, true), null) // a copied folder: no repository above it

  mkdirSync(join(root, '.git'))
  assert.equal(repoDirOf(exe, root, true), null) // a repository, but no package.json

  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'something-else' }))
  assert.equal(repoDirOf(exe, root, true), null) // somebody else's repository

  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'hamster-desk' }))
  assert.equal(repoDirOf(exe, root, true), join(root, 'release', 'win-unpacked', '..', '..'))
  assert.equal(repoDirOf('anything', root, false), root) // a dev run: the app path is the checkout
})

test('a build without a commit stamp never asks GitHub', async () => {
  assert.equal(buildCommit(), null) // tsx defines no __BUILD_COMMIT__
  const u = await checkAppUpdate(true, false)
  assert.equal(u.behind, 0)
  assert.equal(u.error, 'no build commit')
})

test('the boot log writes one line per launch with the gaps between marks', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hd-boot-'))
  process.env.HAMSTER_HOME = home
  const { bootLogPath, bootMark, writeBootLog } = await import('../../electron/boot-log')
  bootMark('main')
  bootMark('ready')
  bootMark('booted')
  writeBootLog('0.1.0 abc1234 dev', Date.now() - 5000)
  writeBootLog('again', null) // a second call (StrictMode's double effect) adds nothing
  assert.equal(bootLogPath(), join(home, 'boot.log'))
  const lines = readFileSync(bootLogPath(), 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^\d{4}-\d\d-\d\dT[\d:.]+Z 0\.1\.0 abc1234 dev \| os>main \d+ \| ready \+\d+ \| booted \+\d+ \| total \d+ms$/)
  const osToMain = Number(lines[0].match(/os>main (\d+)/)?.[1])
  assert.ok(osToMain >= 4900 && osToMain < 6000, `os>main was ${osToMain}`)
})
