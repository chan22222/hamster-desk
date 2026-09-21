// electron/shortcuts.ts: which shortcuts get rewritten on a packaged start, and which are left alone.
// The shell calls are faked — what matters is the decision, and that a foreign shortcut is never touched.
// Paths are written with forward slashes and normalized by `resolve`, which is what the module does too.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import { repairShortcuts, samePath, startMenuShortcut, taskbarPinDir, type ShortcutInfo, type ShortcutIo } from '../../electron/shortcuts'

const APPDATA = resolve('C:/Users/me/AppData/Roaming')
const EXE = resolve('C:/work/hamster-desk/release/win-unpacked/Hamster Desk.exe')
/** where the old portable build unpacked itself to; long gone */
const DEAD = resolve('C:/Users/me/AppData/Local/Temp/3Jckl/Hamster Desk.exe')
/** another checkout of the app, still on disk */
const OTHER = resolve('D:/copy/hamster-desk/release/win-unpacked/Hamster Desk.exe')
const AUMID = 'kr.amag.hamsterdesk'
const OPTS = { appData: APPDATA, name: 'Hamster Desk', exe: EXE, aumid: AUMID }
const MENU = startMenuShortcut(APPDATA, 'Hamster Desk')
const PINS = taskbarPinDir(APPDATA)
const FIXED = { target: EXE, cwd: dirname(EXE), appUserModelId: AUMID }

function fakeShell(files: Record<string, ShortcutInfo>, onDisk: string[] = [EXE, OTHER]): { io: ShortcutIo; writes: [string, string, ShortcutInfo][] } {
  const writes: [string, string, ShortcutInfo][] = []
  const io: ShortcutIo = {
    read: (p) => {
      if (!files[p]) throw new Error('no such shortcut')
      return files[p]
    },
    write: (p, op, d) => {
      writes.push([p, op, d])
      return true
    },
    list: (dir) => Object.keys(files).filter((p) => dirname(p) === dir).map((p) => p.slice(dir.length + 1)),
    exists: (p) => onDisk.some((f) => samePath(f, p)),
  }
  return { io, writes }
}

test('samePath ignores case, slash direction and .. segments', () => {
  assert.ok(samePath('C:/A/b/../App.exe', 'c:/a/app.EXE'))
  assert.ok(!samePath('C:/a/App.exe', 'C:/b/App.exe'))
})

test('a Start-menu shortcut left by the portable build is pointed back at this exe', () => {
  const { io, writes } = fakeShell({ [MENU]: { target: DEAD, appUserModelId: AUMID } })
  assert.deepEqual(repairShortcuts(OPTS, io), ['start-menu:update'])
  assert.deepEqual(writes, [[MENU, 'update', FIXED]])
})

test('no Start-menu shortcut yet: one is created, so pinning the running window has something right to copy', () => {
  const { io, writes } = fakeShell({})
  assert.deepEqual(repairShortcuts(OPTS, io), ['start-menu:create'])
  assert.deepEqual(writes, [[MENU, 'create', FIXED]])
})

test('a pin copied from that dead shortcut lit up but started nothing: it starts this exe again', () => {
  const pin = join(PINS, 'Hamster Desk.lnk')
  const { io, writes } = fakeShell({ [MENU]: { target: EXE, appUserModelId: AUMID }, [pin]: { target: DEAD, appUserModelId: AUMID } })
  assert.deepEqual(repairShortcuts(OPTS, io), ['pin:Hamster Desk.lnk'])
  assert.deepEqual(writes, [[pin, 'update', FIXED]])
})

test('an exe pinned from Explorer has no id: it gets the one the window has, and nothing else is written', () => {
  const pin = join(PINS, 'Hamster Desk.lnk')
  const { io, writes } = fakeShell({
    [MENU]: { target: EXE, appUserModelId: AUMID },
    [pin]: { target: EXE.toUpperCase() }, // the shell is not consistent about case
    [join(PINS, 'Chrome.lnk')]: { target: resolve('C:/Program Files/Google/Chrome/chrome.exe') },
    [join(PINS, 'Gone.lnk')]: { target: resolve('C:/gone/app.exe') }, // dead, but not ours: no id
    [join(PINS, 'desktop.ini')]: { target: EXE },
  })
  assert.deepEqual(repairShortcuts(OPTS, io), ['pin:Hamster Desk.lnk'])
  assert.deepEqual(writes.map((w) => w[0]), [pin])
})

test('another copy of the app that still exists keeps its shortcuts', () => {
  const { io, writes } = fakeShell({ [MENU]: { target: OTHER, appUserModelId: AUMID }, [join(PINS, 'Hamster Desk.lnk')]: { target: OTHER, appUserModelId: AUMID } })
  assert.deepEqual(repairShortcuts(OPTS, io), [])
  assert.deepEqual(writes, [])
})

test('everything already right: nothing is written', () => {
  const { io, writes } = fakeShell({ [MENU]: { target: EXE, appUserModelId: AUMID }, [join(PINS, 'Hamster Desk.lnk')]: { target: EXE, appUserModelId: AUMID } })
  assert.deepEqual(repairShortcuts(OPTS, io), [])
  assert.deepEqual(writes, [])
})

test('a shell that throws on every call never takes the start down', () => {
  const boom = (): never => {
    throw new Error('COM')
  }
  assert.deepEqual(repairShortcuts(OPTS, { read: boom, write: boom, list: boom, exists: boom }), [])
})
