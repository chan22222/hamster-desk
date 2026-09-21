import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { appendFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DeskWatcher } from './watcher'
import { DEFAULT_PROFILE_ID, type BubbleRequest, type DeskEvent, type FileEntry, type NotifyRequest, type Profile, type SessionInfo, type StatusSnapshot, type UiState, type AppUpdateInfo } from '../shared/events'
import { spawnPty, PromptDetector, type PtyHandle } from './pty'
import { HAMSTER_HOME, StatusWatcher, installStatusLine, uninstallStatusLine, statusLineState, refreshStatusScripts } from './statusline'
import { addProfile, adoptOrphanProfiles, baseDirOf, configDirOf, deleteProfileDir, loadProfiles, profileOfConfigDir, removeProfile, renameProfile, setCurrentProfile, withEmails } from './profiles'
import { flushUi, loadUi, saveUi, uiPath } from './ui-store'
import { checkVersion } from './version'
import { BubbleSummarizer } from './summarize'
import { cleanupLegacyHarness } from './legacy'
import { claudeDir } from './watcher/paths'
import { AUMID_VARIANTS, appUserModelId, aumidFor, showNotification } from './notify'
import { attachWindowStateSaver, isMini, persistWindowState, readWindowState, setMini } from './window-state'
import { listTranscripts } from './transcripts'
import { gitDiff, gitInfo } from './git'
import { COMMITS_URL, buildCommit, checkAppUpdate, repoDirOf, startSelfUpdate } from './app-update'
import { checkRelease, installRelease, isInstalled, releaseInfo } from './app-release'
import { bootMark, writeBootLog } from './boot-log'
import { listDir, pathExists, repairShortcuts } from './shortcuts'

// the first line of ours to run; what came before it is the OS loading the exe (electron/boot-log.ts)
bootMark('main')

// The portable exe, `npm run dev` and the smoke runs all landed on the same %APPDATA%\hamster-desk
// profile: whichever started second could not lock the caches ("Unable to move the cache",
// "Gpu Cache Creation failed") and they overwrote each other's Local Storage (settings, recent
// folders). Give each run mode its own profile; the packaged app keeps the original path so
// existing users keep their settings. sessionData is set explicitly because Electron 28+ lets it
// sit apart from userData — caches and Local Storage follow sessionData, not userData.
// Must run before anything touches app.getPath/session, and before app.whenReady().
//
// A capture run gets a profile of its own, named after the process: two captures started side by
// side used to land on the one `hamster-desk-smoke` folder, and the second spent its first seconds
// failing to lock the cache — late enough to miss its own HAMSTER_CLICK / capture timers. The
// folder is thrown away on exit; whatever Chromium still held open then is swept by the next run.
const SMOKE_PREFIX = 'hamster-desk-smoke-'
if (!app.isPackaged) {
  const capture = !!process.env.HAMSTER_CAPTURE
  const profile = capture
    ? join(app.getPath('temp'), SMOKE_PREFIX + process.pid)
    : join(app.getPath('appData'), 'hamster-desk-dev')
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  if (capture) {
    sweepSmokeProfiles(app.getPath('temp'))
    process.on('exit', () => removeDir(profile))
  }
}

/** Best effort, always: a cache file Chromium has not let go of yet is not worth failing over. */
function removeDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 })
  } catch {
    /* still locked — the next capture run sweeps it */
  }
}

/** Throw away the profiles of capture runs that are no longer running. */
function sweepSmokeProfiles(temp: string): void {
  try {
    for (const name of readdirSync(temp)) {
      if (!name.startsWith(SMOKE_PREFIX)) continue
      const pid = Number(name.slice(SMOKE_PREFIX.length))
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue
      try {
        process.kill(pid, 0) // throws when there is no such process; signal 0 sends nothing
        continue // that run is still going — leave its profile alone
      } catch {
        removeDir(join(temp, name))
      }
    }
  } catch {
    /* no temp folder to read — nothing to sweep */
  }
}

// A blind run is judged by a screenshot taken while nobody looks at the window, and Chromium
// stops painting — and throttles timers in — a window it thinks is covered or in the background.
// That is the right call for a user's app and the wrong one for a capture, so only these runs
// turn it off (the matching `backgroundThrottling` is in createWindow).
const blindRun =
  !app.isPackaged &&
  !!(
    process.env.HAMSTER_CAPTURE ||
    process.env.HAMSTER_EVENTS ||
    process.env.HAMSTER_CLICK ||
    process.env.HAMSTER_KEYS ||
    process.env.HAMSTER_UNFOCUSED
  )
if (blindRun) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// A second copy of the packaged app would fight over that one profile, so it hands off to the
// running window instead of starting. dev/smoke runs have their own profiles and may overlap.
const gotLock = app.isPackaged ? app.requestSingleInstanceLock() : true
if (!gotLock) app.quit()

