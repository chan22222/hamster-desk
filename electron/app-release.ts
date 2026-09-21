import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { AppUpdateInfo } from '../shared/events'
import { logUpdate } from './update-log'

/**
 * Updates for the *installed* app (the NSIS setup from `npm run build` / a release).
 *
 * Someone who installed it has no repository to pull, and cannot be asked to run a new setup for
 * every change. So an installed build follows GitHub Releases through electron-updater: a release
 * newer than this version is downloaded in the background (only the changed blocks, thanks to the
 * .blockmap published next to the setup), and installed when the user says so.
 *
 * Installing is never invisible. Replacing the app means its exe is gone for half a minute, and an
 * install nobody can see invites exactly one thing: clicking the taskbar icon again, which then
 * answers "the path does not exist" — or starts the old exe under the installer's feet and breaks
 * the install. So there is no silent install when the app quits (`autoInstallOnAppQuit` is off),
 * and the one way in — "restart and update" — runs the setup with its progress window and lets it
 * reopen the app by itself.
 *
 * Which build is which:
 *   installed          an "Uninstall <exe name>" sits next to the exe      → this file
 *   inside a checkout  <repo>/release/win-unpacked                          → app-update.ts (commits)
 *   a copied folder    neither                                              → app-update.ts, link only
 *
 * electron-updater is loaded lazily and only for an installed build: it is a fair amount of code
 * that the other two kinds never need, and none of it belongs on the start-up path.
 */

/** the NSIS uninstaller electron-builder writes into the install folder (templates/nsis: UNINSTALL_FILENAME) */
export const uninstallerOf = (execPath: string): string => join(dirname(execPath), `Uninstall ${basename(execPath)}`)

export const isInstalled = (execPath: string, packaged: boolean): boolean =>
  packaged && process.platform === 'win32' && existsSync(uninstallerOf(execPath))

type Release = NonNullable<AppUpdateInfo['release']>

let updater: typeof import('electron-updater').autoUpdater | null = null
let release: Release | null = null
let lastError: string | null = null
let checkedAt = 0
let inflight: Promise<void> | null = null
let who = 'installed'

/** Progress arrives many times a second; the UI only shows whole steps of this size. */
const PERCENT_STEP = 5
/** a check that failed is tried again by itself — a laptop that just woke up has no network yet */
const RETRY_MS = [20_000, 60_000, 180_000]
let retries = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null

/** the first line is the message; the rest of an electron-updater error is a stack and headers */
const reason = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 200)

type AutoUpdater = typeof import('electron-updater').autoUpdater

/**
 * `autoUpdater`, out of whatever shape the module arrived in.
 *
 * electron-updater is CommonJS and defines `autoUpdater` with a getter (Object.defineProperty). The
 * main bundle keeps `await import('electron-updater')` as a real dynamic import, and node only lifts
 * the exports it can see statically out of a CommonJS module — a getter-defined one is not among
 * them. So the name is `undefined` on the namespace and lives under `default` (= module.exports).
 * Reading it as a named export is what made every check of every installed build from 0.1.1 to
 * 0.1.8 fail with "Cannot set properties of undefined (setting 'autoDownload')" — the types say
 * the named export exists, so nothing but running it could tell.
 */
export function pickAutoUpdater(mod: unknown): AutoUpdater {
  const m = mod as { autoUpdater?: AutoUpdater; default?: { autoUpdater?: AutoUpdater } } | null
  const found = m?.autoUpdater ?? m?.default?.autoUpdater
  if (!found) throw new Error('electron-updater 를 불러왔지만 autoUpdater 가 없습니다')
  return found
}

async function load(onChange: () => void): Promise<AutoUpdater> {
  if (updater) return updater
  const autoUpdater = pickAutoUpdater(await import('electron-updater'))
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false // see the header: an install nobody can see
  autoUpdater.logger = null // its default writes every step to the console
  autoUpdater.on('update-available', (info) => {
    logUpdate(who, `available ${info.version}`)
    release = { version: info.version, state: 'downloading', percent: 0 }
    onChange()
  })
  autoUpdater.on('update-not-available', (info) => {
    logUpdate(who, `up to date (latest ${info.version})`)
    release = null
    onChange()
  })
  autoUpdater.on('download-progress', (p) => {
    if (!release || release.state !== 'downloading') return
    const percent = Math.floor(p.percent / PERCENT_STEP) * PERCENT_STEP
    if (percent === release.percent) return
    release = { ...release, percent }
    onChange()
  })
  autoUpdater.on('update-downloaded', (info) => {
    logUpdate(who, `downloaded ${info.version}`)
    lastError = null
    release = { version: info.version, state: 'ready', percent: 100 }
    onChange()
  })
  autoUpdater.on('error', (e) => {
    lastError = reason(e)
    logUpdate(who, `error ${lastError}`)
    // a download that died is not "ready", and not worth a stuck progress line either
    if (release?.state === 'downloading') release = null
    onChange()
  })
  updater = autoUpdater
  return autoUpdater
}

/** What the UI shows for an installed build. `commit` is only there to be displayed. */
export function releaseInfo(version: string, commit: string | null): AppUpdateInfo {
  return { commit, behind: 0, commits: [], canSelfUpdate: false, checkedAt, error: lastError, version, release }
}

/**
 * Ask GitHub once; state changes reach the UI through `onChange` as the download moves along.
 * `manual`: the user pressed "check again" — start the retry ladder over.
 */
export function checkRelease(onChange: () => void, version: string, manual = false): Promise<void> {
  who = `installed ${version}`
  if (manual) retries = 0
  if (inflight) return inflight
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  inflight = (async () => {
    try {
      const u = await load(onChange)
      lastError = null
      logUpdate(who, 'check')
      await u.checkForUpdates()
    } catch (e) {
      lastError = reason(e)
      logUpdate(who, `error ${lastError}`)
    } finally {
      checkedAt = Date.now()
      inflight = null
      onChange()
      if (lastError && retries < RETRY_MS.length) {
        retryTimer = setTimeout(() => void checkRelease(onChange, version), RETRY_MS[retries++])
      }
    }
  })()
  return inflight
}

/**
 * true when a downloaded release is being installed: the app quits, the setup runs *with its
 * progress window* and reopens the app when it is done.
 */
export function installRelease(): boolean {
  if (!updater || release?.state !== 'ready') return false
  logUpdate(who, `install ${release.version}`)
  updater.quitAndInstall(false, true)
  return true
}
