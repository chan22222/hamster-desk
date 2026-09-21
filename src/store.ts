import { create } from 'zustand'
import type { DeskEvent, EffortLevel, GitInfo, LogItem, SessionInfo, StatusSnapshot, ToolAction, TurnSummary, TurnToast, VersionInfo } from '@shared/events'
import { setLang, t, type PrefLang } from './i18n'
import { cancelSummary, requestSummary } from './bubbles/summarize'
import { summarizeTurn } from './log/turn'

export type HamsterState =
  | 'idle'
  | 'thinking'
  | 'reading'
  | 'searching'
  | 'writing'
  | 'running'
  | 'hiring'
  | 'browsing'
  | 'talking'
  | 'waiting'
  | 'arriving'
  | 'leaving'

export type FeedKind = 'say' | 'act'

/**
 * One line of a hamster's chat feed. Rows stack above its head — oldest first, newest at the
 * bottom — and expire on their own; nothing has to be ticked off. Pushing a line that is already
 * in the feed does not add a second row: it bumps `count`, refreshes `ts` and moves the row to the
 * end, so a tool that keeps firing reads as `실행 중 ×3` instead of three identical bubbles.
 */
export interface FeedItem {
  /** `${hid}:${n}` — stable across merges, which is what a late summary matches on */
  id: string
  kind: FeedKind
  tone: 'talk' | 'warn' | 'name' | 'info' | 'edit'
  /** what the row shows: the summary once it arrives, the trimmed raw text until then */
  text: string
  /** the full sentence (tooltip, and the text sent to the summarizer) */
  raw: string
  /** when the row first appeared; never changes, so a merge keeps its place in the stack */
  born: number
  /** last time it was pushed — the life span below is counted from here */
  ts: number
  count: number
  summarized: boolean
}

/** How long a row stays up, measured from its `ts`. The studio smoke test shortens these. */
export const FEED_LIFE = { act: 3000, say: 9000, warn: 12000 }
export function setFeedLife(p: Partial<typeof FEED_LIFE>): void {
  Object.assign(FEED_LIFE, p)
}
export function feedLife(f: Pick<FeedItem, 'kind' | 'tone'>): number {
  return f.tone === 'warn' ? FEED_LIFE.warn : f.kind === 'act' ? FEED_LIFE.act : FEED_LIFE.say
}
/** at most this many rows are on screen; the oldest fall off the top */
export const FEED_MAX = 4

/** a row before the store gives it an id and its timestamps */
type NewItem = Pick<FeedItem, 'kind' | 'tone' | 'text' | 'raw' | 'summarized'>

export interface Hamster {
  id: string // 'main' or agentId
  sessionId: string
  name: string
  agentType: string
  depth: number
  background: boolean
  state: HamsterState
  since: number
  inFlight: string[]
  /** the chat feed above this hamster's head, oldest first, at most FEED_MAX rows */
  feed: FeedItem[]
  toolCount: number
  editCount: number
  /** model id last seen on this hamster's assistant messages */
  model: string | null
  /** effort recorded on this hamster's latest assistant message */
  effort: string | null
}

export interface EditEntry {
  id: string
  ts: number
  who: string
  whoName: string
  file: string
  op: 'edit' | 'write'
  added: number
  removed: number
  preview: { old: string; new: string } | null
}

export interface SessionState {
  info: SessionInfo
  title: string
  hamsters: Record<string, Hamster>
  order: string[]
  edits: EditEntry[]
  linesAdded: number
  linesRemoved: number
  costUSD: number
  lastPrompt: string
  waiting: boolean
  lastActivity: number
  turns: number
  /** effort of the main conversation as last recorded (transcript or status line) */
  effort: string | null
  model: string | null
  status: StatusSnapshot | null
  /** when the current turn's prompt arrived, so a `turn_end` can measure the turn */
  turnStartedAt: number | null
  /** the last thing the main hamster said, raw (RAW_MAX chars) */
  lastSaid: string
  /** what the last finished turn came to */
  lastTurn: TurnSummary | null
  /** a permanent copy of the feed rows; bubbles expire, this does not (LOG_MAX rows) */
  log: LogItem[]
}

/** how many feed rows one session keeps in `log` */
export const LOG_MAX = 500

/** how long the turn card stays up before it takes itself away */
const TOAST_LIFE = 8000
/** a `turn_end` older than this is backlog, not news — no card (see `apply`) */
const TOAST_MAX_AGE = 30_000

/** An embedded terminal tab. Its claude session (if any) is matched through process ancestry. */
export interface Workspace {
  id: number // local id, stable for React keys
  ptyId: number | null
  cwd: string
  title: string
  /** typed into the shell once it is up (e.g. `claude update`) */
  initialCommand?: string
}

/** `system` keeps following the OS for as long as it is picked. */
export type ThemeMode = 'light' | 'dark' | 'system'
/** where the studio sits relative to the terminal */
export type DeskSide = 'top' | 'right'