// Windows files a toast under an Application User Model ID, and it has to be set before anything
// shows one (electron/notify.ts holds the three variants and why). HAMSTER_NOTIFY_PROBE leaves it
// alone on purpose: its first variant *is* "whatever this process gets without asking".
if (process.env.HAMSTER_NOTIFY_PROBE !== '1') app.setAppUserModelId(appUserModelId(app.isPackaged))

const ptys = new Map<number, PtyHandle>()
/** pty id → the account its shell was started under */
const ptyProfile = new Map<number, string>()
let win: BrowserWindow | null = null
/** one watcher per account (profile id → watcher): each account has its own sessions/ and projects/ */
const watchers = new Map<string, DeskWatcher>()
let status: StatusWatcher | null = null
let bubbles: BubbleSummarizer | null = null

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

// Events carry a sequence number and are kept in a ring buffer, so a renderer that mounts (or reloads)
// after the watcher already streamed the catch-up can replay them and skip duplicates.
const BACKLOG_MAX = 4000
let seq = 0
const backlog: { seq: number; ev: DeskEvent }[] = []
function emitDesk(ev: DeskEvent): void {
  const item = { seq: ++seq, ev }
  backlog.push(item)
  if (backlog.length > BACKLOG_MAX) backlog.splice(0, backlog.length - BACKLOG_MAX)
  send('desk:event', item)
}

// ---- debug/e2e knobs ----------------------------------------------------------------------
// None of these exist in a packaged build: `app.isPackaged` gates every one of them, so the env
// vars are inert for a user who happens to have them set. They let a blind capture run prove a
// claim (a button really does that, a shortcut really goes through) without a claude session.

/** Nothing here is available once the app is packaged. */
const debugOff = (): boolean => app.isPackaged

/** `HAMSTER_EVENTS='[…]'` — desk events the renderer replays into the store (src/dev/debug.ts). */
function debugEvents(): DeskEvent[] | null {
  if (debugOff() || !process.env.HAMSTER_EVENTS) return null
  try {
    const v: unknown = JSON.parse(process.env.HAMSTER_EVENTS)
    return Array.isArray(v) ? (v as DeskEvent[]) : null
  } catch {
    return null
  }
}

/** `HAMSTER_CLICK='more@3000|mini-toggle@4000'`; a bare name keeps the old meaning (`@3000`). */
function debugClicks(): { name: string; at: number }[] {
  if (debugOff() || !process.env.HAMSTER_CLICK) return []
  return process.env.HAMSTER_CLICK.split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((step) => {
      const i = step.lastIndexOf('@')
      if (i < 0) return { name: step, at: 3000 }
      const at = Number(step.slice(i + 1))
      return { name: step.slice(0, i), at: Number.isFinite(at) ? at : 3000 }
    })
    .filter((c) => c.name.length > 0)
}

const unfocusedStart = (): boolean => !debugOff() && process.env.HAMSTER_UNFOCUSED === '1'

/** `ctrl`/`cmd` spelled the way `sendInputEvent` wants them. */
const KEY_MODS: Record<string, 'shift' | 'control' | 'alt' | 'meta'> = {
  ctrl: 'control',
  control: 'control',
  shift: 'shift',
  alt: 'alt',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
}

/**
 * `HAMSTER_KEYS='ctrl+f@6000|ctrl+shift+m@9000'` — real key events pushed into the window, so a
 * shortcut is proven on the path it actually takes (a window `keydown`) rather than by calling
 * its handler directly.
 */
function scheduleKeys(): void {
  if (debugOff() || !process.env.HAMSTER_KEYS) return
  for (const step of process.env.HAMSTER_KEYS.split('|')) {
    const s = step.trim()
    if (!s) continue
    const i = s.lastIndexOf('@')
    const parsed = i < 0 ? NaN : Number(s.slice(i + 1))
    const at = Number.isFinite(parsed) ? parsed : 5000
    const parts = (i < 0 ? s : s.slice(0, i)).toLowerCase().split('+').map((p) => p.trim()).filter(Boolean)
    const keyCode = parts.pop() ?? ''
    if (!keyCode) continue
    const modifiers = parts.map((m) => KEY_MODS[m]).filter(Boolean)
    setTimeout(() => {
      const wc = win?.webContents
      if (!wc) return
      // sendInputEvent only reaches the page while the window is focused, and a capture run has
      // usually lost it to whatever terminal started it. HAMSTER_UNFOCUSED runs are the one case
      // that must keep its hands off — being in the background is the whole point there.
      if (!unfocusedStart()) win?.focus()
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      wc.sendInputEvent({ type: 'char', keyCode, modifiers })
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
      console.log(`[keys] ${modifiers.join('+')}${modifiers.length ? '+' : ''}${keyCode}`)
    }, at)
  }
}

/**
 * `HAMSTER_NOTIFY_PROBE=1` — the three AUMID variants, 3 s apart, so one blind run says what this
 * PC actually does with a toast (plan §3.1, R1). The id is only set here, which is what makes the
 * first variant ('none', i.e. whatever the process gets without asking) an honest test.
 */
