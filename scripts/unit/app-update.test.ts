// The pure parts of the app's own update check (electron/app-update.ts) and of the boot log
// (electron/boot-log.ts). Nothing here touches the network: what GitHub answers is fed in as data.
//
// HAMSTER_HOME is read once, when electron/statusline.ts is first evaluated — and app-update.ts pulls
// that in through update-log.ts. So it is pointed at a temp folder *before* any of those imports
// (tsx keeps statements and imports in source order), or the logs of this test would land in the
// real ~/.hamster-desk.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'hd-update-home-'))
process.env.HAMSTER_HOME = HOME
// the self-update script is worded in main's language (electron/lang.ts); the Korean asserted below
// must not depend on the machine's locale
process.env.HAMSTER_LANG = 'ko'

import { buildCommit, checkAppUpdate, parseCompare, parseGitLog, psLiteral, repoDirOf, updateScript } from '../../electron/app-update'
import { RELEASE_FEEDS, attach, checkOverFeeds, downloadRelease, installRelease, isInstalled, pickAutoUpdater, releaseInfo, uninstallerOf, type FeedChecker } from '../../electron/app-release'

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
  const home = HOME
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

test('an installed build is told apart by the uninstaller the setup leaves next to the exe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hd-installed-'))
  const exe = join(dir, 'Hamster Desk.exe')
  assert.equal(uninstallerOf(exe), join(dir, 'Uninstall Hamster Desk.exe'))
  assert.equal(isInstalled(exe, true), false) // win-unpacked, or a copied folder
  writeFileSync(uninstallerOf(exe), '')
  assert.equal(isInstalled(exe, true), process.platform === 'win32')
  assert.equal(isInstalled(exe, false), false) // a dev run is never 'installed'
})

test('an installed build reports its version and no commits to be behind', () => {
  const u = releaseInfo('0.1.0', null)
  assert.deepEqual([u.version, u.behind, u.commits, u.canSelfUpdate, u.release], ['0.1.0', 0, [], false, null])
})

test('parseGitLog reads what `git log --format=%h%x09%s` prints, tabs in a subject included', () => {
  const TAB = String.fromCharCode(9)
  const text = ['932264e' + TAB + '0.1.5: 활성 계정', 'e2409ab' + TAB + 'a' + TAB + 'b', '', 'not a log line'].join(String.fromCharCode(10))
  assert.deepEqual(parseGitLog(text), [
    { sha: '932264e', title: '0.1.5: 활성 계정' },
    { sha: 'e2409ab', title: 'a' + TAB + 'b' },
  ])
  assert.deepEqual(parseGitLog(''), [])
})

test('the self-update script starts with a BOM, rebuilds the folder only, and says not to click the icon', () => {
  const UPDATE_SCRIPT = updateScript()
  assert.equal(UPDATE_SCRIPT.charCodeAt(0), 0xfeff) // PowerShell 5.1 reads a .ps1 without one as ANSI: garbled Korean
  assert.ok(UPDATE_SCRIPT.includes("'git pull --ff-only', 'npm install --legacy-peer-deps', 'npm run build:dir'"))
  assert.ok(UPDATE_SCRIPT.includes('git checkout -- package-lock.json'))
  assert.ok(UPDATE_SCRIPT.includes('작업 표시줄 아이콘은 누르지 마세요'))
  // worded in main's language when it is written, inside single-quoted PowerShell strings — which the
  // typographic single quotes would end as surely as the plain one
  assert.equal(psLiteral("it's ‘here’ and ‚there‛"), "it''s ''here'' and ''there''")
  process.env.HAMSTER_LANG = 'en'
  try {
    assert.ok(updateScript().includes("Write-Host 'Do not click the taskbar icon meanwhile"))
  } finally {
    process.env.HAMSTER_LANG = 'ko'
  }
})

test('every update check leaves a line in update.log', async () => {
  const home = HOME
  const { logUpdate, updateLogPath } = await import('../../electron/update-log')
  logUpdate('installed 0.1.3', 'error net::ERR_INTERNET_DISCONNECTED' + String.fromCharCode(10) + '    at stack')
  assert.equal(updateLogPath(), join(home, 'update.log'))
  const last = readFileSync(updateLogPath(), 'utf8').trim().split(String.fromCharCode(10)).pop() as string
  assert.match(last, /^d{4}-dd-ddT[d:.]+Z installed 0.1.3 | error net::ERR_INTERNET_DISCONNECTED at stack$/)
})

test('pickAutoUpdater finds it as a named export, under default, and says so when it is nowhere', () => {
  const it = { autoDownload: false } as unknown as ReturnType<typeof pickAutoUpdater>
  assert.equal(pickAutoUpdater({ autoUpdater: it }), it)
  assert.equal(pickAutoUpdater({ default: { autoUpdater: it } }), it) // what node really hands over, see below
  assert.equal(pickAutoUpdater({ default: { get autoUpdater() { return it } } }), it) // …and there it is a getter
  for (const nothing of [null, undefined, {}, { default: {} }]) assert.throws(() => pickAutoUpdater(nothing), /autoUpdater/)
})