export interface Prefs {
  /** studio height when it sits above the terminal */
  deskH: number
  /** studio width when it sits beside the terminal */
  deskW: number
  deskSide: DeskSide
  sidebarW: number
  showSidebar: boolean
  /** the sidebar's "changed files" section is expanded */
  showLog: boolean
  /** the sidebar's file browser section is expanded */
  showExplorer: boolean
  onTop: boolean
  folded: boolean
  /** ask the summarizer to shorten what a hamster says */
  bubbleSummary: boolean
  lang: PrefLang
  theme: ThemeMode
  /** the studio's automatic camera (the `자동` button) */
  autoCam: boolean
  /** which OS notifications to raise while the window is in the background, and whether they beep */
  notify: {
    permission: boolean
    question: boolean
    turnEnd: boolean
    sound: boolean
  }
  /** terminal font size in px (10–24) */
  termFont: number
  /** the sidebar's "말풍선 로그" section is expanded */
  showFeedLog: boolean
}

export const DEFAULT_PREFS: Prefs = {
  deskH: 420,
  deskW: 520,
  deskSide: 'top',
  sidebarW: 248,
  showSidebar: false,
  showLog: true,
  showExplorer: true,
  onTop: false,
  folded: false,
  bubbleSummary: true,
  lang: 'auto',
  theme: 'light',
  autoCam: true,
  notify: { permission: true, question: true, turnEnd: true, sound: false },
  termFont: 14,
  showFeedLog: true,
}

interface DeskStore {
  sessions: Record<string, SessionState>
  workspaces: Workspace[]
  /** active tab: a workspace (`ws:<id>`) or an external session (`session:<id>`) */
  activeTab: string | null
  /** which terminals are sitting on a prompt, and since when (the age gates the notification) */
  ptyWaiting: Record<number, { reason: 'permission' | 'question'; ts: number }>
  /** newest status-line snapshot across sessions (rate limits are account-wide) */
  usage: StatusSnapshot | null
  version: VersionInfo | null
  prefs: Prefs
  /** the small always-on-top window; not remembered across restarts */
  mini: boolean
  /** what the last finished turn came to, while the card is still up */
  toast: TurnToast | null
  /** the last request to put the caret back in a terminal, so `TerminalPane` can act on it */
  focusTerminal: { ptyId: number; at: number } | null
  /** the last request to point the studio camera at one hamster */
  focusHamster: { sessionId: string; hid: string; at: number } | null
  /** the last request to open the terminal search box */
  searchRequest: { wsId: number; q?: string; at: number } | null
  /** read-only git snapshots, keyed by `gitKey(cwd)` */
  git: Record<string, GitInfo>
  toggleMini(): void
  setToast(t: TurnToast | null): void
  requestTerminalFocus(ptyId: number): void
  requestHamsterFocus(sessionId: string, hid: string): void
  requestTermSearch(wsId: number, q?: string): void
  setGit(cwd: string, info: GitInfo): void
  apply(e: DeskEvent): void
  setActiveTab(id: string | null): void
  addWorkspace(cwd: string, title?: string, initialCommand?: string): Workspace
  bindWorkspacePty(id: number, ptyId: number, cwd: string): void
  removeWorkspace(id: number): void
  setPrefs(p: Partial<Prefs>): void
  /** the user clicked one row of a hamster's feed: drop just that row */
  dismissFeedItem(sessionId: string, hid: string, id: string): void
  /** optimistic: the app just sent `/effort <level>` to this session */
  setSessionEffort(sessionId: string, level: EffortLevel): void
}

const ARRIVE_MS = 900
const LEAVE_MS = 2600 // long enough to walk back to the door in the 3D view

const actionState: Record<ToolAction, HamsterState> = {
  read: 'reading',
  search: 'searching',
  write: 'writing',
  run: 'running',
  hire: 'hiring',
  browse: 'browsing',
  other: 'thinking',
}

// ---- where the UI settings live ----------------------------------------------------------
// ~/.hamster-desk/ui.json, through the main process (electron/ui-store.ts). localStorage used to
// hold them, but it belongs to the Electron *profile* and this app gives each run mode its own
// (packaged / -dev / -smoke), so a language picked in the portable exe was invisible to `npm run
// dev`. The file is read once at boot (`hydrateUi`) and mirrored here, so every reader stays
// synchronous. Keys: `prefs`, `recents`, `favs`, `lastCwd`.

/** the whole bag, for the browser preview that has no main process to keep the file */
const UI_KEY = 'hd.ui'
/** the localStorage keys ui.json replaced; read once, then deleted */
const LEGACY_KEYS = ['hd.prefs', 'hd.recentDirs', 'hd.recentMeta', 'hd.favDirs', 'hd.lastCwd']

type UiBag = Record<string, unknown>
let uiBag: UiBag = {}
/** smoke runs force prefs through HAMSTER_PREFS; those must never reach the user's file */
let prefsReadOnly = false

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    const v: unknown = raw ? JSON.parse(raw) : null
    return v === null || v === undefined ? fallback : (v as T)
  } catch {
    return fallback
  }
}

/** What was stored under `key`, or `fallback` when nothing was. */
export function uiGet<T>(key: string, fallback: T): T {
  const v = uiBag[key]
  return v === undefined || v === null ? fallback : (v as T)
}

/** Remember `value` under `key`; the main process debounces and writes it atomically. */
export function uiSet(key: string, value: unknown): void {
  uiBag = { ...uiBag, [key]: value }
  if (window.desk) {
    void window.desk.ui.save({ [key]: value })
    return
  }
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(uiBag))
  } catch {
    /* a preference we cannot store is not worth an exception */
  }
}

/** Stop persisting preferences: this renderer is running with forced (debug) ones. */
export function freezePrefs(): void {
  prefsReadOnly = true
}