function scheduleNotifyProbe(): void {
  if (debugOff() || process.env.HAMSTER_NOTIFY_PROBE !== '1') return
  AUMID_VARIANTS.forEach((variant, i) => {
    setTimeout(() => {
      const id = aumidFor(variant)
      if (id) app.setAppUserModelId(id)
      void showNotification({ title: `probe ${variant}`, body: `aumid=${id ?? '(unset)'}`, tag: 'turn', tab: '' }, win).then((r) =>
        console.log(`[notify] probe aumid=${variant} result=${r}`),
      )
    }, 5000 + i * 3000)
  })
}

function createWindow(): void {
  // where the window sat last time, once it has been checked against the screens that exist now
  const saved = readWindowState()
  win = new BrowserWindow({
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    width: saved?.width ?? 1280,
    height: saved?.height ?? 880,
    minWidth: 760,
    minHeight: 480,
    // what the window is until the page paints: the loading screen's own background (index.html),
    // which is `--bg` of the palette the OS asks for
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1311' : '#f4f6f4',
    title: 'Hamster Desk',
    // the packaged exe carries the icon itself (build.win.icon); a dev run is plain electron.exe
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // a blind run is photographed in the background, where a throttled renderer would still be
      // on the frame before last — and its HAMSTER_CLICK timers a second behind
      ...(blindRun ? { backgroundThrottling: false } : {}),
    },
  })
  // a window that was left maximized comes back maximized; the bounds above are what it
  // un-maximizes to (see `getNormalBounds` in window-state.ts)
  if (saved?.maximized) win.maximize()
  attachWindowStateSaver(win)
  // "Pin to taskbar" on the running window normally copies whatever Start-menu shortcut carries our
  // id — which can be stale (electron/shortcuts.ts). With relaunch details on the window itself,
  // Windows builds the pin from these instead: this exe, this icon, this id.
  if (app.isPackaged && process.platform === 'win32') {
    try {
      win.setAppDetails({
        appId: appUserModelId(true),
        appIconPath: process.execPath,
        appIconIndex: 0,
        relaunchCommand: `"${process.execPath}"`,
        relaunchDisplayName: 'Hamster Desk',
      })
    } catch {
      /* cosmetic: the window still works without it */
    }
  }
  // the taskbar button blinks while a notification is unanswered; looking at the window answers it
  win.on('focus', () => {
    try {
      win?.flashFrame(false)
    } catch {
      /* the window went away between the event and here */
    }
  })
  // Up at once rather than on 'ready-to-show': that waits for the first paint, and a window that
  // is not there yet looks like a click that did nothing. Until the page paints the window is
  // `backgroundColor`; the first thing painted is the loading screen index.html carries as markup.
  // debug/e2e: HAMSTER_UNFOCUSED=1 brings the window up *without* focus, which is the only
  // state the notification path fires in — otherwise a blind run can never reach it.
  if (unfocusedStart()) win.showInactive()
  else win.show()
  bootMark('window')
  win.webContents.once('dom-ready', () => bootMark('dom'))
  win.webContents.once('did-finish-load', () => bootMark('load'))
  if (process.env.HAMSTER_CAPTURE) {
    // Smoke tests run blind: surface renderer errors on stdout, and let the renderer's own
    // tagged lines ([debug] click …, [git] …) through verbatim — a capture that shows nothing
    // is only useful if it also says why. Untagged chatter stays out of the way.
    win.webContents.on('console-message', (ev) => {
      if (ev.level === 'error' || ev.level === 'warning') console.log(`[renderer:${ev.level}] ${ev.message}`)
      else if (ev.message.startsWith('[')) console.log(ev.message)
    })
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', () => {
    win = null
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

const liveSessions = (): SessionInfo[] => [...watchers.values()].flatMap((w) => w.liveSessions)
const rescanAll = (): void => {
  for (const w of watchers.values()) void w.rescan()
}

/** Start watching one account's folder. The default account passes no folder: the CLI's own. */
function watchProfile(p: Profile): void {
  if (watchers.has(p.id)) return
  const w = new DeskWatcher({
    ownedShells: () => [...ptys.values()].map((h) => ({ ptyId: h.id, pid: h.pid })),
    ...(p.dir ? { baseDir: p.dir } : {}),
    profileId: p.id,
  })
  w.on('event', (e: DeskEvent) => emitDesk(e))
  watchers.set(p.id, w)
  void w.start()
}

/** A forgotten account: its sessions leave the office, the folder itself is left alone. */
function unwatchProfile(id: string): void {
  const w = watchers.get(id)
  if (!w) return
  const gone = w.liveSessions.map((s) => s.sessionId)
  w.stop()
  watchers.delete(id)
  for (const sessionId of gone) emitDesk({ kind: 'session_gone', sessionId })
}

/**
 * Rate limits belong to an account, so a snapshot has to say whose it is. The status-line script
 * reports the `CLAUDE_CONFIG_DIR` it ran with; a file an older script wrote does not, and then the
 * session's own watcher is the next best witness.
 */
function profileOfSnapshot(s: StatusSnapshot): string {
  if (s.configDir !== undefined) return profileOfConfigDir(s.configDir)
  for (const [id, w] of watchers) if (w.liveSessions.some((x) => x.sessionId === s.sessionId)) return id
  return DEFAULT_PROFILE_ID
}

function startWatchers(): void {
  // accounts the list lost but whose folder (and login) is still on disk come back first
  const adopted = adoptOrphanProfiles()
  if (adopted.length) console.log(`[profiles] recovered: ${adopted.map((p) => p.id).join(', ')}`)
  for (const p of loadProfiles().list) watchProfile(p)

  refreshStatusScripts()
  status = new StatusWatcher()
  status.on('status', (s: StatusSnapshot) => emitDesk({ kind: 'status', ...s, profileId: profileOfSnapshot(s) }))
  status.start()

  const version = (force = false): void => {
    void checkVersion(force).then((v) => emitDesk({ kind: 'version', ...v }))
  }
  version()
  setInterval(() => version(), 60 * 60 * 1000)

  // a capture run photographs the window, and a pill that depends on the network is not repeatable
  if (!process.env.HAMSTER_CAPTURE) {
    void appUpdate()
    setInterval(() => void appUpdate(), 60 * 60 * 1000)
  }
}

/**
 * debug/e2e: HAMSTER_TYPE is typed into the first shell. The two-character sequences \r and \n are
 * expanded; '|' splits the text into steps typed HAMSTER_TYPE_DELAY ms apart (default 1500).
 */
function autoType(handle: PtyHandle): void {
  const raw = process.env.HAMSTER_TYPE
  if (!raw || ptys.size !== 1 || app.isPackaged) return
  const CR = String.fromCharCode(13)
  const LF = String.fromCharCode(10)
  const delay = Number(process.env.HAMSTER_TYPE_DELAY ?? 1500)
  raw.split('|').forEach((step, i) => {
    const text = step
      .split('\\r')
      .join(CR)
      .split('\\n')
      .join(LF)
      .replace(/\\x([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))) // \x03 = Ctrl+C, \x15 = Ctrl+U, \x1b = Esc
    setTimeout(() => {
      // HAMSTER_TYPE_VIA=renderer feeds the keystrokes through xterm (so the effort interceptor sees them)
      if (process.env.HAMSTER_TYPE_VIA === 'renderer') send('debug:type', handle.id, text)
      else {
        handle.write(text)
        ptyLogInput(text) // the renderer path logs on its way back in through `pty:input`
      }
    }, delay * (i + 1))
  })
}

// ---- IPC: terminals

/**
 * debug/e2e: `HAMSTER_PTY_LOG=<file>` keeps everything the shells print, verbatim, and everything
 * written *into* them as a line of its own — `>> \x15/compact`, then `>> \r` — with the control
 * characters spelled out. The output alone cannot prove that a button sent Ctrl+U, the command and
 * Enter as the chunks it claims to: the shell echoes none of that back in a readable form.
 * Synchronous on purpose, so the file keeps the order things happened in. It holds whatever was
 * typed, passwords included, which is one more reason it does not exist in a packaged build.
 */
function ptyLog(text: string): void {
  const file = process.env.HAMSTER_PTY_LOG
  if (!file || debugOff()) return
  try {
    appendFileSync(file, text)
  } catch {
    /* a log that cannot be written must not take the terminal down with it */
  }
}

/** `\x15/compact` for Ctrl+U + "/compact", `\r` for Enter: every control character made visible. */
function visible(data: string): string {
  let out = ''
  for (const ch of data) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '\\') out += '\\\\'
    else if (code === 13) out += '\\r'
    else if (code === 10) out += '\\n'
    else if (code === 9) out += '\\t'
    else if (code < 32 || code === 127) out += '\\x' + code.toString(16).padStart(2, '0')
    else out += ch
  }
  return out
}

