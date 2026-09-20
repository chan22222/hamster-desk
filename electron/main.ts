import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DeskWatcher } from './watcher'
import type { BubbleRequest, DeskEvent, FileEntry, StatusSnapshot, UiState } from '../shared/events'
import { spawnPty, PromptDetector, type PtyHandle } from './pty'
import { StatusWatcher, installStatusLine, uninstallStatusLine, statusLineState } from './statusline'
import { flushUi, loadUi, saveUi, uiPath } from './ui-store'
import { checkVersion } from './version'
import { BubbleSummarizer } from './summarize'
import { cleanupLegacyHarness } from './legacy'
import { claudeDir } from './watcher/paths'

// The portable exe, `npm run dev` and the smoke runs all landed on the same %APPDATA%\hamster-desk
// profile: whichever started second could not lock the caches ("Unable to move the cache",
// "Gpu Cache Creation failed") and they overwrote each other's Local Storage (settings, recent
// folders). Give each run mode its own profile; the packaged app keeps the original path so
// existing users keep their settings. sessionData is set explicitly because Electron 28+ lets it
// sit apart from userData — caches and Local Storage follow sessionData, not userData.
// Must run before anything touches app.getPath/session, and before app.whenReady().
if (!app.isPackaged) {
  const profile = process.env.HAMSTER_CAPTURE
    ? join(app.getPath('temp'), 'hamster-desk-smoke')
    : join(app.getPath('appData'), 'hamster-desk-dev')
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
}

// A second copy of the packaged app would fight over that one profile, so it hands off to the
// running window instead of starting. dev/smoke runs have their own profiles and may overlap.
const gotLock = app.isPackaged ? app.requestSingleInstanceLock() : true
if (!gotLock) app.quit()

const ptys = new Map<number, PtyHandle>()
let win: BrowserWindow | null = null
let watcher: DeskWatcher | null = null
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

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: '#0e0f13',
    title: 'Hamster Desk',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.once('ready-to-show', () => win?.show())
  if (process.env.HAMSTER_CAPTURE) {
    // smoke tests run blind: surface renderer errors on stdout
    win.webContents.on('console-message', (ev) => {
      if (ev.level === 'error' || ev.level === 'warning') console.log(`[renderer:${ev.level}] ${ev.message}`)
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

function startWatchers(): void {
  watcher = new DeskWatcher({ ownedShells: () => [...ptys.values()].map((p) => ({ ptyId: p.id, pid: p.pid })) })
  watcher.on('event', (e: DeskEvent) => emitDesk(e))
  void watcher.start()

  status = new StatusWatcher()
  status.on('status', (s: StatusSnapshot) => emitDesk({ kind: 'status', ...s }))
  status.start()

  const version = (force = false): void => {
    void checkVersion(force).then((v) => emitDesk({ kind: 'version', ...v }))
  }
  version()
  setInterval(() => version(), 60 * 60 * 1000)
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
      else handle.write(text)
    }, delay * (i + 1))
  })
}

// ---- IPC: terminals

ipcMain.handle('pty:create', (_e, cols: number, rows: number, cwd?: string) => {
  const detector = new PromptDetector((reason) => emitDesk({ kind: 'waiting', ptyId: handle.id, reason, ts: Date.now() }))
  const handle = spawnPty(
    cols,
    rows,
    (data) => {
      send('pty:data', handle.id, data)
      detector.feed(data)
      if (process.env.HAMSTER_PTY_LOG) void import('node:fs').then((fs) => fs.appendFileSync(process.env.HAMSTER_PTY_LOG!, data))
    },
    (code) => {
      ptys.delete(handle.id)
      send('pty:exit', handle.id, code)
    },
    process.env.HAMSTER_CWD ?? cwd, // HAMSTER_CWD: debug/e2e override
  )
  ptys.set(handle.id, handle)
  autoType(handle)
  // a claude started in this shell shows up in ~/.claude/sessions a few seconds later; poll a bit sooner
  for (const ms of [3000, 6000, 10000]) setTimeout(() => void watcher?.rescan(), ms)
  return { id: handle.id, pid: handle.pid, shell: handle.shell, cwd: handle.cwd }
})

ipcMain.on('pty:input', (_e, id: number, data: string) => {
  ptys.get(id)?.write(data)
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

ipcMain.handle('desk:sessions', () => watcher?.liveSessions ?? [])
ipcMain.handle('desk:backlog', (_e, after: number) => backlog.filter((b) => b.seq > after))

// ---- IPC: status line (usage), version, dialogs

ipcMain.handle('statusline:state', () => statusLineState())
ipcMain.handle('statusline:install', () => {
  installStatusLine()
  return statusLineState()
})
ipcMain.handle('statusline:uninstall', () => {
  uninstallStatusLine()
  return statusLineState()
})

ipcMain.handle('version:check', async (_e, force?: boolean) => {
  const v = await checkVersion(force === true)
  emitDesk({ kind: 'version', ...v })
  return v
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
  win?.setAlwaysOnTop(on, 'floating')
})

ipcMain.on('win:opacity', (_e, v: number) => {
  win?.setOpacity(Math.min(1, Math.max(0.3, v)))
})

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
    claudeLanguage: claudeLanguage(),
    uiPath: uiPath(),
  }
})

// ---- debug: HAMSTER_CAPTURE=<png path> [HAMSTER_CAPTURE_DELAY=ms] [HAMSTER_CAPTURE_QUIT=1]
// Saves a screenshot of the window without anyone looking at the screen (used by the smoke test).
function scheduleCapture(): void {
  const target = process.env.HAMSTER_CAPTURE
  if (!target || app.isPackaged) return
  const delay = Number(process.env.HAMSTER_CAPTURE_DELAY ?? 4000)
  setTimeout(async () => {
    try {
      const img = await win?.webContents.capturePage()
      if (img) {
        const { writeFileSync } = await import('node:fs')
        writeFileSync(target, img.toPNG())
        console.log(`[capture] ${target}`)
      }
    } catch (e) {
      console.error('[capture] failed', e)
    }
    if (process.env.HAMSTER_CAPTURE_QUIT === '1') {
      app.quit()
      // Safety net for the blind smoke test: if anything still holds the process 5 s after the
      // quit sequence, take it down rather than leaving an invisible electron.exe behind.
      setTimeout(() => app.exit(0), 5000).unref()
    }
  }, delay)
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
  flushUi() // a setting changed in the last 300 ms is still only in memory
  for (const p of ptys.values()) p.kill()
  ptys.clear()
  watcher?.stop()
  watcher = null
  status?.stop()
  status = null
  bubbles?.dispose()
  bubbles = null
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
    // this app used to write agent files and settings.agent; take those back out once
    const legacy = cleanupLegacyHarness()
    if (legacy.length) console.log(`[legacy] removed collaboration-mode leftovers: ${legacy.join(', ')}`)
    createWindow()
    startWatchers()
    scheduleCapture()
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
