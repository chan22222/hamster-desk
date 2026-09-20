import { create } from 'zustand'
import type { DeskEvent, EffortLevel, SessionInfo, StatusSnapshot, ToolAction, VersionInfo } from '@shared/events'
import { setLang, t, type PrefLang } from './i18n'
import { cancelSummary, requestSummary } from './bubbles/summarize'

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

/** What a hamster is *saying*: stays up until it is dismissed or the next sentence arrives. */
export interface Bubble {
  /** what the bubble shows: the summary once it arrives, the trimmed raw text until then */
  text: string
  /** the full sentence (tooltip, and the text sent to the summarizer) */
  raw: string
  ts: number
  tone: 'talk' | 'warn' | 'name'
  summarized: boolean
}

/** What a hamster is *doing* right now: one dim line under the speech, replaced by the next tool. */
export interface Activity {
  text: string
  ts: number
  tone: 'info' | 'edit'
}

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
  bubble: Bubble | null
  activity: Activity | null
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
}

/** An embedded terminal tab. Its claude session (if any) is matched through process ancestry. */
export interface Workspace {
  id: number // local id, stable for React keys
  ptyId: number | null
  cwd: string
  title: string
  /** typed into the shell once it is up (e.g. `claude update`) */
  initialCommand?: string
}

export interface Prefs {
  deskH: number
  showLog: boolean
  showSidebar: boolean
  onTop: boolean
  folded: boolean
  /** ask the summarizer to shorten what a hamster says */
  bubbleSummary: boolean
  lang: PrefLang
}

export const DEFAULT_PREFS: Prefs = {
  deskH: 420,
  showLog: false,
  showSidebar: false,
  onTop: false,
  folded: false,
  bubbleSummary: true,
  lang: 'auto',
}

interface DeskStore {
  sessions: Record<string, SessionState>
  workspaces: Workspace[]
  /** active tab: a workspace (`ws:<id>`) or an external session (`session:<id>`) */
  activeTab: string | null
  ptyWaiting: Record<number, 'permission' | 'question'>
  /** newest status-line snapshot across sessions (rate limits are account-wide) */
  usage: StatusSnapshot | null
  version: VersionInfo | null
  prefs: Prefs
  toast: { text: string; ts: number } | null
  setToast(text: string): void
  apply(e: DeskEvent): void
  setActiveTab(id: string | null): void
  addWorkspace(cwd: string, title?: string, initialCommand?: string): Workspace
  bindWorkspacePty(id: number, ptyId: number, cwd: string): void
  removeWorkspace(id: number): void
  setPrefs(p: Partial<Prefs>): void
  /** the user ticked a speech bubble off (or clicked it) */
  dismissBubble(sessionId: string, hid: string): void
  /** optimistic: the app just sent `/effort <level>` to this session */
  setSessionEffort(sessionId: string, level: EffortLevel): void
}

const ARRIVE_MS = 900
const LEAVE_MS = 2600 // long enough to walk back to the door in the 3D view
const PREFS_KEY = 'hd.prefs'

const actionState: Record<ToolAction, HamsterState> = {
  read: 'reading',
  search: 'searching',
  write: 'writing',
  run: 'running',
  hire: 'hiring',
  browse: 'browsing',
  other: 'thinking',
}

function loadPrefs(): Prefs {
  let prefs = DEFAULT_PREFS
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) {
      // `showFolders` was this pref's name before the sidebar replaced the folder panel
      const { showFolders, ...rest } = JSON.parse(raw) as Partial<Prefs> & { showFolders?: boolean }
      prefs = { ...DEFAULT_PREFS, ...rest }
      if (rest.showSidebar === undefined && typeof showFolders === 'boolean') prefs.showSidebar = showFolders
    }
  } catch {
    /* defaults */
  }
  setLang(prefs.lang)
  return prefs
}

const RAW_MAX = 400
const SPEECH_MAX = 120

/** A sentence a hamster says. `text` shows immediately; a summary may replace it later. */
function speech(raw: string, tone: Bubble['tone']): Bubble {
  const full = raw.trim().slice(0, RAW_MAX)
  return { text: shortName(full, SPEECH_MAX), raw: full, ts: Date.now(), tone, summarized: false }
}

/** A fixed phrase: already short, never summarized. */
function fixed(text: string, tone: Bubble['tone']): Bubble {
  return { text, raw: text, ts: Date.now(), tone, summarized: true }
}

function activityOf(text: string, tone: Activity['tone']): Activity {
  return { text: shortName(text, 60), ts: Date.now(), tone }
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
    bubble: null,
    activity: null,
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
  }
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

export function shortName(text: string, max = 22): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