const ptyLogInput = (data: string): void => ptyLog(`\n>> ${visible(data)}\n`)

ipcMain.handle('pty:create', (_e, cols: number, rows: number, cwd?: string, profileId?: string) => {
  // an account that has been forgotten since the tab was stored falls back to the default one
  const profiles = loadProfiles()
  const profile = profiles.list.find((p) => p.id === profileId) ?? profiles.list[0]
  const detector = new PromptDetector((reason) => emitDesk({ kind: 'waiting', ptyId: handle.id, reason, ts: Date.now() }))
  const handle = spawnPty(
    cols,
    rows,
    (data) => {
      send('pty:data', handle.id, data)
      detector.feed(data)
      ptyLog(data)
    },
    (code) => {
      ptys.delete(handle.id)
      ptyProfile.delete(handle.id)
      if (process.env.HAMSTER_CAPTURE) console.log(`[pty] exit ${handle.id} code=${code}`)
      send('pty:exit', handle.id, code)
    },
    process.env.HAMSTER_CWD ?? cwd, // HAMSTER_CWD: debug/e2e override
    profile.dir,
  )
  ptys.set(handle.id, handle)
  ptyProfile.set(handle.id, profile.id)
  // a blind run cannot see a shell being respawned; this is how it says so
  if (process.env.HAMSTER_CAPTURE) console.log(`[pty] create ${handle.id} ${handle.cwd} profile=${profile.id}`)
  autoType(handle)
  // a claude started in this shell shows up in ~/.claude/sessions a few seconds later; poll a bit sooner
  for (const ms of [3000, 6000, 10000]) setTimeout(rescanAll, ms)
  return { id: handle.id, pid: handle.pid, shell: handle.shell, cwd: handle.cwd, profileId: profile.id }
})

