import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { AppUpdateInfo } from '../shared/events'

/**
 * Updates for the *installed* app (the NSIS setup from `npm run dist` / `npm run release`).
 *
 * Someone who installed it has no repository to pull, and cannot be asked to run a new setup for
 * every change. So an installed build follows GitHub Releases through electron-updater: a release
 * newer than this version is downloaded in the background (only the changed blocks, thanks to the
 * .blockmap published next to the setup), and then installed either when the user presses
 * "restart and update" or, failing that, silently the next time the app quits.
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

/** Progress arrives many times a second; the UI only shows whole steps of this size. */
const PERCENT_STEP = 5

async function load(onChange: () => void): Promise<typeof import('electron-updater').autoUpdater> {
  if (updater) return updater
  const { autoUpdater } = await import('electron-updater')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null // its default writes every step to the console
  autoUpdater.on('update-available', (info) => {
    release = { version: info.version, state: 'downloading', percent: 0 }
    onChange()
  })
  autoUpdater.on('update-not-available', () => {
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
    release = { version: info.version, state: 'ready', percent: 100 }
    onChange()
  })
  autoUpdater.on('error', (e) => {
    lastError = e?.message ?? String(e)
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

/** Ask GitHub once; state changes reach the UI through `onChange` as the download moves along. */
export function checkRelease(onChange: () => void): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const u = await load(onChange)
      lastError = null
      await u.checkForUpdates()
    } catch (e) {
      lastError = (e as Error).message
    } finally {
      checkedAt = Date.now()
      inflight = null
      onChange()
    }
  })()
  return inflight
}

/** true when a downloaded release is being installed: the app quits, the setup runs silently and reopens it */
export function installRelease(): boolean {
  if (!updater || release?.state !== 'ready') return false
  updater.quitAndInstall(true, true)
  return true
}