test('the real electron-updater, imported the way the main bundle imports it, has autoUpdater where pickAutoUpdater looks', async () => {
  // Every installed build from 0.1.1 to 0.1.8 failed its update check on this. The getter itself is
  // not called here (it builds an updater, which needs a running Electron app) — only where it is.
  const ns = (await import('electron-updater')) as unknown as Record<string, unknown> & { default?: object }
  const named = Object.prototype.hasOwnProperty.call(ns, 'autoUpdater')
  const underDefault = !!ns.default && !!Object.getOwnPropertyDescriptor(ns.default, 'autoUpdater')
  assert.ok(named || underDefault, 'electron-updater changed shape: autoUpdater is neither a named export nor under default')
})

/** an updater whose feeds fail as told: `bad` = the providers that reject */
function fakeUpdater(bad: string[]): { u: FeedChecker; asked: string[] } {
  const asked: string[] = []
  let feed = ''
  const u: FeedChecker = {
    setFeedURL: (f) => void (feed = f.provider),
    checkForUpdates: async () => {
      asked.push(feed)
      if (bad.includes(feed)) throw new Error(`HttpError: 504 (${feed})` + String.fromCharCode(10) + 'headers…')
    },
  }
  return { u, asked }
}

test('the update check asks the releases feed, and the latest release itself only when the feed is down', async () => {
  assert.deepEqual(RELEASE_FEEDS.map((f) => f.provider), ['github', 'generic'])
  assert.equal(RELEASE_FEEDS[1].url, 'https://github.com/chan22222/hamster-desk/releases/latest/download')

  const fine = fakeUpdater([])
  const said: string[] = []
  await checkOverFeeds(fine.u, (w) => said.push(w))
  assert.deepEqual([fine.asked, said], [['github'], []]) // the normal case: one question, nothing to report

  const feedDown = fakeUpdater(['github']) // the night 0.1.10 came out: releases.atom answered 504
  await checkOverFeeds(feedDown.u, (w) => said.push(w))
  assert.deepEqual(feedDown.asked, ['github', 'generic'])
  assert.equal(said[0], 'the releases feed failed (HttpError: 504 (github)): asking releases/latest/download instead') // first line of the error only

  const allDown = fakeUpdater(['github', 'generic'])
  await assert.rejects(checkOverFeeds(allDown.u, () => undefined), (e: Error) => e.message.includes('504 (generic)')) // what is reported is the last answer

  await checkOverFeeds(feedDown.u, () => undefined)
  assert.deepEqual(feedDown.asked.slice(2), ['github', 'generic']) // every check starts over at the feed: only it allows a partial download
})

test('a release found is only announced: it is downloaded when "update" is pressed, and installed when it is there', async () => {
  // Until this, finding a release started the download inside checkForUpdates — the dialog asked,
  // and "later" did not stop 120 MB from coming down anyway. Last in this file: `release` is module state.
  let downloads = 0
  let installs = 0
  let fail = false
  const fake = Object.assign(new EventEmitter(), {
    autoDownload: true, // electron-updater's default
    autoInstallOnAppQuit: true,
    logger: console as unknown,
    downloadUpdate: async (): Promise<string[]> => {
      downloads++
      if (!fail) return []
      const e = new Error('net::ERR_CONNECTION_RESET')
      fake.emit('error', e) // what electron-updater does before it rejects
      throw e
    },
    quitAndInstall: (): void => void installs++,
  })
  const onChange = (): void => undefined
  const rel = (): unknown => releaseInfo('0.1.0', null).release
  const settle = (): Promise<void> => new Promise((r) => setImmediate(r))

  attach(fake as unknown as Parameters<typeof attach>[0], onChange)
  assert.equal(fake.autoDownload, false)
  assert.equal(fake.autoInstallOnAppQuit, false)

  fake.emit('update-available', { version: '9.0.0' })
  assert.deepEqual(rel(), { version: '9.0.0', state: 'available', percent: 0 })
  await settle()
  assert.equal(downloads, 0, 'nothing is downloaded before the user asks')
  assert.equal(installRelease(), false, 'and nothing is installed that was not downloaded')

  // a download that dies puts the button back, with the reason
  fail = true
  assert.equal(downloadRelease(onChange), true)
  assert.deepEqual(rel(), { version: '9.0.0', state: 'downloading', percent: 0 })
  await settle()
  assert.deepEqual(rel(), { version: '9.0.0', state: 'available', percent: 0 })
  assert.equal(releaseInfo('0.1.0', null).error, 'net::ERR_CONNECTION_RESET')

  fail = false
  assert.equal(downloadRelease(onChange), true)
  assert.equal(downloadRelease(onChange), false, 'one download at a time')
  fake.emit('update-available', { version: '9.0.0' }) // the hourly check finds it again
  fake.emit('download-progress', { percent: 47 })
  assert.deepEqual(rel(), { version: '9.0.0', state: 'downloading', percent: 45 })
  fake.emit('update-downloaded', { version: '9.0.0' })
  fake.emit('update-available', { version: '9.0.0' }) // …and again, once it is there
  assert.deepEqual(rel(), { version: '9.0.0', state: 'ready', percent: 100 })
  assert.equal(downloads, 2)

  assert.equal(installRelease(), true)
  assert.equal(installs, 1)
})