/**
 * The version stamp stored prefs carry, so a key whose *meaning* changed can be thrown away rather
 * than read as the old thing. A rename is cheap to handle by name (`showFolders` → `showSidebar`,
 * below); a key that kept its name and changed meaning is not, because the old value is a perfectly
 * valid new value. Bump this and add a `stored < n` rule in `adoptPrefs` next time one does.
 *
 * 2 — `showLog` used to mean "show the right-hand file panel" (default off) and now means "the
 *     sidebar's 바뀐 파일 section is expanded" (default on), so a stored `false` would greet a
 *     user of the new layout with that section already folded.
 */
const PREFS_VERSION = 2

/** which version wrote this bag; anything without a stamp predates the field */
const prefsVersionOf = (raw: unknown): number => {
  const v = raw && typeof raw === 'object' ? (raw as { v?: unknown }).v : undefined
  return typeof v === 'number' ? v : 1
}

/** what goes in the file: the prefs plus the stamp the migrations above key off */
const storedPrefs = (p: Prefs): UiBag => ({ ...p, v: PREFS_VERSION })

/**
 * Turn whatever is in the settings file into a complete `Prefs`. Exported for the contract test:
 * the migrations here are the only thing standing between an old ui.json and a broken UI.
 *
 * `showFolders` was this pref's name before the sidebar replaced the folder panel.
 */
export function adoptPrefs(raw: unknown): Prefs {
  const { showFolders, v: _v, ...rest } = (raw && typeof raw === 'object' ? raw : {}) as Partial<Prefs> & { showFolders?: boolean; v?: number }
  if (prefsVersionOf(raw) < 2) delete rest.showLog // meaning changed: take the new default instead
  const prefs: Prefs = { ...DEFAULT_PREFS, ...rest }
  // `notify` is the one nested group: a spread would replace it wholesale, so a file written
  // before a toggle existed would come back missing that key instead of taking its default.
  prefs.notify = { ...DEFAULT_PREFS.notify, ...(rest.notify && typeof rest.notify === 'object' ? rest.notify : undefined) }
  if (rest.showSidebar === undefined && typeof showFolders === 'boolean') prefs.showSidebar = showFolders
  setLang(prefs.lang)
  return prefs
}

/**
 * One-time move of the keys this app kept in localStorage before ui.json existed. Per *key*, not
 * per file: an early ui.json may hold only `prefs`, and the recent folders would then be stranded
 * in a profile nobody reads any more.
 */
function migrateFromLocalStorage(have: UiBag): UiBag | null {
  const bag: UiBag = {}
  if (have.prefs === undefined) {
    const prefs = readLocal<UiBag>('hd.prefs', {})
    if (prefs && typeof prefs === 'object' && Object.keys(prefs).length) bag.prefs = prefs
  }
  if (have.recents === undefined) {
    const dirs = readLocal<string[]>('hd.recentDirs', [])
    const meta = readLocal<Record<string, number>>('hd.recentMeta', {})
    if (Array.isArray(dirs) && dirs.length) bag.recents = dirs.map((p) => ({ path: p, at: meta?.[p.toLowerCase()] ?? 0, count: 1 }))
  }
  if (have.favs === undefined) {
    const favs = readLocal<string[]>('hd.favDirs', [])
    if (Array.isArray(favs) && favs.length) bag.favs = favs
  }
  if (have.lastCwd === undefined) {
    try {
      const lastCwd = localStorage.getItem('hd.lastCwd') // this one was never JSON
      if (lastCwd) bag.lastCwd = lastCwd
    } catch {
      /* ignore */
    }
  }
  if (Object.keys(bag).length === 0) return null
  for (const k of LEGACY_KEYS) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  }
  return bag
}

/** The first paint: defaults, plus whatever the browser preview kept for itself. */
function loadPrefs(): Prefs {
  if (!window.desk) uiBag = readLocal<UiBag>(UI_KEY, {})
  return adoptPrefs(uiBag.prefs)
}

/**
 * Read ~/.hamster-desk/ui.json and adopt it. It is async, so the app wears `data-booting` until
 * this resolves and the first frame is not painted with the defaults.
 */
export async function hydrateUi(): Promise<void> {
  const bridge = window.desk
  if (!bridge) return
  let bag: UiBag = {}
  try {
    bag = (await bridge.ui.load()) ?? {}
  } catch {
    bag = {}
  }
  const moved = migrateFromLocalStorage(bag)
  if (moved) {
    bag = { ...bag, ...moved }
    try {
      await bridge.ui.save(moved)
    } catch {
      /* best effort: the settings still work for this run */
    }
  }
  uiBag = bag
  const prefs = adoptPrefs(uiBag.prefs)
  useDesk.setState({ prefs })
  // write the migrated set back once, stamped, so the next boot has nothing left to fix up
  if (prefsVersionOf(uiBag.prefs) < PREFS_VERSION) uiSet('prefs', storedPrefs(prefs))
}

const RAW_MAX = 400
const SPEECH_MAX = 120

/** A sentence a hamster says. `text` shows immediately; a summary may replace it later. */
function speech(raw: string, tone: 'talk' | 'warn' | 'name'): NewItem {
  const full = raw.trim().slice(0, RAW_MAX)
  return { kind: 'say', tone, text: shortName(full, SPEECH_MAX), raw: full, summarized: false }
}

/** A fixed phrase: already short, never summarized. */
function fixed(text: string, tone: 'talk' | 'warn' | 'name'): NewItem {
  return { kind: 'say', tone, text, raw: text, summarized: true }
}

