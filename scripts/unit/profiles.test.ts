// Accounts (electron/profiles.ts): what a stored list has to look like before it is trusted, that
// adding/forgetting never touches anything outside the app's own folder, and that a tab remembers
// the account it ran under.
//
// HAMSTER_HOME points at a temp folder *before* anything is imported, so neither ui.json nor the
// account folders of this test land in the real ~/.hamster-desk.
import './dom-shim'
import { mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'

const HOME = mkdtempSync(join(tmpdir(), 'hd-profiles-'))
process.env.HAMSTER_HOME = HOME
delete process.env.CLAUDE_CONFIG_DIR

import { flushUi } from '../../electron/ui-store'
import {
  UNKNOWN_PROFILE_ID,
  addProfile,
  baseDirOf,
  configDirOf,
  deleteProfileDir,
  emailOf,
  loadProfiles,
  nextProfileId,
  profileOfConfigDir,
  removeProfile,
  renameProfile,
  sanitizeProfiles,
  setCurrentProfile,
} from '../../electron/profiles'
import { claudeDir, projectsDir, sessionsDir } from '../../electron/watcher/paths'
import { parseSnapshot } from '../../electron/statusline'
import { readStoredWorkspaces, serializeWorkspaces } from '../../src/workspaces-persist'
import type { Workspace } from '../../src/store'

after(() => {
  flushUi()
  rmSync(HOME, { recursive: true, force: true })
})

test('sanitizeProfiles always starts with the default account', () => {
  assert.deepEqual(sanitizeProfiles(undefined), { list: [{ id: 'default', name: '기본', dir: null }], currentId: 'default' })
  assert.deepEqual(sanitizeProfiles('rubbish').list.length, 1)
})

test('sanitizeProfiles drops broken rows, duplicates and a current id that is gone', () => {
  const got = sanitizeProfiles({
    list: [
      { id: 'default', name: '  개인  ', dir: 'C:\\ignored' }, // the default account can be renamed, never re-pointed
      { id: 'acc-2', name: '회사', dir: 'C:\\x\\acc-2' },
      { id: 'acc-2', name: '같은 id', dir: 'C:\\x\\other' },
      { id: 'acc-3', name: '같은 폴더', dir: 'C:\\x\\acc-2\\' },
      { id: 'Bad Id', name: 'x', dir: 'C:\\x\\bad' },
      { id: 'acc-4', name: 'no dir' },
      null,
    ],
    currentId: 'acc-9',
  })
  assert.deepEqual(got.list, [
    { id: 'default', name: '개인', dir: null },
    { id: 'acc-2', name: '회사', dir: 'C:\\x\\acc-2' },
  ])
  assert.equal(got.currentId, 'default')
})

test('nextProfileId skips the ids that are taken', () => {
  assert.equal(nextProfileId(['default']), 'acc-2')
  assert.equal(nextProfileId(['default', 'acc-2', 'acc-3']), 'acc-4')
})

test('add → rename → setCurrent → remove, all inside HAMSTER_HOME', () => {
  const { state, added } = addProfile('회사')
  assert.equal(added.id, 'acc-2')
  assert.equal(added.dir, join(HOME, 'profiles', 'acc-2'))
  assert.ok(existsSync(added.dir as string), 'the account folder is created')
  assert.equal(state.list.length, 2)
  assert.equal(state.currentId, 'default', 'adding does not switch by itself')

  assert.equal(renameProfile('acc-2', '  work  ').list[1].name, 'work')
  assert.equal(setCurrentProfile('acc-2').currentId, 'acc-2')
  assert.equal(setCurrentProfile('nope').currentId, 'acc-2', 'an unknown id changes nothing')

  assert.equal(configDirOf('acc-2'), added.dir)
  assert.equal(configDirOf('default'), null, 'the default account never gets a CLAUDE_CONFIG_DIR')
  assert.equal(configDirOf('nope'), null)
  assert.equal(baseDirOf('default'), claudeDir())
  assert.equal(baseDirOf('acc-2'), added.dir)

  // it survives a round trip through ui.json, without the looked-up email
  flushUi()
  const onDisk = JSON.parse(readFileSync(join(HOME, 'ui.json'), 'utf8')) as { profiles: unknown }
  assert.deepEqual(onDisk.profiles, {
    list: [
      { id: 'default', name: '기본', dir: null },
      { id: 'acc-2', name: 'work', dir: added.dir },
    ],
    currentId: 'acc-2',
  })

  const gone = removeProfile('acc-2')
  assert.equal(gone.state.list.length, 1)
  assert.equal(gone.state.currentId, 'default', 'deleting the current account falls back to the default one')
  assert.equal(gone.removed?.id, 'acc-2')
  assert.ok(existsSync(added.dir as string), 'taking it off the list is not what deletes the folder')
  assert.equal(deleteProfileDir(gone.removed), true)
  assert.ok(!existsSync(added.dir as string), 'the login and the conversations go with the account')

  const def = removeProfile('default')
  assert.equal(def.removed, null, 'the default account cannot be removed')
  assert.equal(def.state.list.length, 1)
  assert.deepEqual(loadProfiles().list.map((p) => p.id), ['default'])
})

test('deleteProfileDir only ever deletes a folder directly under profiles/', () => {
  const outside = join(HOME, 'not-an-account')
  mkdirSync(outside, { recursive: true })
  assert.equal(deleteProfileDir({ id: 'acc-9', name: 'x', dir: outside }), false)
  assert.equal(deleteProfileDir({ id: 'acc-9', name: 'x', dir: join(HOME, 'profiles') }), false, 'not the root itself')
  assert.equal(deleteProfileDir({ id: 'acc-9', name: 'x', dir: join(HOME, 'profiles', 'a', 'b') }), false, 'not something deeper')
  assert.equal(deleteProfileDir({ id: 'default', name: '기본', dir: null }), false)
  assert.equal(deleteProfileDir(null), false)
  assert.ok(existsSync(outside))
})

test('a number whose folder is still there is not handed to the next account', () => {
  assert.equal(nextProfileId(['default'], (id) => id === 'acc-2'), 'acc-3')
  mkdirSync(join(HOME, 'profiles', 'acc-2'), { recursive: true }) // a delete that could not finish
  const { added } = addProfile('fresh')
  assert.equal(added.id, 'acc-3')
  deleteProfileDir(removeProfile(added.id).removed)
  rmSync(join(HOME, 'profiles', 'acc-2'), { recursive: true, force: true })
})

test('profileOfConfigDir: unset and ~/.claude are the default account, a stranger is nobody', () => {
  const { added } = addProfile('second')
  const dir = added.dir as string
  assert.equal(profileOfConfigDir(''), 'default')
  assert.equal(profileOfConfigDir(claudeDir()), 'default')
  assert.equal(profileOfConfigDir(dir), added.id)
  assert.equal(profileOfConfigDir(dir.toUpperCase() + '\\'), process.platform === 'win32' ? added.id : UNKNOWN_PROFILE_ID)
  assert.equal(profileOfConfigDir(join(HOME, 'somewhere-else')), UNKNOWN_PROFILE_ID)
  removeProfile(added.id)
})

test('emailOf reads the login the CLI wrote next to the account', () => {
  const { added } = addProfile('mail')
  assert.equal(emailOf(added), null, 'nobody has logged in yet')
  writeFileSync(join(added.dir as string, '.claude.json'), JSON.stringify({ numStartups: 3, oauthAccount: { emailAddress: 'work@example.com' } }))
  assert.equal(emailOf(added), 'work@example.com')
  removeProfile(added.id)
})

test('paths follow the account folder', () => {
  assert.equal(sessionsDir(), join(claudeDir(), 'sessions'))
  assert.equal(sessionsDir('D:\\acct'), join('D:\\acct', 'sessions'))
  assert.equal(projectsDir('D:\\acct'), join('D:\\acct', 'projects'))
})

test('parseSnapshot carries the config dir the status line ran with', () => {
  const base = { session_id: 'abc', rate_limits: { five_hour: { used_percentage: 12 } } }
  assert.equal(parseSnapshot(base)?.configDir, undefined, 'a file written by the older script says nothing')
  assert.equal(parseSnapshot({ ...base, config_dir: '' })?.configDir, '')
  assert.equal(parseSnapshot({ ...base, config_dir: 'D:\\acct' })?.configDir, 'D:\\acct')
})

test('a stored tab remembers its account, and the default one is left out of the file', () => {
  const ws: Workspace[] = [
    { id: 1, ptyId: null, cwd: 'C:\\a', title: 'a', profileId: 'default' },
    { id: 2, ptyId: null, cwd: 'C:\\b', title: 'b', profileId: 'acc-2' },
  ]
  const stored = serializeWorkspaces(ws, 'ws:2')
  assert.deepEqual(stored, { tabs: [{ cwd: 'C:\\a', title: 'a' }, { cwd: 'C:\\b', title: 'b', profileId: 'acc-2' }], active: 1 })
  assert.deepEqual(readStoredWorkspaces(stored), stored)
  assert.deepEqual(readStoredWorkspaces({ tabs: [{ cwd: 'C:\\a', title: 'a', profileId: 7 }], active: 0 }).tabs, [{ cwd: 'C:\\a', title: 'a' }])
})
