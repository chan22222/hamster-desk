// The pure parts of the window work (plan §3.3, §3.10): what a saved placement has to look like
// before it is used again, where the mini window goes, and which tabs are worth remembering.
//
// `src/workspaces-persist.ts` pulls in the store, which reads `window` while it is still being
// evaluated — hence the dom-shim first line (see scripts/unit/dom-shim.ts).
import './dom-shim'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MINI_MARGIN, MINI_SIZE, MIN_SIZE, fitBounds, miniPlacement } from '../../electron/window-state'
import { readStoredWorkspaces, serializeWorkspaces } from '../../src/workspaces-persist'
import type { Workspace } from '../../src/store'

/** a 1920×1080 screen with the Windows taskbar along the bottom */
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 }

test('fitBounds keeps a placement that is still on the screen', () => {
  const saved = { x: 100, y: 100, width: 1000, height: 700, maximized: false }
  assert.deepEqual(fitBounds(saved, WORK_AREA), saved)
})

test('fitBounds carries the maximized flag through', () => {
  const got = fitBounds({ x: 0, y: 0, width: 1280, height: 880, maximized: true }, WORK_AREA)
  assert.equal(got?.maximized, true)
})

test('fitBounds drops a window that no longer meets a screen', () => {
  // the monitor it was on is gone: less than 100×100 of it is left inside the work area
  assert.equal(fitBounds({ x: 1900, y: 100, width: 1000, height: 700 }, WORK_AREA), null)
  assert.equal(fitBounds({ x: -980, y: 100, width: 1000, height: 700 }, WORK_AREA), null)
  assert.equal(fitBounds({ x: 100, y: 1030, width: 1000, height: 700 }, WORK_AREA), null)
})

test('fitBounds drops a size this window could never have had', () => {
  assert.equal(fitBounds({ x: 100, y: 100, width: MIN_SIZE.width - 1, height: 700 }, WORK_AREA), null)
  assert.equal(fitBounds({ x: 100, y: 100, width: 1000, height: MIN_SIZE.height - 1 }, WORK_AREA), null)
  // exactly the minimum is a real window
  assert.ok(fitBounds({ x: 100, y: 100, ...MIN_SIZE }, WORK_AREA))
})

test('fitBounds refuses anything that is not four numbers', () => {
  assert.equal(fitBounds(null, WORK_AREA), null)
  assert.equal(fitBounds('1000x700', WORK_AREA), null)
  assert.equal(fitBounds({ x: 100, y: 100, width: 1000 }, WORK_AREA), null)
  assert.equal(fitBounds({ x: NaN, y: 100, width: 1000, height: 700 }, WORK_AREA), null)
})

test('miniPlacement puts the small window in the bottom-right of the work area', () => {
  assert.deepEqual(miniPlacement(WORK_AREA), {
    x: 1920 - MINI_SIZE.width - MINI_MARGIN,
    y: 1040 - MINI_SIZE.height - MINI_MARGIN,
  })
})

test('miniPlacement follows a secondary monitor to its own corner', () => {
  // a screen to the left of the primary one: negative origin, and the corner is negative too
  assert.deepEqual(miniPlacement({ x: -1920, y: 0, width: 1920, height: 1080 }), {
    x: -1920 + 1920 - MINI_SIZE.width - MINI_MARGIN,
    y: 1080 - MINI_SIZE.height - MINI_MARGIN,
  })
})

const ws = (id: number, cwd: string, title: string, initialCommand?: string): Workspace => ({
  id,
  ptyId: id * 10,
  cwd,
  title,
  initialCommand,
})

test('serializeWorkspaces keeps the shells and the active index', () => {
  const tabs = [ws(1, 'C:\\a', 'a'), ws(2, 'C:\\b', 'b')]
  assert.deepEqual(serializeWorkspaces(tabs, 'ws:2'), {
    tabs: [
      { cwd: 'C:\\a', title: 'a' },
      { cwd: 'C:\\b', title: 'b' },
    ],
    active: 1,
  })
})

test('serializeWorkspaces leaves out the update tab, index and all', () => {
  // `claude update` ran in tab 2; it is not a place to come back to, and the active index must
  // still point at the right row of what actually gets stored
  const tabs = [ws(1, 'C:\\a', 'a'), ws(2, 'C:\\a', '업데이트', 'claude update'), ws(3, 'C:\\c', 'c')]
  assert.deepEqual(serializeWorkspaces(tabs, 'ws:3'), {
    tabs: [
      { cwd: 'C:\\a', title: 'a' },
      { cwd: 'C:\\c', title: 'c' },
    ],
    active: 1,
  })
  // the update tab being in front is not a selection worth remembering
  assert.equal(serializeWorkspaces(tabs, 'ws:2').active, -1)
})

test('serializeWorkspaces reports no selection when a foreign session is in front', () => {
  assert.equal(serializeWorkspaces([ws(1, 'C:\\a', 'a')], 'session:abc').active, -1)
})

test('readStoredWorkspaces drops rows a hand-edited file could hold', () => {
  const got = readStoredWorkspaces({ tabs: [{ cwd: 'C:\\a', title: 'a' }, { title: 'no cwd' }, 'nope', null, { cwd: 'C:\\b' }], active: 1 })
  assert.deepEqual(got, { tabs: [{ cwd: 'C:\\a', title: 'a' }, { cwd: 'C:\\b', title: '' }], active: 1 })
  assert.deepEqual(readStoredWorkspaces(null), { tabs: [], active: -1 })
  assert.deepEqual(readStoredWorkspaces({ tabs: 'x', active: 'y' }), { tabs: [], active: -1 })
})