/** What the hamster is doing right now — the dim rows, and the ones that merge into `×N`. */
function doing(text: string, tone: 'info' | 'edit'): NewItem {
  return { kind: 'act', tone, text: shortName(text, 60), raw: text, summarized: true }
}

function mainHamster(sessionId: string): Hamster {
  return {
    id: 'main',
    sessionId,
    name: '메인',
    agentType: 'main',
    depth: 0,
    background: false,
    state: 'idle',
    since: Date.now(),
    inFlight: [],
    feed: [],
    toolCount: 0,
    editCount: 0,
    model: null,
    effort: null,
  }
}

function newSession(info: SessionInfo): SessionState {
  return {
    info,
    title: '',
    hamsters: { main: mainHamster(info.sessionId) },
    order: ['main'],
    edits: [],
    linesAdded: 0,
    linesRemoved: 0,
    costUSD: 0,
    lastPrompt: '',
    waiting: false,
    lastActivity: Date.now(),
    turns: 0,
    effort: null,
    model: null,
    status: null,
    turnStartedAt: null,
    lastSaid: '',
    lastTurn: null,
    log: [],
  }
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/**
 * The key one folder's git snapshot is stored under. Windows hands the same folder back with a
 * different case and sometimes a trailing separator (`C:\p\` from a drag, `c:\p` from a tab), and
 * those must not become two entries.
 */
export function gitKey(cwd: string): string {
  return cwd.replace(/[\\/]+$/, '').toLowerCase()
}

export function shortName(text: string, max = 22): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

let nextWorkspaceId = 1
/** feed row ids only have to be unique per hamster; one running counter is plenty */
let feedSeq = 0

export const useDesk = create<DeskStore>((set, get) => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingStatus = new Map<string, StatusSnapshot>()

  const updSession = (id: string, fn: (s: SessionState) => SessionState): void => {
    const cur = get().sessions[id]
    if (!cur) return
    set({ sessions: { ...get().sessions, [id]: fn(cur) } })
  }

  const updHamster = (sessionId: string, hid: string, fn: (h: Hamster) => Hamster): void => {
    updSession(sessionId, (s) => {
      const h = s.hamsters[hid]
      if (!h) return s
      return { ...s, hamsters: { ...s.hamsters, [hid]: fn(h) }, lastActivity: Date.now() }
    })
  }

  const later = (key: string, ms: number, fn: () => void): void => {
    const prev = timers.get(key)
    if (prev) clearTimeout(prev)
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        fn()
      }, ms),
    )
  }

  const hidOf = (agentId: string | null): string => agentId ?? 'main'

  const laneOf = (sessionId: string, hid: string): string => `${sessionId}:${hid}`

  /**
   * Drop every expired row. Only runs while something is still on screen: the last sweep that
   * empties every feed does not book another one, so an idle app has no timer at all.
   */
  const sweepFeeds = (): void => {
    const now = Date.now()
    const sessions = get().sessions
    let changed = false
    let soonest = Infinity
    const next: Record<string, SessionState> = {}
    for (const [sid, s] of Object.entries(sessions)) {
      let touched = false
      const hamsters: Record<string, Hamster> = {}
      for (const [hid, h] of Object.entries(s.hamsters)) {
        const alive = h.feed.filter((f) => now - f.ts < feedLife(f))
        for (const f of alive) soonest = Math.min(soonest, f.ts + feedLife(f))
        if (alive.length === h.feed.length) hamsters[hid] = h
        else {
          hamsters[hid] = { ...h, feed: alive }
          touched = true
        }
      }
      next[sid] = touched ? { ...s, hamsters } : s
      if (touched) changed = true
    }
    if (changed) set({ sessions: next })
    if (soonest !== Infinity) scheduleSweep(soonest - now)
  }
  /** Book the next sweep: at the first expiry, and never more than three seconds away. */
  const scheduleSweep = (inMs = 0): void => {
    later('feed:sweep', Math.max(200, Math.min(3000, inMs)), sweepFeeds)
  }

  /**
   * Add a row to a hamster's feed, merging it into an identical row that is already there.
   * Returns the id the row ended up with, which is what a late summary is matched against.
   *
   * Every row is also copied into the session's `log`, under the same id. The bubble above the
   * head expires after a few seconds and a new prompt wipes the feed outright; the log is the
   * record of what was actually said and done, so the panel can scroll back through it.
   */
  const push = (sessionId: string, hid: string, item: NewItem, patch: Partial<Hamster> = {}): string | null => {
    const h = get().sessions[sessionId]?.hamsters[hid]
    if (!h) return null
    const now = Date.now()
    const alive = h.feed.filter((f) => now - f.ts < feedLife(f))
    const at = alive.findIndex((f) => f.kind === item.kind && f.text === item.text)
    let id: string
    let count: number
    let feed: FeedItem[]
    if (at >= 0) {
      // same line again: keep its id and `born`, count it, and move it back to the bottom
      const cur = alive[at]
      id = cur.id
      count = cur.count + 1
      feed = [...alive.slice(0, at), ...alive.slice(at + 1), { ...cur, ...item, ts: now, count }]
    } else {
      id = `${hid}:${++feedSeq}`
      count = 1
      feed = [...alive, { ...item, id, born: now, ts: now, count }]
    }
    const hidName = patch.name ?? h.name
    updSession(sessionId, (s) => {
      const cur = s.hamsters[hid]
      if (!cur) return s
      // a merge updates the row already in the log rather than appending a second copy: the feed
      // merged on *text*, and `id` is what ties the two sides together
      const logAt = s.log.findIndex((l) => l.id === id)
      const log =
        logAt >= 0
          ? s.log.map((l, i) => (i === logAt ? { ...l, text: item.text, raw: item.raw, ts: now, count } : l))
          : [...s.log.slice(-(LOG_MAX - 1)), { id, hid, hidName, kind: item.kind, tone: item.tone, text: item.text, raw: item.raw, ts: now, count }]
      return { ...s, hamsters: { ...s.hamsters, [hid]: { ...cur, ...patch, feed: feed.slice(-FEED_MAX) } }, log, lastActivity: now }
    })
    scheduleSweep(feedLife(item))
    return id
  }

  /** Drop rows of one kind (a new turn clears what the hamster *was doing*, not what it said). */
  const clearFeed = (sessionId: string, hid: string, keep: (f: FeedItem) => boolean, patch: Partial<Hamster> = {}): void => {
    updHamster(sessionId, hid, (h) => ({ ...h, ...patch, feed: h.feed.filter(keep) }))
  }

  /**
   * Ask the summarizer to shorten a sentence; a late answer is dropped if that row is gone.
   * The log keeps its copy of the row, so the shorter text has to land there too — otherwise the
   * panel would show the raw sentence next to a bubble that says something else.
   */
  const askSummary = (sessionId: string, hid: string, id: string, raw: string, kind: 'said' | 'assigned'): void => {
    requestSummary({ lane: laneOf(sessionId, hid), kind, raw, ts: Date.now(), enabled: get().prefs.bubbleSummary }, (_ts, text) =>
      updSession(sessionId, (s) => {
        const h = s.hamsters[hid]
        let hamsters = s.hamsters
        if (h) {
          const at = h.feed.findIndex((f) => f.id === id)
          if (at >= 0) {
            const feed = [...h.feed]
            feed[at] = { ...feed[at], text, summarized: true }
            hamsters = { ...s.hamsters, [hid]: { ...h, feed } }
          }
        }
        const li = s.log.findIndex((l) => l.id === id)
        const log = li >= 0 ? s.log.map((l, i) => (i === li ? { ...l, text } : l)) : s.log
        return hamsters === s.hamsters && log === s.log ? s : { ...s, hamsters, log }
      }),
    )
  }

  /** A fixed phrase drops whatever was waiting to be summarized for this hamster. */
  const say = (sessionId: string, hid: string, item: NewItem, patch: Partial<Hamster> = {}): void => {
    cancelSummary(laneOf(sessionId, hid))
    push(sessionId, hid, item, patch)
  }

  const ensureAgent = (sessionId: string, agentId: string, ts: number): void => {
    const s = get().sessions[sessionId]
    if (!s || s.hamsters[agentId]) return
    updSession(sessionId, (st) => ({
      ...st,
      hamsters: {
        ...st.hamsters,
        [agentId]: {
          id: agentId,
          sessionId,
          name: agentId.slice(0, 6),
          agentType: 'agent',
          depth: 1,
          background: false,
          state: 'arriving',
          since: ts,
          inFlight: [],
          feed: [],
          toolCount: 0,
          editCount: 0,
          model: null,
          effort: null,
        },
      },
      order: [...st.order, agentId],
    }))
    later(`arrive:${sessionId}:${agentId}`, ARRIVE_MS, () =>
      updHamster(sessionId, agentId, (h) => (h.state === 'arriving' ? { ...h, state: 'thinking', since: Date.now() } : h)),
    )
  }

  /** the session a waiting-prompt event belongs to: the one running in that terminal */
  const sessionOfPty = (ptyId: number): SessionState | undefined => Object.values(get().sessions).find((s) => s.info.ptyId === ptyId)

  /** The tab a session is shown on: our own terminal when it runs in one, its own tab otherwise. */
  const tabOfSession = (s: SessionState): string => {
    const ws = s.info.ptyId === null ? undefined : get().workspaces.find((w) => w.ptyId === s.info.ptyId)
    return ws ? `ws:${ws.id}` : `session:${s.info.sessionId}`
  }

  return {
    sessions: {},
    workspaces: [],
    activeTab: null,
    ptyWaiting: {},
    usage: null,
    version: null,
    prefs: loadPrefs(),
    mini: false,
    toast: null,
    focusTerminal: null,
    focusHamster: null,
    searchRequest: null,
    git: {},
    toggleMini() {
      const on = !get().mini
      // paint the new shape right away, then take main's word for it: the window may refuse
      // (nothing to resize in the browser preview, or the resize did not stick)
      set({ mini: on })
      const p = window.desk?.win.mini(on)
      if (p) void p.then((real) => set({ mini: real }))
    },
    setToast: (t) => set({ toast: t }),
    requestTerminalFocus: (ptyId) => set({ focusTerminal: { ptyId, at: Date.now() } }),
    requestHamsterFocus: (sessionId, hid) => set({ focusHamster: { sessionId, hid, at: Date.now() } }),
    requestTermSearch: (wsId, q) => set({ searchRequest: { wsId, q, at: Date.now() } }),
    setGit: (cwd, info) => set({ git: { ...get().git, [gitKey(cwd)]: info } }),

    setActiveTab: (id) => set({ activeTab: id }),
    addWorkspace(cwd, title, initialCommand) {
      const ws: Workspace = { id: nextWorkspaceId++, ptyId: null, cwd, title: title ?? (baseName(cwd) || cwd), initialCommand }
      set({ workspaces: [...get().workspaces, ws], activeTab: `ws:${ws.id}` })
      return ws
    },
    bindWorkspacePty(id, ptyId, cwd) {
      set({
        workspaces: get().workspaces.map((w) => (w.id === id ? { ...w, ptyId, cwd, title: w.initialCommand ? w.title : baseName(cwd) || w.title } : w)),
      })
    },
    removeWorkspace(id) {
      const left = get().workspaces.filter((w) => w.id !== id)
      const activeTab = get().activeTab === `ws:${id}` ? (left.length ? `ws:${left[left.length - 1].id}` : null) : get().activeTab
      set({ workspaces: left, activeTab })
    },
    setSessionEffort(sessionId, level) {
      updSession(sessionId, (s) => ({
        ...s,
        effort: level,
        hamsters: s.hamsters.main ? { ...s.hamsters, main: { ...s.hamsters.main, effort: level } } : s.hamsters,
      }))
    },
    dismissFeedItem(sessionId, hid, id) {
      updHamster(sessionId, hid, (h) => (h.feed.some((f) => f.id === id) ? { ...h, feed: h.feed.filter((f) => f.id !== id) } : h))
    },
    setPrefs(p) {
      const prefs = { ...get().prefs, ...p }
      set({ prefs })
      if (p.lang !== undefined) setLang(prefs.lang)
      if (!prefsReadOnly) uiSet('prefs', storedPrefs(prefs))
    },

    apply(e) {
      const st = get()
      switch (e.kind) {
        case 'session': {
          const { kind: _k, ...info } = e
          const existing = st.sessions[info.sessionId]
          if (!existing) {
            let ns = newSession(info)
            // a status-line snapshot may have arrived before the session file was seen
            const early = pendingStatus.get(info.sessionId)
            if (early) {
              pendingStatus.delete(info.sessionId)
              ns = {
                ...ns,
                status: early,
                effort: early.effort ?? ns.effort,
                model: early.model?.id ?? ns.model,
                hamsters: { ...ns.hamsters, main: { ...ns.hamsters.main, model: early.model?.id ?? null, effort: early.effort ?? null } },
              }
            }
            // external sessions never steal focus; the first embedded terminal is created at boot
            set({ sessions: { ...st.sessions, [info.sessionId]: ns } })
          } else {
            const wasBusy = existing.info.status === 'busy'
            updSession(info.sessionId, (s) => {
              const main = s.hamsters.main
              let hamsters = s.hamsters
              if (main) {
                if (info.status === 'idle' && main.state !== 'idle' && main.state !== 'waiting') {
                  // going idle stops *doing* things; what it said stays until it times out
                  hamsters = { ...hamsters, main: { ...main, state: 'idle', since: Date.now(), inFlight: [], feed: main.feed.filter((f) => f.kind !== 'act') } }
                } else if (info.status === 'busy' && !wasBusy && main.state === 'idle') {
                  hamsters = { ...hamsters, main: { ...main, state: 'thinking', since: Date.now() } }
                }
              }
              const waiting = info.status === 'idle' ? false : s.waiting
              return { ...s, info: { ...s.info, ...info }, hamsters, waiting }
            })
          }
          return
        }
        case 'session_gone': {
          const sessions = { ...st.sessions }
          delete sessions[e.sessionId]
          const activeTab = st.activeTab === `session:${e.sessionId}` ? (st.workspaces.length ? `ws:${st.workspaces[0].id}` : null) : st.activeTab
          set({ sessions, activeTab })
          return
        }
        case 'title':
          updSession(e.sessionId, (s) => ({ ...s, title: e.title }))
          return
        case 'prompt': {
          if (e.agentId) return
          cancelSummary(laneOf(e.sessionId, 'main'))
          updSession(e.sessionId, (s) => {
            const main = s.hamsters.main
            // a new prompt starts a fresh conversation on screen too: the feed is wiped (the log
            // keeps its copy) and the turn clock starts, so `turn_end` can measure what follows
            const hamsters = main ? { ...s.hamsters, main: { ...main, state: 'thinking' as HamsterState, since: e.ts, feed: [] } } : s.hamsters
            return { ...s, lastPrompt: e.text, hamsters, waiting: false, lastActivity: Date.now(), turnStartedAt: e.ts, lastSaid: '' }
          })
          return
        }
        case 'agent_start': {
          ensureAgent(e.sessionId, e.agentId, e.ts)
          const assignment = e.description ? speech(e.description, 'name') : null
          updHamster(e.sessionId, e.agentId, (h) => ({
            ...h,
            name: shortName(e.description || h.name, 26),
            agentType: e.agentType,
            depth: e.depth,
            background: e.background,
            state: h.state === 'leaving' ? 'thinking' : h.state,
          }))
          if (assignment) {
            const id = push(e.sessionId, e.agentId, assignment)
            if (id) askSummary(e.sessionId, e.agentId, id, assignment.raw, 'assigned')
          }
          return
        }
        case 'agent_stop': {
          // it is on its way out: what it was doing goes, the sign-off stays
          clearFeed(e.sessionId, e.agentId, (f) => f.kind !== 'act')
          say(e.sessionId, e.agentId, fixed(t().reportDone, 'talk'), { state: 'leaving', since: Date.now(), inFlight: [] })
          later(`leave:${e.sessionId}:${e.agentId}`, LEAVE_MS, () =>
            updSession(e.sessionId, (s) => {
              const h = s.hamsters[e.agentId]
              if (!h || h.state !== 'leaving') return s
              const hamsters = { ...s.hamsters }
              delete hamsters[e.agentId]
              return { ...s, hamsters, order: s.order.filter((x) => x !== e.agentId) }
            }),
          )
          return
        }
        case 'tool': {
          if (e.agentId) ensureAgent(e.sessionId, e.agentId, e.ts)
          const hid = hidOf(e.agentId)
          const state = actionState[e.action]
          const str = t()
          const label =
            e.action === 'write'
              ? null // the matching 'edit' event carries the richer line
              : e.action === 'read'
                ? str.reading(e.label)
                : e.action === 'search'
                  ? str.searching(e.label)
                  : e.action === 'run'
                    ? str.running(e.label)
                    : e.action === 'hire'
                      ? str.hiring(e.label)
                      : e.action === 'browse'
                        ? str.browsing(e.label)
                        : e.name
          updHamster(e.sessionId, hid, (h) => ({
            ...h,
            state: h.state === 'arriving' || h.state === 'leaving' ? h.state : state,
            since: e.ts,
            inFlight: [...h.inFlight, e.toolUseId],
            toolCount: h.toolCount + 1,
          }))
          // the repeated ones are why the feed merges: `실행 중 ×3` rather than three rows
          if (label) push(e.sessionId, hid, doing(label, 'info'))
          return
        }
        case 'tool_done': {
          const hid = hidOf(e.agentId)
          updHamster(e.sessionId, hid, (h) => {
            const inFlight = h.inFlight.filter((x) => x !== e.toolUseId)
            const busyStates: HamsterState[] = ['reading', 'searching', 'writing', 'running', 'hiring', 'browsing']
            const state = inFlight.length === 0 && busyStates.includes(h.state) ? 'thinking' : h.state
            return { ...h, inFlight, state, since: state !== h.state ? Date.now() : h.since }
          })
          if (!e.ok) say(e.sessionId, hid, fixed(t().failed, 'warn'))
          return
        }
        case 'edit': {
          const hid = hidOf(e.agentId)
          const who = get().sessions[e.sessionId]?.hamsters[hid]
          const sign = e.op === 'write' ? (e.removed === 0 ? t().newlyWritten : t().overwritten) : `+${e.added} −${e.removed}`
          updSession(e.sessionId, (s) => ({
            ...s,
            edits: [
              ...s.edits.slice(-499),
              { id: e.toolUseId, ts: e.ts, who: hid, whoName: who?.name ?? hid, file: e.file, op: e.op, added: e.added, removed: e.removed, preview: e.preview },
            ],
          }))
          updHamster(e.sessionId, hid, (h) => ({ ...h, editCount: h.editCount + 1 }))
          push(e.sessionId, hid, doing(`${baseName(e.file)}  ${sign}`, 'edit'))
          return
        }
        case 'text': {
          const hid = hidOf(e.agentId)
          const said = speech(e.text, 'talk')
          if (!said.text) return
          const walking = ['arriving', 'leaving'].includes(get().sessions[e.sessionId]?.hamsters[hid]?.state ?? '')
          const id = push(e.sessionId, hid, said, walking ? {} : { state: 'talking', since: e.ts })
          if (id) askSummary(e.sessionId, hid, id, said.raw, 'said')
          // the turn card quotes the conversation, not a subagent's side channel: main only, and
          // the raw sentence rather than the summary, which may never arrive
          if (!e.agentId) updSession(e.sessionId, (s) => ({ ...s, lastSaid: said.raw }))
          return
        }
        case 'thinking': {
          const hid = hidOf(e.agentId)
          updHamster(e.sessionId, hid, (h) => (h.state === 'arriving' || h.state === 'leaving' || h.inFlight.length ? h : { ...h, state: 'thinking', since: e.ts }))
          return
        }
        case 'model': {
          const hid = hidOf(e.agentId)
          if (e.agentId) ensureAgent(e.sessionId, e.agentId, e.ts)
          updSession(e.sessionId, (s) => {
            const h = s.hamsters[hid]
            const hamsters = h && (h.model !== e.model || (e.effort && h.effort !== e.effort)) ? { ...s.hamsters, [hid]: { ...h, model: e.model, effort: e.effort ?? h.effort } } : s.hamsters
            return e.agentId ? { ...s, hamsters } : { ...s, hamsters, model: e.model, effort: e.effort ?? s.effort }
          })
          return
        }
        case 'turn_end': {
          const before = st.sessions[e.sessionId]
          if (!before) return
          const summary = summarizeTurn(before, e)
          updSession(e.sessionId, (s) => {
            const main = s.hamsters.main
            // the turn is over: drop what it was doing, keep what it said
            const hamsters = main ? { ...s.hamsters, main: { ...main, state: 'idle' as HamsterState, since: Date.now(), inFlight: [], feed: main.feed.filter((f) => f.kind !== 'act') } } : s.hamsters
            return { ...s, hamsters, turns: s.turns + 1, lastTurn: summary, turnStartedAt: null }
          })
          // The backlog is replayed whenever the renderer (re)mounts, so an old `turn_end` arrives
          // again on every reload. A card popping up for a turn that finished an hour ago would be
          // a lie, so only a fresh one is shown — `lastTurn` above is set either way.
          if (Date.now() - e.ts > TOAST_MAX_AGE) return
          set({ toast: { ...summary, sessionId: e.sessionId, tab: tabOfSession(before) } })
          later('toast', TOAST_LIFE, () => {
            if (get().toast?.at === summary.at) set({ toast: null })
          })
          return
        }
        case 'cost':
          updSession(e.sessionId, (s) => ({ ...s, linesAdded: e.linesAdded, linesRemoved: e.linesRemoved, costUSD: e.costUSD }))
          return
        case 'compact':
          say(e.sessionId, 'main', fixed(t().compacting, 'talk'))
          return
        case 'status': {
          const { kind: _k, ...snap } = e
          // a fresh session reports no rate limits until its first API call; keep the newest snapshot that has them
          const hasWindows = !!(snap.fiveHour || snap.sevenDay)
          const usage = hasWindows && (!st.usage || snap.ts >= st.usage.ts) ? snap : st.usage
          set({ usage })
          if (!st.sessions[snap.sessionId]) pendingStatus.set(snap.sessionId, snap)
          updSession(snap.sessionId, (s) => ({
            ...s,
            status: snap,
            effort: snap.effort ?? s.effort,
            model: snap.model?.id ?? s.model,
            hamsters: s.hamsters.main
              ? { ...s.hamsters, main: { ...s.hamsters.main, model: s.hamsters.main.model ?? snap.model?.id ?? null, effort: snap.effort ?? s.hamsters.main.effort } }
              : s.hamsters,
            linesAdded: snap.linesAdded ?? s.linesAdded,
            linesRemoved: snap.linesRemoved ?? s.linesRemoved,
            costUSD: snap.costUSD ?? s.costUSD,
          }))
          return
        }
        case 'version': {
          const { kind: _k, ...v } = e
          set({ version: v })
          return
        }
        case 'waiting': {
          set({ ptyWaiting: { ...st.ptyWaiting, [e.ptyId]: { reason: e.reason, ts: e.ts } } })
          const s = sessionOfPty(e.ptyId)
          if (!s) return
          updSession(s.info.sessionId, (ss) => ({ ...ss, waiting: true }))
          say(s.info.sessionId, 'main', fixed(e.reason === 'permission' ? t().needPermission : t().haveQuestion, 'warn'), {
            state: 'waiting',
            since: Date.now(),
          })
          return
        }
        case 'waiting_clear': {
          const ptyWaiting = { ...st.ptyWaiting }
          delete ptyWaiting[e.ptyId]
          set({ ptyWaiting })
          const s = sessionOfPty(e.ptyId)
          if (!s) return
          updSession(s.info.sessionId, (ss) => {
            if (!ss.waiting) return ss
            const main = ss.hamsters.main
            // the prompt is answered: the warning it was showing goes with it
            const hamsters =
              main && main.state === 'waiting'
                ? { ...ss.hamsters, main: { ...main, state: 'thinking' as HamsterState, since: Date.now(), feed: main.feed.filter((f) => f.tone !== 'warn') } }
                : ss.hamsters
            return { ...ss, waiting: false, hamsters }
          })
          return
        }
      }
    },
  }
})