let nextWorkspaceId = 1

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

  /** Ask the summarizer to shorten a sentence; a late answer is dropped if the bubble moved on. */
  const askSummary = (sessionId: string, hid: string, b: Bubble, kind: 'said' | 'assigned'): void => {
    requestSummary({ lane: laneOf(sessionId, hid), kind, raw: b.raw, ts: b.ts, enabled: get().prefs.bubbleSummary }, (ts, text) =>
      updHamster(sessionId, hid, (h) => (h.bubble && h.bubble.ts === ts ? { ...h, bubble: { ...h.bubble, text, summarized: true } } : h)),
    )
  }

  /** A fixed phrase replaces whatever was waiting to be summarized. */
  const say = (sessionId: string, hid: string, b: Bubble, patch: Partial<Hamster> = {}): void => {
    cancelSummary(laneOf(sessionId, hid))
    updHamster(sessionId, hid, (h) => ({ ...h, ...patch, bubble: b }))
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
          bubble: null,
          activity: null,
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

  return {
    sessions: {},
    workspaces: [],
    activeTab: null,
    ptyWaiting: {},
    usage: null,
    version: null,
    prefs: loadPrefs(),
    toast: null,
    setToast: (text) => set({ toast: { text, ts: Date.now() } }),

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
    dismissBubble(sessionId, hid) {
      cancelSummary(laneOf(sessionId, hid))
      updHamster(sessionId, hid, (h) => (h.bubble ? { ...h, bubble: null } : h))
    },
    setPrefs(p) {
      const prefs = { ...get().prefs, ...p }
      set({ prefs })
      if (p.lang !== undefined) setLang(prefs.lang)
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
      } catch {
        /* ignore */
      }
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
                  hamsters = { ...hamsters, main: { ...main, state: 'idle', since: Date.now(), inFlight: [], activity: null } }
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
            const hamsters = main ? { ...s.hamsters, main: { ...main, state: 'thinking' as HamsterState, since: e.ts, bubble: null, activity: null } } : s.hamsters
            return { ...s, lastPrompt: e.text, hamsters, waiting: false, lastActivity: Date.now() }
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
            bubble: assignment ?? h.bubble,
          }))
          if (assignment) askSummary(e.sessionId, e.agentId, assignment, 'assigned')
          return
        }
        case 'agent_stop': {
          say(e.sessionId, e.agentId, fixed(t().reportDone, 'talk'), { state: 'leaving', since: Date.now(), inFlight: [], activity: null })
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
            activity: label ? activityOf(label, 'info') : h.activity,
          }))
          return
        }
        case 'tool_done': {
          const hid = hidOf(e.agentId)
          if (!e.ok) cancelSummary(laneOf(e.sessionId, hid))
          const failed = e.ok ? null : fixed(t().failed, 'warn')
          updHamster(e.sessionId, hid, (h) => {
            const inFlight = h.inFlight.filter((x) => x !== e.toolUseId)
            const busyStates: HamsterState[] = ['reading', 'searching', 'writing', 'running', 'hiring', 'browsing']
            const state = inFlight.length === 0 && busyStates.includes(h.state) ? 'thinking' : h.state
            return { ...h, inFlight, state, since: state !== h.state ? Date.now() : h.since, bubble: failed ?? h.bubble }
          })
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
          updHamster(e.sessionId, hid, (h) => ({
            ...h,
            editCount: h.editCount + 1,
            activity: activityOf(`${baseName(e.file)}  ${sign}`, 'edit'),
          }))
          return
        }
        case 'text': {
          const hid = hidOf(e.agentId)
          const said = speech(e.text, 'talk')
          if (!said.text) return
          updHamster(e.sessionId, hid, (h) =>
            h.state === 'arriving' || h.state === 'leaving' ? { ...h, bubble: said } : { ...h, state: 'talking', since: e.ts, bubble: said },
          )
          askSummary(e.sessionId, hid, said, 'said')
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
        case 'turn_end':
          updSession(e.sessionId, (s) => {
            const main = s.hamsters.main
            const hamsters = main ? { ...s.hamsters, main: { ...main, state: 'idle' as HamsterState, since: Date.now(), inFlight: [], activity: null } } : s.hamsters
            return { ...s, hamsters, turns: s.turns + 1 }
          })
          return
        case 'cost':
          updSession(e.sessionId, (s) => ({ ...s, linesAdded: e.linesAdded, linesRemoved: e.linesRemoved, costUSD: e.costUSD }))
          return
        case 'compact':
          updHamster(e.sessionId, 'main', (h) => ({ ...h, activity: activityOf(t().compacting, 'info') }))
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
          set({ ptyWaiting: { ...st.ptyWaiting, [e.ptyId]: e.reason } })
          const s = sessionOfPty(e.ptyId)
          if (!s) return
          cancelSummary(laneOf(s.info.sessionId, 'main'))
          const ask = fixed(e.reason === 'permission' ? t().needPermission : t().haveQuestion, 'warn')
          updSession(s.info.sessionId, (ss) => {
            const main = ss.hamsters.main
            const hamsters = main ? { ...ss.hamsters, main: { ...main, state: 'waiting' as HamsterState, since: Date.now(), bubble: ask } } : ss.hamsters
            return { ...ss, waiting: true, hamsters }
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
            const hamsters =
              main && main.state === 'waiting'
                ? { ...ss.hamsters, main: { ...main, state: 'thinking' as HamsterState, since: Date.now(), bubble: main.bubble?.tone === 'warn' ? null : main.bubble } }
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