ipcMain.on('pty:input', (_e, id: number, data: string) => {
  ptys.get(id)?.write(data)
  ptyLogInput(data)
  if (data.includes(String.fromCharCode(13)) || data.includes(String.fromCharCode(27))) {
    emitDesk({ kind: 'waiting_clear', ptyId: id, ts: Date.now() })
  }
})

ipcMain.on('pty:resize', (_e, id: number, cols: number, rows: number) => {
  ptys.get(id)?.resize(cols, rows)
})

ipcMain.on('pty:kill', (_e, id: number) => {
  ptys.get(id)?.kill()
  ptys.delete(id)
})

// ---- IPC: desk data

ipcMain.handle('desk:sessions', () => liveSessions())
ipcMain.handle('desk:backlog', (_e, after: number) => backlog.filter((b) => b.seq > after))

// ---- IPC: accounts (electron/profiles.ts)
// An account is a config folder. Adding one only makes an empty folder under ~/.hamster-desk;
// forgetting one never deletes anything. The default account's folder is never written to here.

ipcMain.handle('profiles:list', () => withEmails(loadProfiles()))
ipcMain.handle('profiles:add', (_e, name: string) => {
  const { state, added } = addProfile(String(name ?? ''))
  watchProfile(added)
  return withEmails(state)
})
ipcMain.handle('profiles:rename', (_e, id: string, name: string) => withEmails(renameProfile(String(id ?? ''), String(name ?? ''))))
ipcMain.handle('profiles:remove', (_e, id: string) => {
  const { state, removed } = removeProfile(String(id ?? ''))
  if (removed) {
    // everything that holds the folder open has to let go first: the watcher's handles, then the
    // shells (and the claude inside them) that were started under this account
    unwatchProfile(removed.id)
    for (const [ptyId, pid] of ptyProfile) {
      if (pid !== removed.id) continue
      ptys.get(ptyId)?.kill()
      ptys.delete(ptyId)
      ptyProfile.delete(ptyId)
    }
    deleteProfileDir(removed)
  }
  return withEmails(state)
})
ipcMain.handle('profiles:setCurrent', (_e, id: string) => withEmails(setCurrentProfile(String(id ?? ''))))
ipcMain.handle('profiles:openFolder', (_e, id: string) => shell.openPath(baseDirOf(String(id ?? ''))))

// ---- IPC: status line (usage), version, dialogs
// Each account has its own settings.json, so the status line is switched on per account.

ipcMain.handle('statusline:state', (_e, profileId?: string) => statusLineState(configDirOf(profileId)))
ipcMain.handle('statusline:install', (_e, profileId?: string) => {
  installStatusLine(configDirOf(profileId))
  return statusLineState(configDirOf(profileId))
})
ipcMain.handle('statusline:uninstall', (_e, profileId?: string) => {
  uninstallStatusLine(configDirOf(profileId))
  return statusLineState(configDirOf(profileId))
})

ipcMain.handle('version:check', async (_e, force?: boolean) => {
  const v = await checkVersion(force === true)
  emitDesk({ kind: 'version', ...v })
  return v
})

// ---- IPC: the app's own updates (electron/app-update.ts)

/** the checkout a packaged build can rebuild itself from; a dev run is updated by whoever runs it */
const selfUpdateRepo = (): string | null => (app.isPackaged ? repoDirOf(process.execPath, app.getAppPath(), true) : null)

/** an installed build follows GitHub Releases (electron/app-release.ts); every other kind follows commits */
const installedBuild = (): boolean => isInstalled(process.execPath, app.isPackaged)
const emitRelease = (): void => emitDesk({ kind: 'app_update', ...releaseInfo(app.getVersion(), buildCommit()) })

/** a check that failed is tried again by itself: a PC that just woke up has no network for a while */
const UPDATE_RETRY_MS = [20_000, 60_000, 180_000]
let updateRetries = 0
let updateRetryTimer: ReturnType<typeof setTimeout> | null = null
/** not failures: there is simply nothing to compare this build with */
const BENIGN_UPDATE_ERRORS = new Set(['no build commit', 'unknown commit'])

