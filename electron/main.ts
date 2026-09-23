import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, powerMonitor, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { appendFileSync, promises as fsp, readdirSync, rmSync, type Dirent } from 'node:fs'
import { basename, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DeskWatcher } from './watcher'
import { DEFAULT_PROFILE_ID, type BubbleRequest, type DelegationState, type DeskEvent, type DirEntry, type FileEntry, type NotifyRequest, type Profile, type ProfilesState, type SessionInfo, type StatusSnapshot, type UiState, type AppUpdateInfo } from '../shared/events'
import { spawnPty, PromptDetector, type PtyHandle } from './pty'
import { WaitingGate } from './prompt'
import { HAMSTER_HOME, StatusWatcher, installStatusLine, uninstallStatusLine, statusLineState, refreshStatusScripts } from './statusline'
import { addProfile, adoptOrphanProfiles, baseDirOf, configDirOf, deleteProfileDir, loadProfiles, profileOfConfigDir, removeProfile, renameProfile, setCurrentProfile, showDefaultProfile, withEmails } from './profiles'
import { flushUi, loadUi, saveUi, setUiReadOnly, uiPath } from './ui-store'
import { checkVersion } from './version'
import { BubbleSummarizer } from './summarize'
import { FiveHourStarter } from './five-hour'
import { UsageQuerier } from './usage-query'
import { sanitizeConfig as sanitizeDelegation, storeConfig as storeDelegation, syncDelegation } from './delegation'
import { cleanupLegacyHarness } from './legacy'
import { claudeLanguage, tr } from './lang'
import { openFromNotification, showNotification } from './notify'
import { ToastHost } from './toast-window'
import { attachWindowStateSaver, isMini, persistWindowState, readWindowState, setMini } from './window-state'
import { listTranscripts } from './transcripts'
import { detectProject } from './project-actions'
import { gitDiff, gitInfo } from './git'
import { COMMITS_URL, buildCommit, checkAppUpdate, repoDirOf, startSelfUpdate } from './app-update'
import { checkRelease, downloadRelease, installRelease, isInstalled, releaseInfo } from './app-release'
import { bootMark, logError, writeBootLog } from './boot-log'
import { EventBacklog, type SeqEvent } from './backlog'
import { appUserModelId, listDir, pathExists, repairShortcuts } from './shortcuts'

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
    // The profile is private to this run; ~/.hamster-desk/ui.json is not — it is the same file the
    // installed app beside this run keeps its accounts and favourites in (the capture recipes in
    // docs/development.md are run without a HAMSTER_HOME of their own more often than not). A
    // capture run restores from it and
    // never writes to it: not the tabs, not the window, and not a preference the renderer migrates
    // or a folder a scripted click opens either — this switch covers every key at the source.
    setUiReadOnly(true)
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
    process.env.HAMSTER_MOUSE ||
    process.env.HAMSTER_UNFOCUSED
  )
if (blindRun) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// No application menu. Electron installs a default one when nobody says otherwise, and hiding its
// bar (autoHideMenuBar) does not switch off its accelerators: Ctrl+W closed the window, Ctrl+R
// reloaded it — every terminal gone — and Ctrl+/-/0 zoomed the page on top of the font-size
// shortcuts. In a terminal those keys belong to the shell: Ctrl+W deletes a word in PSReadLine and
// in Claude Code's input line (which is why closing a tab is Ctrl+Shift+W, src/shortcuts.ts), and
// Ctrl+R searches the history. Every shortcut this app has is handled in the renderer. Copy and
// paste in text boxes do not need a menu on Windows. Set before 'ready', so the default one is
// never even built.
Menu.setApplicationMenu(null)

// A second copy of the packaged app would fight over that one profile, so it hands off to the
// running window instead of starting. dev/smoke runs have their own profiles and may overlap.
const gotLock = app.isPackaged ? app.requestSingleInstanceLock() : true
if (!gotLock) app.quit()

// The taskbar groups windows under an Application User Model ID, and a pinned button lights up
// only for a window carrying the shortcut's id (electron/shortcuts.ts). Set before any window.
app.setAppUserModelId(appUserModelId(app.isPackaged))

const ptys = new Map<number, PtyHandle>()
/** pty id → the account its shell was started under */
const ptyProfile = new Map<number, string>()
let win: BrowserWindow | null = null
/** the app's own notification window (electron/toast-window.ts); a click there is a notification click */
const toasts = new ToastHost({
  onClick: (item) => openFromNotification(win, item.tab),
  // the mini window owns the corner the cards go to; they stack above it then
  avoid: () => (win && !win.isDestroyed() && isMini() ? win.getBounds() : null),
  log: (line) => {
    if (process.env.HAMSTER_CAPTURE) console.log(line)
  },
})
/** one watcher per account (profile id → watcher): each account has its own sessions/ and projects/ */
const watchers = new Map<string, DeskWatcher>()
let status: StatusWatcher | null = null
let bubbles: BubbleSummarizer | null = null
let fiveHour: FiveHourStarter | null = null
let usageQuery: UsageQuerier | null = null

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

