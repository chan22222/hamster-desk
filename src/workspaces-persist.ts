// Remember the open terminal tabs and put them back at the next start. Plan §3.3. Owner: A.
//
// The list lives beside the preferences, in ~/.hamster-desk/ui.json under `workspaces` — one file
// outside the Electron profile, so the portable exe and `npm run dev` see the same tabs.
//
// Only *shells* come back. A tab opened to run a one-off command (`claude update`) is not a place
// the user was working, and a claude session is resumed deliberately from the session bar (§3.4),
// never by reopening the app.

import { DEFAULT_PROFILE_ID } from '@shared/events'
import { lastCwd } from './sidebar/recent'
import { uiGet, uiSet, useDesk, type Workspace } from './store'

/** one remembered tab */
export interface StoredTab {
  cwd: string
  title: string
  /** the account the tab ran under; absent (older files, or the default account) = default */
  profileId?: string
}

export interface StoredWorkspaces {
  tabs: StoredTab[]
  /** index into `tabs` of the tab that was in front, or -1 */
  active: number
}

/** three or more shells at once is enough to make Windows stutter; stagger those (R11) */
const STAGGER_FROM = 3
const STAGGER_MS = 400
/** one write per burst of tab changes, on top of the 300 ms the main process already debounces */
const SAVE_DEBOUNCE_MS = 400

const UI_KEY = 'workspaces'

/**
 * What goes in the file. Pure, and exported for scripts/unit/window-state.test.ts: the one rule
 * worth a test is that an update tab never gets remembered.
 */
export function serializeWorkspaces(workspaces: Workspace[], activeTab: string | null): StoredWorkspaces {
  const tabs: StoredTab[] = []
  let active = -1
  for (const w of workspaces) {
    if (w.initialCommand) continue
    if (`ws:${w.id}` === activeTab) active = tabs.length
    tabs.push({ cwd: w.cwd, title: w.title, ...(w.profileId && w.profileId !== DEFAULT_PROFILE_ID ? { profileId: w.profileId } : {}) })
  }
  return { tabs, active }
}

/** Whatever is in the file, with anything that is not a `{ cwd }` row dropped. */
export function readStoredWorkspaces(raw: unknown): StoredWorkspaces {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Partial<StoredWorkspaces>) : {}
  const tabs: StoredTab[] = []
  if (Array.isArray(src.tabs)) {
    for (const row of src.tabs) {
      if (!row || typeof row !== 'object') continue
      const { cwd, title, profileId } = row as Partial<StoredTab>
      if (typeof cwd !== 'string' || !cwd) continue
      tabs.push({ cwd, title: typeof title === 'string' && title ? title : '', ...(typeof profileId === 'string' && profileId ? { profileId } : {}) })
      if (tabs.length >= 12) break // a settings file is not a place for an unbounded list
    }
  }
  const active = typeof src.active === 'number' && Number.isInteger(src.active) ? src.active : -1
  return { tabs, active }
}

/**
 * What kind of debug run this is, if any.
 *
 *  - `pinned`: every shell is pinned to one folder (`HAMSTER_CWD`) or the preferences are forced
 *    (`HAMSTER_PREFS`). Restoring the real tabs into it would be meaningless, and saving what it
 *    ends up with would overwrite the user's actual tabs — so neither happens.
 *  - `capture`: a blind screenshot run (`HAMSTER_CAPTURE`). It *does* restore — that is the only
 *    way to photograph a restore — but it never writes the tabs back, the same rule
 *    electron/window-state.ts keeps for the window bounds (plan §1.3).
 */
async function debugRun(): Promise<{ pinned: boolean; capture: boolean }> {
  const bridge = window.desk
  if (!bridge) return { pinned: false, capture: false }
  try {
    const info = await bridge.info()
    return { pinned: !!info.debugPrefs || !!info.debugCwd, capture: info.debugCapture }
  } catch {
    return { pinned: false, capture: false }
  }
}

/** Which of these folders are still there; without the bridge every path is assumed to exist. */
async function stillThere(paths: string[]): Promise<Set<string>> {
  const bridge = window.desk
  if (!bridge || paths.length === 0) return new Set(paths)
  try {
    const map = await bridge.fs.exists(paths)
    return new Set(paths.filter((p) => map[p] !== false))
  } catch {
    return new Set(paths)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---- saving ---------------------------------------------------------------------------------

let saverOn = false

function installSaver(): void {
  if (saverOn) return
  saverOn = true
  const snapshot = (): string => {
    const s = useDesk.getState()
    return JSON.stringify(serializeWorkspaces(s.workspaces, s.activeTab))
  }
  let last = snapshot()
  let timer: ReturnType<typeof setTimeout> | null = null
  useDesk.subscribe((s, prev) => {
    if (s.workspaces === prev.workspaces && s.activeTab === prev.activeTab) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const now = snapshot()
      if (now === last) return // a rename that changed nothing we keep, or a tab that came back
      last = now
      uiSet(UI_KEY, JSON.parse(now) as StoredWorkspaces)
    }, SAVE_DEBOUNCE_MS)
  })
}

// ---- restoring ------------------------------------------------------------------------------

/**
 * Open the terminals the last run ended with, or — when there is nothing to put back — the single
 * tab this app has always started with. Awaited by App.tsx, so the window is not painted with an
 * empty tab strip first.
 */
export async function restoreWorkspaces(home: string): Promise<void> {
  if (useDesk.getState().workspaces.length > 0) return
  const debug = await debugRun()
  if (debug.pinned) {
    useDesk.getState().addWorkspace(lastCwd() || home)
    return
  }
  // from here on every path ends by starting the saver — except in a capture run
  const startSaving = (): void => {
    if (!debug.capture) installSaver()
  }

  const stored = readStoredWorkspaces(uiGet<unknown>(UI_KEY, null))
  const alive = await stillThere(stored.tabs.map((t) => t.cwd))
  const kept = stored.tabs.map((t, i) => ({ t, i })).filter(({ t }) => alive.has(t.cwd))

  if (kept.length === 0) {
    useDesk.getState().addWorkspace(lastCwd() || home)
    startSaving()
    return
  }

  const ids: number[] = []
  for (let n = 0; n < kept.length; n++) {
    if (n > 0 && kept.length >= STAGGER_FROM) await sleep(STAGGER_MS)
    const { t } = kept[n]
    // a tab comes back under the account it had — not under whichever is current now
    ids.push(useDesk.getState().addWorkspace(t.cwd, t.title || undefined, undefined, t.profileId ?? DEFAULT_PROFILE_ID).id)
  }
  const at = kept.findIndex(({ i }) => i === stored.active)
  useDesk.getState().setActiveTab(`ws:${ids[at >= 0 ? at : ids.length - 1]}`)
  // a capture run cannot show which tab is in front of a terminal that has not painted yet; say it
  if (debug.capture) console.log(`[restore] tabs=${ids.length}/${stored.tabs.length} active=${useDesk.getState().activeTab}`)
  startSaving()
}