/**
 * `force`: skip the hour-long cache. `manual`: the user pressed "check again", so the retry ladder
 * starts over — a retry itself forces but is not manual, or it would reset its own count for ever.
 */
async function appUpdate(force = false, manual = force): Promise<AppUpdateInfo> {
  if (installedBuild()) {
    await checkRelease(emitRelease, app.getVersion(), manual) // emits and retries by itself, now and as the download moves along
    return releaseInfo(app.getVersion(), buildCommit())
  }
  if (manual) updateRetries = 0
  if (updateRetryTimer) clearTimeout(updateRetryTimer)
  updateRetryTimer = null
  const repo = selfUpdateRepo()
  const u = { ...(await checkAppUpdate(force, repo !== null, repo)), version: app.getVersion() }
  emitDesk({ kind: 'app_update', ...u })
  if (u.error && !BENIGN_UPDATE_ERRORS.has(u.error) && updateRetries < UPDATE_RETRY_MS.length) {
    updateRetryTimer = setTimeout(() => void appUpdate(true, false), UPDATE_RETRY_MS[updateRetries++])
  }
  return u
}

ipcMain.handle('appUpdate:check', (_e, force?: boolean) => appUpdate(force === true))

/** 'updating': the app is about to quit and come back rebuilt. 'opened': the commits page, to update by hand. */
ipcMain.handle('appUpdate:run', () => {
  // installed: the downloaded setup runs silently once we are gone, and reopens the app
  if (installedBuild() && installRelease()) return 'updating'
  const repoDir = selfUpdateRepo()
  if (repoDir && startSelfUpdate({ repoDir, exe: process.execPath, pid: process.pid, home: HAMSTER_HOME })) {
    setTimeout(() => app.quit(), 200) // let this reply reach the renderer first
    return 'updating'
  }
  void shell.openExternal(COMMITS_URL)
  return 'opened'
})

// the renderer says when the app is on screen and usable; that closes the boot log's line
ipcMain.on('boot:done', () => {
  bootMark('booted')
  // same rule as window-state.ts and the saved tabs: a capture run writes nothing to the user's folder
  if (process.env.HAMSTER_CAPTURE) return
  const head = `${app.getVersion()} ${buildCommit()?.slice(0, 7) ?? 'nocommit'} ${app.isPackaged ? 'packaged' : 'dev'}`
  writeBootLog(head, process.getCreationTime())
})

// ---- IPC: folder browser

const SKIP_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information', '.git', 'windows'])

ipcMain.handle('fs:listDirs', async (_e, p: string) => {
  const { promises: fsp, existsSync } = await import('node:fs')
  const { join, dirname, resolve } = await import('node:path')
  const path = resolve(String(p || ''))
  const parentRaw = dirname(path)
  const parent = parentRaw === path ? null : parentRaw
  try {
    const ents = await fsp.readdir(path, { withFileTypes: true })
    const dirs = ents
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase()))
      .slice(0, 500)
      .map((e) => {
        const full = join(path, e.name)
        return { name: e.name, path: full, git: existsSync(join(full, '.git')), claude: existsSync(join(full, 'CLAUDE.md')) || existsSync(join(full, '.claude')) }
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
    return { path, parent, dirs, error: null }
  } catch (e) {
    return { path, parent, dirs: [], error: (e as Error).message }
  }
})

/** Like fs:listDirs but folders *and* files — the folder panel doubles as a small file browser. */
ipcMain.handle('fs:list', async (_e, p: string) => {
  const { promises: fsp, existsSync } = await import('node:fs')
  const { extname, join, dirname, resolve } = await import('node:path')
  const path = resolve(String(p || ''))
  const parentRaw = dirname(path)
  const parent = parentRaw === path ? null : parentRaw
  const byName = (a: { name: string }, b: { name: string }): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  try {
    const ents = await fsp.readdir(path, { withFileTypes: true })
    const dirs = ents
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase()))
      .slice(0, 500)
      .map((e) => {
        const full = join(path, e.name)
        return { name: e.name, path: full, git: existsSync(join(full, '.git')), claude: existsSync(join(full, 'CLAUDE.md')) || existsSync(join(full, '.claude')) }
      })
      .sort(byName)
    const files: FileEntry[] = []
    for (const e of ents) {
      if (files.length >= 500) break
      if (!e.isFile() || e.name.startsWith('.')) continue
      const full = join(path, e.name)
      let size = 0
      let mtime = 0
      try {
        const st = await fsp.stat(full)
        size = st.size
        mtime = st.mtimeMs
      } catch {
        /* vanished or unreadable; still list the name */
      }
      files.push({ name: e.name, path: full, size, mtime, ext: extname(e.name).replace(/^\./, '').toLowerCase() })
    }
    files.sort(byName)
    return { path, parent, dirs, files, error: null }
  } catch (e) {
    return { path, parent, dirs: [], files: [], error: (e as Error).message }
  }
})