// Events carry a sequence number and are kept (electron/backlog.ts), so a renderer that mounts (or
// reloads) after the watcher already streamed the catch-up can replay them and skip duplicates —
// and still gets every session, title and status line the ring has since dropped.
const backlog = new EventBacklog()

/**
 * Sent once per turn of the event loop rather than one message each: a catch-up is thousands of
 * events in a burst. preload.ts hands them on one by one, so the renderer sees no difference.
 */
let outbox: SeqEvent[] = []
function flushOutbox(): void {
  const items = outbox
  outbox = []
  send('desk:events', items)
}

function emitDesk(ev: DeskEvent): void {
  outbox.push(backlog.push(ev))
  if (outbox.length === 1) setImmediate(flushOutbox)
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
 * `HAMSTER_MOUSE='412,236@6000|…'` — the pointer put at a content-area pixel, as a real
 * `mousemove`, so whatever answers to hovering (the wall prints in the studio: cursor, lift,
 * caption) is proven on the path the user's mouse takes rather than through a hook.
 */
function scheduleMouse(): void {
  if (debugOff() || !process.env.HAMSTER_MOUSE) return
  for (const step of process.env.HAMSTER_MOUSE.split('|')) {
    const s = step.trim()
    if (!s) continue
    const i = s.lastIndexOf('@')
    const parsed = i < 0 ? NaN : Number(s.slice(i + 1))
    const at = Number.isFinite(parsed) ? parsed : 5000
    const [x, y] = (i < 0 ? s : s.slice(0, i)).split(',').map((v) => Number(v.trim()))
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    setTimeout(() => {
      const wc = win?.webContents
      if (!wc) return
      if (!unfocusedStart()) win?.focus() // same caveat as the keys: input only lands in a focused window
      wc.sendInputEvent({ type: 'mouseMove', x, y })
      console.log(`[mouse] ${x},${y}`)
    }, at)
  }
}

// ---- the window stays on this app's own pages
// Chromium opens a file dropped on a page in place of the page, and a link dragged in from a browser
// the same way. The tabs were then gone with no way back (there is no menu, and nothing is bound to
// Ctrl+R) — and the page the window had landed on was handed the whole bridge, because preload.ts
// runs for whatever page is loaded, and that bridge starts shells and types into them. So no page
// navigates anywhere but to a page of ours, none opens a window of its own (a web link goes to the
// browser), none is granted a browser permission, and every IPC channel below asks who is calling.

/** where the pages come from: the files next to this one, or the dev server of a dev run */
const RENDERER_DIR = join(__dirname, '../renderer')
const devOrigin = ((): string | null => {
  const url = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  try {
    return url ? new URL(url).origin : null
  } catch {
    return null
  }
})()

let lastUrl = ''
let lastUrlOurs = false
/** A page this app loads itself (index.html, the notification window's page). Remembered for the last URL asked: `pty:input` asks on every key. */
function isAppUrl(url: string): boolean {
  if (url === lastUrl) return lastUrlOurs
  let ours = false
  try {
    const u = new URL(url)
    if (devOrigin && u.origin === devOrigin) ours = true
    else if (u.protocol === 'file:') {
      const rel = relative(RENDERER_DIR, fileURLToPath(u))
      ours = !!rel && !rel.startsWith('..') && !isAbsolute(rel)
    }
  } catch {
    ours = false
  }
  lastUrl = url
  lastUrlOurs = ours
  return ours
}

const isWebUrl = (url: string): boolean => {
  try {
    const p = new URL(url).protocol
    return p === 'https:' || p === 'http:'
  } catch {
    return false
  }
}

app.on('web-contents-created', (_e, wc) => {
  const stay = (e: Electron.Event, url: string): void => {
    if (isAppUrl(url)) return // a reload — the dev server's own included
    e.preventDefault()
    if (process.env.HAMSTER_CAPTURE) console.log(`[nav] blocked ${url.slice(0, 200)}`)
  }
  wc.on('will-navigate', stay)
  wc.on('will-redirect', stay)
  // `window.open` (the studio's wall prints) goes to the browser — a web address only: anything else
  // (file:, a custom protocol) would be an app or a program started by name
  wc.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
})

/**
 * The caller is a page of ours. With the navigation lock above there is no other page to call; this
 * is the second line, for the channels that start shells, type into them and delete accounts.
 */
function fromApp(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  try {
    const url = e.senderFrame?.url
    return !!url && isAppUrl(url)
  } catch {
    return false // the frame is gone
  }
}

/** `ipcMain.handle` that answers pages of ours only (`fromApp`) */
function handle<A extends unknown[]>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromApp(e)) throw new Error(`${channel}: refused`)
    return fn(e, ...(args as A))
  })
}

/** `ipcMain.on`, likewise */
function listen<A extends unknown[]>(channel: string, fn: (e: IpcMainEvent, ...args: A) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (fromApp(e)) fn(e, ...(args as A))
  })
}