/** Session shown for a tab: the workspace's own claude session, or the external session itself. */
export function sessionForTab(st: Pick<DeskStore, 'sessions' | 'workspaces'>, tab: string | null): SessionState | null {
  if (!tab) return null
  if (tab.startsWith('session:')) return st.sessions[tab.slice(8)] ?? null
  const ws = st.workspaces.find((w) => `ws:${w.id}` === tab)
  if (!ws || ws.ptyId === null) return null
  return Object.values(st.sessions).find((s) => s.info.ptyId === ws.ptyId) ?? null
}

export function externalSessions(sessions: Record<string, SessionState>): SessionState[] {
  return Object.values(sessions)
    .filter((s) => !s.info.mine)
    .sort((a, b) => b.info.startedAt - a.info.startedAt)
}

export function isEffortLevel(v: string | null | undefined): v is EffortLevel {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'xhigh' || v === 'max'
}

// ---- running a command in an embedded terminal --------------------------------------------
const CR = '\r'

/**
 * Type `command` into a terminal and run it.
 *
 * The text and the Enter have to be two separate writes. PowerShell's PSReadLine turns on
 * bracketed paste, and a single write carrying both is one pasted block: the CR inside it becomes
 * a line break in the editing buffer instead of accepting the line, so the command sits at the
 * prompt and the user has to press Enter themselves. Two writes arrive at ConPTY as two input
 * chunks, which puts the Enter outside the paste block where it is a real Enter.
 *
 * Without the desktop bridge (the browser preview) there is nothing to type into: do nothing.
 */
export function runInTerminal(ptyId: number, command: string, delayMs = 60): void {
  const bridge = window.desk
  if (!bridge) return
  bridge.pty.input(ptyId, command)
  // whoever pressed the button is done with it — the caret belongs in the terminal now
  useDesk.getState().requestTerminalFocus(ptyId)
  setTimeout(() => bridge.pty.input(ptyId, CR), delayMs)
}

/** debug/e2e only: the button `HAMSTER_CLICK` asked the UI to press for itself, once. */
let debugClickName: string | null = null
export const setDebugClick = (name: string | null): void => {
  debugClickName = name
}
export const debugClick = (): string | null => debugClickName