/** Which of these folders are still there — the recent list greys out the ones that are gone. */
ipcMain.handle('fs:exists', async (_e, paths: unknown) => {
  const { existsSync } = await import('node:fs')
  const out: Record<string, boolean> = {}
  if (!Array.isArray(paths)) return out
  for (const p of paths.slice(0, 200)) {
    if (typeof p !== 'string' || !p) continue
    try {
      out[p] = existsSync(p)
    } catch {
      out[p] = false
    }
  }
  return out
})

ipcMain.handle('fs:openPath', (_e, p: string) => shell.openPath(String(p || '')))
ipcMain.on('fs:showInFolder', (_e, p: string) => shell.showItemInFolder(String(p || '')))

ipcMain.handle('fs:drives', async () => {
  if (process.platform !== 'win32') return ['/']
  const { existsSync } = await import('node:fs')
  const out: string[] = []
  for (let c = 65; c <= 90; c++) {
    const d = `${String.fromCharCode(c)}:\\`
    if (existsSync(d)) out.push(d)
  }
  return out
})

// ---- IPC: clipboard (the preload runs sandboxed and cannot reach the clipboard itself)

ipcMain.handle('clipboard:readText', () => clipboard.readText())
ipcMain.on('clipboard:writeText', (_e, text: string) => clipboard.writeText(String(text ?? '')))

// ---- IPC: speech bubble summaries (headless claude -p, see electron/summarize.ts)

function summarizer(): BubbleSummarizer {
  if (!bubbles) bubbles = new BubbleSummarizer()
  return bubbles
}

ipcMain.handle('bubble:summarize', (_e, req: BubbleRequest) => summarizer().summarize(req))
ipcMain.handle('bubble:state', () => summarizer().state())
ipcMain.handle('bubble:resetStats', () => summarizer().reset())

// ---- IPC: UI settings (~/.hamster-desk/ui.json — outside the per-run-mode Electron profile)

ipcMain.handle('ui:load', () => loadUi())
ipcMain.handle('ui:save', (_e, patch: UiState) => saveUi(patch))

ipcMain.handle('dialog:pickFolder', async (_e, defaultPath?: string) => {
  if (!win) return null
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath, title: '터미널을 열 폴더' })
  return r.canceled ? null : (r.filePaths[0] ?? null)
})

ipcMain.on('win:alwaysOnTop', (_e, on: boolean) => {
  // mini mode pins the window itself; the renderer keeps re-sending `mini || prefs.onTop`, and an
  // `onTop:false` that slipped through mid-mini would un-pin the one window that must stay up
  if (isMini() && !on) return
  win?.setAlwaysOnTop(on, 'floating')
})

ipcMain.on('win:opacity', (_e, v: number) => {
  win?.setOpacity(Math.min(1, Math.max(0.3, v)))
})

// ---- IPC: notifications and mini mode (electron/notify.ts, electron/window-state.ts)

ipcMain.handle('notify:show', (_e, req: NotifyRequest) => showNotification(req, win))
ipcMain.handle('win:mini', (_e, on: boolean) => setMini(win, on === true))

// ---- IPC: past conversations of a folder (electron/transcripts.ts)
// `live` is the set the watcher already knows is running, so the list can grey those rows out.

ipcMain.handle('transcripts:list', (_e, cwd: string, profileId?: string) =>
  listTranscripts(String(cwd ?? ''), new Set(liveSessions().map((s) => s.sessionId)), configDirOf(profileId) ?? undefined),
)

// ---- IPC: git, read-only (electron/git.ts)

ipcMain.handle('git:info', (_e, cwd: string) => gitInfo(String(cwd ?? '')))
ipcMain.handle('git:diff', (_e, cwd: string, file: string) => gitDiff(String(cwd ?? ''), String(file ?? '')))

/** `language` from ~/.claude/settings.json, verbatim (e.g. "한국어"); the renderer decides what to do with it. */
function claudeLanguage(): string | null {
  try {
    const j = JSON.parse(readFileSync(join(claudeDir(), 'settings.json'), 'utf8')) as { language?: unknown }
    return typeof j.language === 'string' && j.language ? j.language : null
  } catch {
    return null
  }
}

ipcMain.handle('app:info', () => {
  let debugPrefs: Record<string, unknown> | null = null
  if (process.env.HAMSTER_PREFS && !app.isPackaged) {
    try {
      debugPrefs = JSON.parse(process.env.HAMSTER_PREFS) // smoke tests: force UI prefs (e.g. open panels)
    } catch {
      debugPrefs = null
    }
  }
  return {
    version: app.getVersion(),
    platform: process.platform,
    home: app.getPath('home'),
    debugPrefs,
    // debug/e2e only: names one button the UI should press by itself once it exists, so a blind
    // capture run can prove a click really does what it claims (see scheduleCapture below)
    debugClick: app.isPackaged ? null : process.env.HAMSTER_CLICK ?? null,
    debugEvents: debugEvents(),
    debugClicks: debugClicks(),
    // debug/e2e: every shell is pinned to this folder, so restoring the real tabs is meaningless
    debugCwd: app.isPackaged ? null : process.env.HAMSTER_CWD ?? null,
    // debug/e2e: a capture run restores the stored tabs (that is what it photographs) but must
    // never write them back — same rule window-state.ts keeps for the bounds
    debugCapture: !app.isPackaged && !!process.env.HAMSTER_CAPTURE,
    unfocused: unfocusedStart(),
    claudeLanguage: claudeLanguage(),
    uiPath: uiPath(),
  }
})