// ---- a renderer that dies takes its terminals' shells with it
// There is no way for a page to reattach to a shell another page started: after a crash (the GPU
// process taking WebGL down with it, out of memory) the window was white and every shell behind it —
// and the claude in it — ran on unseen. Now the shells go, and the page is loaded again and restores
// its tabs the way it does at every start.

/** a renderer that crashes this often is not helped by reloading it once more */
const RELOADS_MAX = 3
const RELOADS_WINDOW_MS = 60_000
const reloads: number[] = []

function onRendererGone(details: Electron.RenderProcessGoneDetails): void {
  // a window on its way out: shutdown() takes the shells, and waits for them
  if (details.reason === 'clean-exit' || shuttingDown) return
  logError('renderer', `gone: ${details.reason} (exit ${details.exitCode})`)
  void killAllPtys()
  if (!win || win.isDestroyed()) return
  const now = Date.now()
  while (reloads.length && now - reloads[0] > RELOADS_WINDOW_MS) reloads.shift()
  if (reloads.length >= RELOADS_MAX) return
  reloads.push(now)
  win.webContents.reload()
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
  // the taskbar button blinks and the popup cards stay while a notification is unanswered;
  // looking at the window answers it
  win.on('focus', () => {
    try {
      win?.flashFrame(false)
    } catch {
      /* the window went away between the event and here */
    }
    toasts.dismissAll()
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
  // the menu that carried DevTools is gone (see Menu.setApplicationMenu above); a dev run keeps the keys
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        e.preventDefault()
        win?.webContents.toggleDevTools()
      }
    })
  }
  // (window.open is handled for every page at once: see 'web-contents-created' above)
  win.webContents.on('render-process-gone', (_e, details) => onRendererGone(details))
  // whatever replaced the page — a reload after a crash, a dev server's full reload — the terminals
  // of the page that was there went with it, and nothing can reach their shells any more
  win.webContents.on('did-navigate', () => void killAllPtys())
  win.on('closed', () => {
    win = null
    toasts.dispose() // a card with no window to open is pointless
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
  w.on('event', (e: DeskEvent) => {
    emitDesk(e)
    questionFromTranscript(w, e)
  })
  watchers.set(p.id, w)
  void w.start()
}

/** "this terminal waits for an answer", from the screen text and from the transcript (electron/prompt.ts) */
const waitingGate = new WaitingGate((ptyId, reason, ts) => {
  if (process.env.HAMSTER_CAPTURE) console.log(`[waiting] pty=${ptyId} ${reason}`)
  emitDesk({ kind: 'waiting', ptyId, reason, ts })
})

/** A multiple-choice question in the transcript of a session that runs in one of our terminals. */
function questionFromTranscript(w: DeskWatcher, e: DeskEvent): void {
  if (e.kind !== 'tool' || e.name !== 'AskUserQuestion') return
  const ptyId = w.liveSessions.find((s) => s.sessionId === e.sessionId)?.ptyId
  if (ptyId == null || !ptys.has(ptyId)) return
  // a blind run says which witness saw it (the screen's is logged where the detector fires)
  if (process.env.HAMSTER_CAPTURE) console.log(`[waiting] transcript pty=${ptyId} AskUserQuestion ${Date.now() - e.ts}ms after it was asked`)
  waitingGate.asked(ptyId, e.ts)
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
 * The account list, read at most once a second for the snapshots: the status watcher's first scan
 * hands over every file in the folder at once, and each one used to read ui.json again to say whose
 * it is. A list a second old is good enough to tell one account from another.
 */
let profilesSeen: { at: number; state: ProfilesState } | null = null
function recentProfiles(): ProfilesState {
  const now = Date.now()
  if (!profilesSeen || now - profilesSeen.at > 1000) profilesSeen = { at: now, state: loadProfiles() }
  return profilesSeen.state
}

/**
 * Rate limits belong to an account, so a snapshot has to say whose it is. The status-line script
 * reports the `CLAUDE_CONFIG_DIR` it ran with; a file an older script wrote does not, and then the
 * session's own watcher is the next best witness.
 */
function profileOfSnapshot(s: StatusSnapshot): string {
  if (s.configDir !== undefined) return profileOfConfigDir(s.configDir, recentProfiles())
  for (const [id, w] of watchers) if (w.liveSessions.some((x) => x.sessionId === s.sessionId)) return id
  return DEFAULT_PROFILE_ID
}

/** Each of these on its own (`step`): one that fails does not keep the others from starting. */
function startWatchers(): void {
  step('accounts', () => {
    // accounts the list lost but whose folder (and login) is still on disk come back first
    const adopted = adoptOrphanProfiles()
    if (adopted.length) console.log(`[profiles] recovered: ${adopted.map((p) => p.id).join(', ')}`)
    for (const p of loadProfiles().list) watchProfile(p)
  })

  // every account's CLAUDE.md carries the "멀티 에이전트" block the stored config asks for (on by default)
  step('delegation', () => delegationSync(true))

  step('usage', () => {
    // the per-model weekly windows, asked of the CLI for every logged-in account (electron/usage-query.ts);
    // a capture run asks nothing — a blind screenshot must not spawn claudes under the user's logins
    usageQuery = new UsageQuerier({ accounts: () => withEmails(loadProfiles()).list.map((p) => ({ id: p.id, dir: p.dir, loggedIn: !!p.email })) })
    usageQuery.on('usage', (u) => emitDesk({ kind: 'usage_windows', ...u }))
    if (!process.env.HAMSTER_CAPTURE) usageQuery.start()
  })

  step('five-hour', () => {
    // before the status watcher: its first scan is what tells this when each account's window ends
    fiveHour = new FiveHourStarter({ accounts: () => loadProfiles().list.map((p) => ({ id: p.id, dir: p.dir })) })
    fiveHour.on('change', (s) => send('fiveHour:changed', s))
    // a capture run restores what is stored and writes nothing back — and sends nothing on anyone's account
    if (!process.env.HAMSTER_CAPTURE) fiveHour.start()
  })

  step('status', () => {
    refreshStatusScripts()
    status = new StatusWatcher()
    status.on('status', (s: StatusSnapshot) => {
      const profileId = profileOfSnapshot(s)
      fiveHour?.observe(profileId, s.fiveHour)
      emitDesk({ kind: 'status', ...s, profileId })
    })
    status.start()
  })

  step('version', () => {
    const version = (force = false): void => {
      void checkVersion(force).then((v) => emitDesk({ kind: 'version', ...v }))
    }
    version()
    setInterval(() => version(), 60 * 60 * 1000)
  })

  // Once, at start — and whenever the user asks (다시 확인). There used to be an hourly check too,
  // and it did more harm than good: a release found mid-session wanted a restart in the middle of
  // work, and (in an installed build) its blockmap download kept the disk busy under a running
  // claude. A version is picked up the next time the app is opened, which is soon enough.
  // A capture run photographs the window, and a pill that depends on the network is not repeatable.
  if (!process.env.HAMSTER_CAPTURE) void appUpdate().catch((e: unknown) => logError('app-update', e))
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

/** how long taking every shell down may hold a quit, a crash recovery or an account's delete up */
const KILL_CAP_MS = 3000

/**
 * Take every shell down, trees and all (pty.ts), in parallel; resolves when they have gone or after
 * `KILL_CAP_MS`, whichever is first. They are off the books at once: nothing more is written to them.
 */
function killAllPtys(): Promise<void> {
  const all = [...ptys.values()]
  ptys.clear()
  ptyProfile.clear()
  for (const h of all) waitingGate.forget(h.id)
  if (all.length === 0) return Promise.resolve()
  if (process.env.HAMSTER_CAPTURE) console.log(`[pty] killing ${all.length}`)
  return Promise.race([Promise.allSettled(all.map((h) => h.kill())).then(() => undefined), new Promise<void>((r) => setTimeout(r, KILL_CAP_MS).unref())])
}

handle('pty:create', (_e, cols: number, rows: number, cwd?: string, profileId?: string) => {
  if (shuttingDown) throw new Error('quitting')
  // an account that has been forgotten since the tab was stored falls back to the default one
  const profiles = loadProfiles()
  const profile = profiles.list.find((p) => p.id === profileId) ?? profiles.list[0]
  const detector = new PromptDetector((reason) => {
    if (process.env.HAMSTER_CAPTURE) console.log(`[waiting] screen pty=${handle.id} ${reason}`)
    waitingGate.waiting(handle.id, reason)
  })
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
      waitingGate.forget(handle.id)
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

const CR = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const CTRL_C = String.fromCharCode(3)
/** what xterm sends in front of pasted text while the program asked for bracketed paste */
const PASTE_START = `${ESC}[200~`

/**
 * Keys that answer (or dismiss) a prompt: Enter, Esc on its own, Ctrl+C. Not anything that merely
 * *contains* an Esc — the arrow keys that move through a prompt's choices are Esc sequences, and
 * clearing on those put the warning away (and the session bar's buttons back) while the prompt was
 * still up. Pasted text is not an answer either, whatever line breaks it carries.
 */
function answersPrompt(data: string): boolean {
  if (data.startsWith(PASTE_START)) return false
  return data === ESC || data.includes(CR) || data.includes(CTRL_C)
}

listen('pty:input', (_e, id: number, data: string) => {
  ptys.get(id)?.write(data)
  ptyLogInput(data)
  // only a terminal that was waiting has anything to clear; the others would re-render the whole
  // window for nothing, on every Enter
  if (answersPrompt(data) && waitingGate.answered(id)) emitDesk({ kind: 'waiting_clear', ptyId: id, ts: Date.now() })
})

listen('pty:resize', (_e, id: number, cols: number, rows: number) => {
  ptys.get(id)?.resize(cols, rows)
})

listen('pty:kill', (_e, id: number) => {
  const h = ptys.get(id)
  ptys.delete(id)
  ptyProfile.delete(id)
  waitingGate.forget(id)
  void h?.kill() // asynchronous: the other terminals keep printing while this one's tree goes
})

// ---- IPC: desk data

handle('desk:sessions', () => liveSessions())
handle('desk:backlog', (_e, after: number) => backlog.replay(Number(after) || 0))

// ---- IPC: accounts (electron/profiles.ts)
// An account is a config folder. Adding one only makes an empty folder under ~/.hamster-desk;
// forgetting one never deletes anything. The default account's folder is never written to here.

/** a line of an error the UI can show next to what failed */
const errorText = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 200)

/**
 * An account change that could not happen answers with the list as it now is and why, instead of an
 * exception the renderer can only swallow (preload.ts `ProfilesAnswer`).
 */
async function profilesAnswer(change: () => ProfilesState | Promise<ProfilesState>): Promise<ProfilesState & { error?: string }> {
  try {
    return withEmails(await change())
  } catch (e) {
    logError('profiles', e)
    return { ...withEmails(loadProfiles()), error: errorText(e) }
  }
}

handle('profiles:list', () => withEmails(loadProfiles()))
handle('profiles:add', (_e, name: string) =>
  profilesAnswer(() => {
    const { state, added } = addProfile(String(name ?? ''))
    watchProfile(added)
    delegationSync(true) // the new account's CLAUDE.md gets the block too
    return state
  }),
)
handle('profiles:rename', (_e, id: string, name: string) => profilesAnswer(() => renameProfile(String(id ?? ''), String(name ?? ''))))
handle('profiles:remove', (_e, id: string) =>
  profilesAnswer(async () => {
    const { state, removed } = removeProfile(String(id ?? ''))
    if (removed) {
      // everything that holds the folder open has to let go first: the watcher's handles, then the
      // shells (and the claude inside them) that were started under this account — and those have
      // to be *gone*, not just told to go, before the folder can be deleted
      unwatchProfile(removed.id)
      const kills: Promise<void>[] = []
      for (const [ptyId, pid] of ptyProfile) {
        if (pid !== removed.id) continue
        const h = ptys.get(ptyId)
        ptys.delete(ptyId)
        ptyProfile.delete(ptyId)
        waitingGate.forget(ptyId)
        if (h) kills.push(h.kill())
      }
      await Promise.race([Promise.allSettled(kills), new Promise<void>((r) => setTimeout(r, KILL_CAP_MS).unref())])
      deleteProfileDir(removed)
    }
    return state
  }),
)
handle('profiles:setCurrent', (_e, id: string) => profilesAnswer(() => setCurrentProfile(String(id ?? ''))))
/** the CLI's own account, taken off the list earlier, comes back — and is watched again */
handle('profiles:showDefault', () =>
  profilesAnswer(() => {
    const state = showDefaultProfile()
    const cli = state.list.find((p) => p.id === DEFAULT_PROFILE_ID)
    if (cli) watchProfile(cli)
    delegationSync(true)
    return state
  }),
)
handle('profiles:openFolder', (_e, id: string) => shell.openPath(baseDirOf(String(id ?? ''))))

// ---- IPC: status line (usage), version, dialogs
// Each account has its own settings.json, so the status line is switched on per account. A switch
// that could not happen — a settings.json that is there but cannot be read, or cannot be replaced —
// changes nothing and says why (preload.ts `StatusLineResult`).

function statusLineChange(profileId: string | undefined, change: (configDir: string | null) => void): { state: ReturnType<typeof statusLineState>; error: string | null } {
  const dir = configDirOf(profileId)
  try {
    change(dir)
    return { state: statusLineState(dir), error: null }
  } catch (e) {
    logError('statusline', e)
    return { state: statusLineState(dir), error: errorText(e) }
  }
}

handle('statusline:state', (_e, profileId?: string) => statusLineState(configDirOf(profileId)))
handle('statusline:install', (_e, profileId?: string) => statusLineChange(profileId, installStatusLine))
handle('statusline:uninstall', (_e, profileId?: string) => statusLineChange(profileId, uninstallStatusLine))

handle('version:check', async (_e, force?: boolean) => {
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
    await checkRelease(emitRelease, app.getVersion(), manual) // emits and retries by itself, now and as a download moves along
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

handle('appUpdate:check', (_e, force?: boolean) => appUpdate(force === true))

/**
 * 'updating': the app is about to quit and come back rebuilt. 'downloading': the release is on its
 * way down, and "update" has to be pressed again once it is there. 'opened': the commits page, to
 * update by hand.
 */
handle('appUpdate:run', () => {
  if (installedBuild()) {
    // installed: the downloaded setup runs with its progress window once we are gone, and reopens the app
    if (installRelease()) return 'updating'
    // …and nothing is downloaded before the user asks for it here
    if (downloadRelease(emitRelease)) return 'downloading'
  }
  const repoDir = selfUpdateRepo()
  if (repoDir && startSelfUpdate({ repoDir, exe: process.execPath, pid: process.pid, home: HAMSTER_HOME })) {
    setTimeout(() => app.quit(), 200) // let this reply reach the renderer first
    return 'updating'
  }
  void shell.openExternal(COMMITS_URL)
  return 'opened'
})

// the renderer says when the app is on screen and usable; that closes the boot log's line
listen('boot:done', () => {
  bootMark('booted')
  // same rule as window-state.ts and the saved tabs: a capture run writes nothing to the user's folder
  if (process.env.HAMSTER_CAPTURE) return
  const head = `${app.getVersion()} ${buildCommit()?.slice(0, 7) ?? 'nocommit'} ${app.isPackaged ? 'packaged' : 'dev'}`
  writeBootLog(head, process.getCreationTime())
})

// ---- IPC: folder browser

const SKIP_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information', '.git', 'windows'])
/** entries a listing takes, of each kind — the first 500 by name, not whichever the disk handed out first */
const LIST_MAX = 500
/**
 * Every probe below is asynchronous, a few at a time. They used to be `existsSync`, up to 1,500 of
 * them per folder listing, on the main thread — which also carries every terminal's output — and on
 * a network share that stopped answering each one waited out the SMB timeout. A few at a time also
 * leaves the rest of libuv's small thread pool to the watchers.
 */
const PROBES_AT_ONCE = 4
/** a drive that has not answered by then (a mapped share that is gone) is left off the list */
const DRIVE_PROBE_MS = 1500

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })

/** `fn` over `items`, `limit` at a time, the results in the items' order */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const exists = (p: string): Promise<boolean> => fsp.access(p).then(() => true, () => false)

/** the folders of a listing, each with whether it is a repository and whether Claude has been set up in it */
async function dirEntries(path: string, ents: Dirent[]): Promise<DirEntry[]> {
  const names = ents
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase()))
    .sort(byName)
    .slice(0, LIST_MAX)
  return mapLimit(names, PROBES_AT_ONCE, async (e) => {
    const full = join(path, e.name)
    return { name: e.name, path: full, git: await exists(join(full, '.git')), claude: (await exists(join(full, 'CLAUDE.md'))) || (await exists(join(full, '.claude'))) }
  })
}

handle('fs:listDirs', async (_e, p: string) => {
  const { dirname, resolve } = await import('node:path')
  const path = p ? resolve(String(p)) : browseHome()
  const parentRaw = dirname(path)
  const parent = parentRaw === path ? null : parentRaw
  try {
    const dirs = await dirEntries(path, await fsp.readdir(path, { withFileTypes: true }))
    return { path, parent, dirs, error: null }
  } catch (e) {
    return { path, parent, dirs: [], error: (e as Error).message }
  }
})

/**
 * Where a listing of "no folder in particular" goes. `path.resolve('')` is the process's working
 * directory, and that is the install folder for the packaged app and the repository for `npx
 * electron .` — the sidebar's 탐색 used to open there whenever it came up before the first tab did,
 * and that is a place nobody chose. Home is.
 */
const browseHome = (): string => app.getPath('home')

/** Like fs:listDirs but folders *and* files — the folder panel doubles as a small file browser. */
handle('fs:list', async (_e, p: string) => {
  const { extname, dirname, resolve } = await import('node:path')
  const path = p ? resolve(String(p)) : browseHome()
  const parentRaw = dirname(path)
  const parent = parentRaw === path ? null : parentRaw
  try {
    const ents = await fsp.readdir(path, { withFileTypes: true })
    const dirs = await dirEntries(path, ents)
    const names = ents.filter((e) => e.isFile() && !e.name.startsWith('.')).sort(byName).slice(0, LIST_MAX)
    const files: FileEntry[] = await mapLimit(names, PROBES_AT_ONCE, async (e) => {
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
      return { name: e.name, path: full, size, mtime, ext: extname(e.name).replace(/^\./, '').toLowerCase() }
    })
    return { path, parent, dirs, files, error: null }
  } catch (e) {
    return { path, parent, dirs: [], files: [], error: (e as Error).message }
  }
})

/** Which of these folders are still there — the recent list greys out the ones that are gone. */
handle('fs:exists', async (_e, paths: unknown) => {
  const out: Record<string, boolean> = {}
  if (!Array.isArray(paths)) return out
  const list = paths.slice(0, 200).filter((p): p is string => typeof p === 'string' && !!p)
  const found = await mapLimit(list, PROBES_AT_ONCE, exists)
  list.forEach((p, i) => (out[p] = found[i]))
  return out
})

handle('fs:openPath', (_e, p: string) => shell.openPath(String(p || '')))
listen('fs:showInFolder', (_e, p: string) => shell.showItemInFolder(String(p || '')))

/**
 * What kind of project the folder is and what can be run in it (electron/project-actions.ts). Asked
 * together with fs:list on every folder change, so it reads the folder's top level only and caches
 * on the markers' mtimes; no shell is spawned to find out.
 */
handle('fs:project', async (_e, p: string) => {
  const { resolve } = await import('node:path')
  return detectProject(p ? resolve(String(p)) : browseHome())
})

/** A..Z that are there. A mapped drive whose share is gone can take the SMB timeout to say so; it is left off, not waited for. */
handle('fs:drives', async () => {
  if (process.platform !== 'win32') return ['/']
  const letters = Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`)
  const probe = (d: string): Promise<boolean> =>
    Promise.race([exists(d), new Promise<boolean>((r) => setTimeout(() => r(false), DRIVE_PROBE_MS).unref())])
  const found = await mapLimit(letters, PROBES_AT_ONCE, probe)
  return letters.filter((_, i) => found[i])
})

// ---- IPC: clipboard (the preload runs sandboxed and cannot reach the clipboard itself)

handle('clipboard:readText', () => clipboard.readText())
listen('clipboard:writeText', (_e, text: string) => clipboard.writeText(String(text ?? '')))

// ---- IPC: speech bubble summaries (headless claude -p, see electron/summarize.ts)

function summarizer(): BubbleSummarizer {
  if (!bubbles) bubbles = new BubbleSummarizer()
  return bubbles
}

handle('bubble:summarize', (_e, req: BubbleRequest) => summarizer().summarize(req))
handle('bubble:state', () => summarizer().state())
handle('bubble:resetStats', () => summarizer().reset())

// ---- IPC: "멀티 에이전트" — the sub-agent instruction block in every account's CLAUDE.md (electron/delegation.ts)

/**
 * `write` brings each account's file in line with the stored config; without it this only reports.
 * A capture run never writes: its throw-away HAMSTER_HOME does not move the CLI's own ~/.claude.
 */
function delegationSync(write: boolean): DelegationState {
  const accounts = loadProfiles().list.map((p) => ({ id: p.id, dir: p.dir }))
  return syncDelegation(accounts, !write || !!process.env.HAMSTER_CAPTURE)
}

handle('delegation:get', () => delegationSync(false))
handle('delegation:set', (_e, config: unknown) => {
  storeDelegation(sanitizeDelegation(config))
  return delegationSync(true)
})

// ---- IPC: start the next 5-hour window as soon as the last one ends (electron/five-hour.ts, per account)

/** the usage popover's "다시 확인": ask the CLI now, for one account or all; the answers arrive as events */
handle('usage:refresh', (_e, profileId?: string) => (process.env.HAMSTER_CAPTURE ? [] : (usageQuery?.refresh(profileId ? String(profileId) : undefined) ?? [])))

handle('fiveHour:state', () => fiveHour?.state() ?? {})
handle('fiveHour:set', (_e, profileId: string, on: boolean) => fiveHour?.set(String(profileId ?? ''), on === true) ?? {})

// ---- IPC: UI settings (~/.hamster-desk/ui.json — outside the per-run-mode Electron profile)

handle('ui:load', () => loadUi())
// `base`: what the renderer's copy held before this patch, so a list it changed is merged into the
// file by difference (electron/ui-store.ts) instead of replacing what another process added
handle('ui:save', (_e, patch: UiState, base?: UiState) => saveUi(patch, base))

handle('dialog:pickFolder', async (_e, defaultPath?: string) => {
  if (!win) return null
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath, title: tr().main.pickFolder })
  return r.canceled ? null : (r.filePaths[0] ?? null)
})

listen('win:alwaysOnTop', (_e, on: boolean) => {
  // mini mode pins the window itself; the renderer keeps re-sending `mini || prefs.onTop`, and an
  // `onTop:false` that slipped through mid-mini would un-pin the one window that must stay up
  if (isMini() && !on) return
  win?.setAlwaysOnTop(on, 'floating')
})

listen('win:opacity', (_e, v: number) => {
  win?.setOpacity(Math.min(1, Math.max(0.3, v)))
})

// ---- IPC: notifications and mini mode (electron/notify.ts, electron/window-state.ts)

handle('notify:show', (_e, req: NotifyRequest) => showNotification(req, win, toasts))
handle('win:mini', (_e, on: boolean) => setMini(win, on === true))

// ---- IPC: past conversations of a folder (electron/transcripts.ts)
// `live` is the set the watcher already knows is running, so the list can grey those rows out.

handle('transcripts:list', (_e, cwd: string, profileId?: string) =>
  listTranscripts(String(cwd ?? ''), new Set(liveSessions().map((s) => s.sessionId)), configDirOf(profileId) ?? undefined),
)

// ---- IPC: git, read-only (electron/git.ts)

handle('git:info', (_e, cwd: string) => gitInfo(String(cwd ?? '')))
handle('git:diff', (_e, cwd: string, file: string) => gitDiff(String(cwd ?? ''), String(file ?? '')))

handle('app:info', () => {
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
    // debug/e2e: the boss starts its rounds the moment a colleague sits down (src/desk/patrol.ts),
    // so a capture can photograph the walk and the telling-off at known delays
    debugPatrol: !app.isPackaged && process.env.HAMSTER_PATROL === '1',
    unfocused: unfocusedStart(),
    claudeLanguage: claudeLanguage(),
    uiPath: uiPath(),
  }
})

// ---- debug: HAMSTER_CAPTURE=<png path> [HAMSTER_CAPTURE_DELAY=ms[,ms…]] [HAMSTER_CAPTURE_QUIT=1]
// Saves a screenshot of the window without anyone looking at the screen (used by the smoke test).
// A comma-separated delay list takes several shots in one run — `shot.png` then becomes
// `shot-1.png`, `shot-2.png`, … so before/after can be compared. A single delay keeps the plain
// file name, which is what every existing script and every recipe in docs/development.md expects.
// HAMSTER_CAPTURE_TOAST=<png path> photographs the notification window at the same moments
// (nothing is written while it has no cards up).
function scheduleCapture(): void {
  const target = process.env.HAMSTER_CAPTURE
  if (!target || app.isPackaged) return
  const toastTarget = process.env.HAMSTER_CAPTURE_TOAST
  const delays = (process.env.HAMSTER_CAPTURE_DELAY ?? '4000')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b)
  if (delays.length === 0) delays.push(4000)
  const many = delays.length > 1
  const nameFor = (base: string, i: number): string => {
    if (!many) return base
    const dot = base.lastIndexOf('.')
    const slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'))
    return dot > slash ? `${base.slice(0, dot)}-${i + 1}${base.slice(dot)}` : `${base}-${i + 1}`
  }
  const shoot = async (w: BrowserWindow | null | undefined, base: string, i: number): Promise<void> => {
    const img = await w?.webContents.capturePage()
    if (!img) return
    const { writeFileSync } = await import('node:fs')
    const file = nameFor(base, i)
    writeFileSync(file, img.toPNG())
    console.log(`[capture] ${file}`)
  }
  delays.forEach((delay, i) => {
    setTimeout(async () => {
      try {
        await shoot(win, target, i)
        if (toastTarget) await shoot(toasts.window(), toastTarget, i)
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
 * plus an orphaned pwsh/claude tree behind. Idempotent: every caller gets the one teardown.
 *
 * The shells go last and together, and the quit waits for them (at most `KILL_CAP_MS`): each one is a
 * `taskkill` of its tree, which used to run one after the other, synchronously, with nothing to stop
 * a hung one from holding the quit for ever.
 */
let shuttingDown = false
let teardown: Promise<void> | null = null
function shutdown(): Promise<void> {
  if (teardown) return teardown
  shuttingDown = true
  persistWindowState(win) // quitting from mini mode stores the bounds mini took over, not 480×360
  flushUi() // a setting changed in the last 300 ms is still only in memory
  for (const w of watchers.values()) w.stop()
  watchers.clear()
  status?.stop()
  status = null
  bubbles?.dispose()
  bubbles = null
  fiveHour?.stop()
  fiveHour = null
  usageQuery?.stop()
  usageQuery = null
  teardown = killAllPtys()
  return teardown
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

/**
 * One piece of the start-up. One that throws is logged (~/.hamster-desk/error.log, boot-log.ts) and
 * the rest still happen: a status folder that could not be made used to take the version check, the
 * update check, the shortcut repair and the resume handler down with it, without a word anywhere.
 */
function step(name: string, fn: () => void): void {
  try {
    fn()
  } catch (e) {
    logError(`start:${name}`, e)
  }
}

// Whatever no code of ours caught, anywhere in main, is written down and the app carries on.
// Electron's default for an uncaught exception is a modal error box over terminals that are, as far
// as anyone can tell, still working — and a rejection nobody handled left no trace at all.
process.on('uncaughtException', (e) => logError('uncaught', e))
process.on('unhandledRejection', (e) => logError('unhandled', e))

// Only the instance holding the lock registers these: after app.quit() a ready handler would
// still race to create a window.

if (gotLock) {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app
    .whenReady()
    .then(() => {
      bootMark('ready')
      // no page of ours asks the browser for a permission (camera, notifications, …): whoever does is refused
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
      step('legacy', () => {
        // this app used to write agent files and settings.agent; take those back out once
        const legacy = cleanupLegacyHarness()
        if (legacy.length) console.log(`[legacy] removed collaboration-mode leftovers: ${legacy.join(', ')}`)
      })
      createWindow()
      step('watchers', startWatchers)
      step('capture', scheduleCapture)
      step('keys', scheduleKeys)
      step('mouse', scheduleMouse)
      step('shortcuts', scheduleShortcutRepair)
      // every timer is late after a sleep; a window that ended meanwhile gets its message once the
      // network is back, not up to half a minute later
      powerMonitor.on('resume', () => setTimeout(() => void fiveHour?.tick(), 20_000))
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
    .catch((e: unknown) => logError('ready', e))

  // The quit is held until the teardown is done — the shells' trees are killed in parallel and
  // waited for (at most KILL_CAP_MS) — and then carries on by itself.
  let quitReady = false
  app.on('before-quit', (e) => {
    if (quitReady) return
    e.preventDefault()
    void shutdown().finally(() => {
      quitReady = true
      app.quit()
    })
  })

  app.on('window-all-closed', () => app.quit())
}
