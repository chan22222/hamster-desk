import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Keeps the app's Windows shortcuts pointing at — and filed under the same id as — the window.
 *
 * The taskbar puts a window on a pinned button only when both carry the same Application User
 * Model ID. This app sets one explicitly (electron/notify.ts, toasts need it), but there is no
 * installer to write it into a shortcut, so:
 *
 *  - an exe pinned from Explorer gets a shortcut with *no* id. Started from it, the app shows up as
 *    a second button next to the pinned one, which stays unlit;
 *  - Electron itself creates "<name>.lnk" under Start Menu/Programs, with the id, the first time a
 *    toast is shown — and never looks at it again. One made by the old portable build still points
 *    into the %TEMP% folder that build unpacked itself to. Pinning the *running* window copies that
 *    shortcut, dead target included: the pin lights up with the window, and does nothing when clicked.
 *
 * So on every packaged start a shortcut is rewritten when it is clearly ours and clearly wrong:
 * it starts this exe but lacks the id, or it carries the id but its exe is gone. One that starts
 * another copy of the app that still exists is left alone (two checkouts must not fight over it).
 * Only target/cwd/id are written — 'update' leaves the toast activator CLSID Electron put there.
 *
 * The `electron` calls come in through `io`, so the decisions below can be tested with tsx.
 */

export interface ShortcutInfo {
  target?: string
  appUserModelId?: string
}

export interface ShortcutIo {
  /** throws when the file is missing or not a shortcut */
  read(path: string): ShortcutInfo
  write(path: string, operation: 'create' | 'update', details: { target: string; cwd: string; appUserModelId: string }): boolean
  list(dir: string): string[]
  exists(path: string): boolean
}

/** Windows paths: case-insensitive, either slash, and a/../b is b */
export const samePath = (a: string, b: string): boolean => resolve(a).toLowerCase() === resolve(b).toLowerCase()

export const startMenuShortcut = (appData: string, name: string): string =>
  join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${name}.lnk`)

export const taskbarPinDir = (appData: string): string =>
  join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')

/** ours and wrong: starts this exe without the id, or has the id and an exe that no longer exists */
function needsRepair(s: ShortcutInfo, exe: string, aumid: string, io: ShortcutIo): boolean {
  if (s.target && samePath(s.target, exe)) return s.appUserModelId !== aumid
  return s.appUserModelId === aumid && (!s.target || !io.exists(s.target))
}

/** What was changed, for the log: 'start-menu:create' | 'start-menu:update' | 'pin:<file>' */
export function repairShortcuts(opts: { appData: string; name: string; exe: string; aumid: string }, io: ShortcutIo): string[] {
  const done: string[] = []
  const details = { target: opts.exe, cwd: dirname(opts.exe), appUserModelId: opts.aumid }

  const menu = startMenuShortcut(opts.appData, opts.name)
  let current: ShortcutInfo | null = null
  try {
    current = io.read(menu)
  } catch {
    current = null
  }
  try {
    // none yet: make it, so that pinning the running window has something right to copy
    if (!current) {
      if (io.write(menu, 'create', details)) done.push('start-menu:create')
    } else if (needsRepair(current, opts.exe, opts.aumid, io)) {
      if (io.write(menu, 'update', details)) done.push('start-menu:update')
    }
  } catch {
    /* a shortcut we cannot write is not worth failing a start over */
  }

  const pinDir = taskbarPinDir(opts.appData)
  let pins: string[] = []
  try {
    pins = io.list(pinDir).filter((f) => f.toLowerCase().endsWith('.lnk'))
  } catch {
    pins = [] // no such folder: nothing is pinned
  }
  for (const file of pins) {
    try {
      const path = join(pinDir, file)
      if (needsRepair(io.read(path), opts.exe, opts.aumid, io) && io.write(path, 'update', details)) done.push(`pin:${file}`)
    } catch {
      /* unreadable shortcut: leave it */
    }
  }
  return done
}

export const listDir = (dir: string): string[] => readdirSync(dir)
export const pathExists = (path: string): boolean => existsSync(path)