// ---- debug: HAMSTER_CAPTURE=<png path> [HAMSTER_CAPTURE_DELAY=ms[,ms…]] [HAMSTER_CAPTURE_QUIT=1]
// Saves a screenshot of the window without anyone looking at the screen (used by the smoke test).
// A comma-separated delay list takes several shots in one run — `shot.png` then becomes
// `shot-1.png`, `shot-2.png`, … so before/after can be compared. A single delay keeps the plain
// file name, which is what every existing script and README command expects.
function scheduleCapture(): void {
  const target = process.env.HAMSTER_CAPTURE
  if (!target || app.isPackaged) return
  const delays = (process.env.HAMSTER_CAPTURE_DELAY ?? '4000')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b)
  if (delays.length === 0) delays.push(4000)
  const many = delays.length > 1
  const dot = target.lastIndexOf('.')
  const slash = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'))
  const nameFor = (i: number): string => {
    if (!many) return target
    return dot > slash ? `${target.slice(0, dot)}-${i + 1}${target.slice(dot)}` : `${target}-${i + 1}`
  }
  delays.forEach((delay, i) => {
    setTimeout(async () => {
      try {
        const img = await win?.webContents.capturePage()
        if (img) {
          const { writeFileSync } = await import('node:fs')
          const file = nameFor(i)
          writeFileSync(file, img.toPNG())
          console.log(`[capture] ${file}`)
        }
      } catch (e) {
        console.error('[capture] failed', e)
      }
      if (i === delays.length - 1 && process.env.HAMSTER_CAPTURE_QUIT === '1') {
        app.quit()
        // Safety net for the blind smoke test: if anything still holds the process 5 s after the
        // quit sequence, take it down rather than leaving an invisible electron.exe behind.
        setTimeout(() => app.exit(0), 5000).unref()
      }
    }, delay)
  })
}

/**
 * Tear down everything this process owns. Runs on `before-quit`, which is the only event every quit
 * path goes through: `window-all-closed` is NOT emitted when the quit was started by app.quit()
 * (the capture smoke, the menu, Cmd+Q), and the shells used to survive that — node-pty's ConPTY
 * handle then kept the main process alive after the `quit` event, leaving an invisible electron.exe
 * plus an orphaned pwsh/claude tree behind. Idempotent: the window-all-closed path calls it too.
 */
let shuttingDown = false
function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  persistWindowState(win) // quitting from mini mode stores the bounds mini took over, not 480×360
  flushUi() // a setting changed in the last 300 ms is still only in memory
  for (const p of ptys.values()) p.kill()
  ptys.clear()
  for (const w of watchers.values()) w.stop()
  watchers.clear()
  status?.stop()
  status = null
  bubbles?.dispose()
  bubbles = null
}

/**
 * A packaged build on Windows keeps its own shortcuts right (electron/shortcuts.ts): without it a
 * pinned exe and the window it starts are two taskbar buttons. Off the start-up path — it is a
 * handful of small COM calls, but nothing on screen waits for it.
 */
function scheduleShortcutRepair(): void {
  if (!app.isPackaged || process.platform !== 'win32') return
  setTimeout(() => {
    const fixed = repairShortcuts(
      // named after the exe, as Electron names the one it makes (a dev run's is "Electron.lnk", not the package name)
      { appData: app.getPath('appData'), name: basename(process.execPath, '.exe'), exe: process.execPath, aumid: appUserModelId(true), tempDir: app.getPath('temp') },
      {
        read: (p) => shell.readShortcutLink(p),
        write: (p, operation, details) => shell.writeShortcutLink(p, operation, details),
        list: listDir,
        exists: pathExists,
      },
    )
    if (fixed.length) console.log(`[shortcuts] repaired: ${fixed.join(', ')}`)
  }, 2000)
}

// ---- lifecycle
// Only the instance holding the lock registers these: after app.quit() a ready handler would
// still race to create a window.

if (gotLock) {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.whenReady().then(() => {
    bootMark('ready')
    // this app used to write agent files and settings.agent; take those back out once
    const legacy = cleanupLegacyHarness()
    if (legacy.length) console.log(`[legacy] removed collaboration-mode leftovers: ${legacy.join(', ')}`)
    createWindow()
    startWatchers()
    scheduleCapture()
    scheduleKeys()
    scheduleNotifyProbe()
    scheduleShortcutRepair()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => shutdown())

  app.on('window-all-closed', () => {
    shutdown()
    app.quit()
  })
}
