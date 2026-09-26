import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppUpdateInfo,
  BubbleRequest,
  BubbleResult,
  BubbleState,
  DelegationConfig,
  DelegationState,
  DeskEvent,
  DirEntry,
  FileEntry,
  FiveHourState,
  GitDiff,
  GitInfo,
  NotifyRequest,
  NotifyResult,
  ProfilesState,
  ProjectInfo,
  PtyInfo,
  SessionInfo,
  TranscriptEntry,
  UiState,
  UsageWindows,
  VersionInfo,
} from '../shared/events'

export interface SeqEvent {
  seq: number
  ev: DeskEvent
}

export type StatusLineState = 'installed' | 'foreign' | 'none'

/**
 * What switching the status line did. `error`: settings.json is there but could not be read (or
 * replaced), and nothing was changed — the words to show next to the button that was pressed.
 */
export interface StatusLineResult {
  state: StatusLineState
  error: string | null
}

/** The account list after a change; `error` when the change could not happen (the list is then as it was). */
export type ProfilesAnswer = ProfilesState & { error?: string }

export interface DeskBridge {
  onEvent(cb: (e: SeqEvent) => void): () => void
  /** everything after `after` — the events the ring has dropped that everything else hangs on first (main.ts `replay`) */
  backlog(after: number): Promise<SeqEvent[]>
  sessions(): Promise<SessionInfo[]>
  /**
   * The path of a file dropped on the page (`webUtils`; the old `File.path` is gone); '' for one that
   * is not on disk. The page asks this instead of letting Chromium open the file in its place.
   */
  pathForFile(file: File): string
  pty: {
    /** `profileId` = the account the shell runs under (its `CLAUDE_CONFIG_DIR`); none = the default one */
    create(cols: number, rows: number, cwd?: string, profileId?: string): Promise<PtyInfo>
    input(id: number, data: string): void
    resize(id: number, cols: number, rows: number): void
    kill(id: number): void
    onData(cb: (id: number, data: string) => void): () => void
    onExit(cb: (id: number, code: number) => void): () => void
  }
  /** per account: each one has its own settings.json */
  statusline: {
    state(profileId?: string): Promise<StatusLineState>
    install(profileId?: string): Promise<StatusLineResult>
    uninstall(profileId?: string): Promise<StatusLineResult>
  }
  /** several Claude Code accounts, one config folder each (electron/profiles.ts); a change that failed says why in `error` */
  profiles: {
    list(): Promise<ProfilesState>
    add(name: string): Promise<ProfilesAnswer>
    rename(id: string, name: string): Promise<ProfilesAnswer>
    /** deletes the account: its shells are closed and its folder (login, settings, conversations) goes with it */
    remove(id: string): Promise<ProfilesAnswer>
    setCurrent(id: string): Promise<ProfilesAnswer>
    /** put the CLI's own account (~/.claude) back on the list after it was taken off */
    showDefault(): Promise<ProfilesAnswer>
    openFolder(id: string): Promise<string>
  }
  version: { check(force?: boolean): Promise<VersionInfo> }
  /** this app against `main` of its repository (electron/app-update.ts) */
  appUpdate: {
    check(force?: boolean): Promise<AppUpdateInfo>
    /**
     * 'updating': the app quits, rebuilds (or installs) and reopens. 'downloading': an installed build
     * started downloading the release; progress arrives as app_update events. 'opened': the commits
     * page, where self-update is not possible
     */
    run(): Promise<'updating' | 'downloading' | 'opened'>
  }
  /** the app is on screen and usable: closes this launch's line in ~/.hamster-desk/boot.log */
  bootDone(): void
  dialog: { pickFolder(defaultPath?: string): Promise<string | null> }
  /** short speech-bubble lines summarized by a headless `claude -p --model haiku` (electron/summarize.ts) */
  bubble: {
    summarize(req: BubbleRequest): Promise<BubbleResult>
    state(): Promise<BubbleState>
    resetStats(): Promise<BubbleState>
  }
  /** the CLI's own usage query, per-model weekly windows included (electron/usage-query.ts) */
  usage: {
    /** ask now, for one account or every logged-in one; the same answers also arrive as `usage_windows` events */
    refresh(profileId?: string): Promise<UsageWindows[]>
  }
  /** "멀티 에이전트": the sub-agent instruction block in every account's CLAUDE.md (electron/delegation.ts) */
  delegation: {
    /** the stored config and what each account's file says — reads only */
    get(): Promise<DelegationState>
    /** store the config and bring every account's file in line with it */
    set(config: DelegationConfig): Promise<DelegationState>
  }
  /** per account: one tiny `claude -p` right after each 5-hour reset, so the next window starts then (electron/five-hour.ts) */
  fiveHour: {
    state(): Promise<FiveHourState>
    set(profileId: string, on: boolean): Promise<FiveHourState>
    /** a message went out, came back or failed */
    onChange(cb: (s: FiveHourState) => void): () => void
  }
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): void
  }
  fs: {
    listDirs(path: string): Promise<{ path: string; parent: string | null; dirs: DirEntry[]; error: string | null }>
    list(path: string): Promise<{ path: string; parent: string | null; dirs: DirEntry[]; files: FileEntry[]; error: string | null }>
    drives(): Promise<string[]>
    /** `{ [path]: still there? }` — one call for a whole list of folders */
    exists(paths: string[]): Promise<Record<string, boolean>>
    openPath(path: string): Promise<string>
    showInFolder(path: string): void
    /** what kind of project the folder is and the commands it takes — the sidebar's 실행 menu (electron/project-actions.ts) */
    project(path: string): Promise<ProjectInfo>
  }
  /**
   * UI settings kept in ~/.hamster-desk/ui.json — not localStorage, which lives in the Electron
   * profile and therefore differs between the portable exe, `npm run dev` and the smoke runs.
   * `save` shallow-merges the patch (a `null` value deletes the key) and resolves to the merged state.
   * `base` is what this renderer's copy held before the patch, per key (`null` for none): for a
   * list it lets the main process write the *difference* into a file another process may have
   * added to meanwhile (electron/ui-store.ts).
   */
  ui: {
    load(): Promise<UiState>
    save(patch: UiState, base?: UiState): Promise<UiState>
  }
  win: {
    alwaysOnTop(on: boolean): void
    opacity(v: number): void
    /** enter/leave mini mode; resolves to the state the window actually ended up in */
    mini(on: boolean): Promise<boolean>
  }
  /** notifications when the window is in the background: the app's own popup window (electron/notify.ts) */
  notify: {
    show(req: NotifyRequest): Promise<NotifyResult>
    /** the user clicked a notification: its `tab` is the one to open */
    onClick(cb: (tab: string) => void): () => void
  }
  /** past conversations of one folder under every account, from the transcript files (electron/transcripts.ts) */
  transcripts: {
    list(cwd: string): Promise<TranscriptEntry[]>
  }
  /** read-only git for one folder (electron/git.ts) */
  git: {
    info(cwd: string): Promise<GitInfo>
    diff(cwd: string, file: string): Promise<GitDiff>
  }
  info(): Promise<{
    version: string
    platform: string
    home: string
    debugPrefs: Record<string, unknown> | null
    debugClick: string | null
    /** debug/e2e: events to replay into the store once the app is up (HAMSTER_EVENTS) */
    debugEvents: DeskEvent[] | null
    /** debug/e2e: buttons to press by themselves, `at` ms after boot (HAMSTER_CLICK) */
    debugClicks: { name: string; at: number }[]
    /** debug/e2e: every shell is pinned to this folder (HAMSTER_CWD), so the stored tabs are not restored */
    debugCwd: string | null
    /** debug/e2e: a blind screenshot run (HAMSTER_CAPTURE) — restores what is stored, writes nothing back */
    debugCapture: boolean
    /** debug/e2e: the boss's rounds start at once and repeat quickly (HAMSTER_PATROL=1) */
    debugPatrol: boolean
    /** debug/e2e: the window was shown without focus (HAMSTER_UNFOCUSED) */
    unfocused: boolean
    claudeLanguage: string | null
    uiPath: string
  }>
  /** smoke tests only: text to feed through xterm as if typed */
  onDebugType(cb: (ptyId: number, text: string) => void): () => void
}

/**
 * One ipcRenderer listener per channel however many subscribe. Every terminal pane listens to the
 * pty channels, and past ten listeners on one channel Node warns of a leak that is not one — with
 * the tab strip scrolling, a dozen tabs is an ordinary day.
 */
function fanOut<A extends unknown[]>(channel: string): (cb: (...args: A) => void) => () => void {
  const subs = new Set<(...args: A) => void>()
  const h = (_e: unknown, ...args: unknown[]): void => {
    for (const sub of [...subs]) sub(...(args as A)) // a copy: a pane may unsubscribe mid-dispatch
  }
  return (cb) => {
    const sub = (...args: A): void => cb(...args) // its own entry, even for a callback given twice
    if (!subs.size) ipcRenderer.on(channel, h)
    subs.add(sub)
    return () => {
      if (subs.delete(sub) && !subs.size) ipcRenderer.off(channel, h)
    }
  }
}

const onPtyData = fanOut<[number, string]>('pty:data')
const onPtyExit = fanOut<[number, number]>('pty:exit')
const onDebugType = fanOut<[number, string]>('debug:type')

const bridge: DeskBridge = {
  onEvent(cb) {
    // main sends them in batches, one per turn of its event loop (main.ts `emitDesk`)
    const h = (_e: unknown, items: SeqEvent[]): void => {
      for (const item of items) cb(item)
    }
    ipcRenderer.on('desk:events', h)
    return () => ipcRenderer.off('desk:events', h)
  },
  backlog: (after) => ipcRenderer.invoke('desk:backlog', after),
  sessions: () => ipcRenderer.invoke('desk:sessions'),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return '' // not a File at all
    }
  },
  pty: {
    create: (cols, rows, cwd, profileId) => ipcRenderer.invoke('pty:create', cols, rows, cwd, profileId),
    input: (id, data) => ipcRenderer.send('pty:input', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: (cb) => onPtyData(cb),
    onExit: (cb) => onPtyExit(cb),
  },
  statusline: {
    state: (profileId) => ipcRenderer.invoke('statusline:state', profileId),
    install: (profileId) => ipcRenderer.invoke('statusline:install', profileId),
    uninstall: (profileId) => ipcRenderer.invoke('statusline:uninstall', profileId),
  },
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    add: (name) => ipcRenderer.invoke('profiles:add', name),
    rename: (id, name) => ipcRenderer.invoke('profiles:rename', id, name),
    remove: (id) => ipcRenderer.invoke('profiles:remove', id),
    setCurrent: (id) => ipcRenderer.invoke('profiles:setCurrent', id),
    showDefault: () => ipcRenderer.invoke('profiles:showDefault'),
    openFolder: (id) => ipcRenderer.invoke('profiles:openFolder', id),
  },
  version: { check: (force) => ipcRenderer.invoke('version:check', force) },
  appUpdate: {
    check: (force) => ipcRenderer.invoke('appUpdate:check', force),
    run: () => ipcRenderer.invoke('appUpdate:run'),
  },
  bootDone: () => ipcRenderer.send('boot:done'),
  dialog: { pickFolder: (d) => ipcRenderer.invoke('dialog:pickFolder', d) },
  bubble: {
    summarize: (req) => ipcRenderer.invoke('bubble:summarize', req),
    state: () => ipcRenderer.invoke('bubble:state'),
    resetStats: () => ipcRenderer.invoke('bubble:resetStats'),
  },
  usage: {
    refresh: (profileId) => ipcRenderer.invoke('usage:refresh', profileId),
  },
  delegation: {
    get: () => ipcRenderer.invoke('delegation:get'),
    set: (config) => ipcRenderer.invoke('delegation:set', config),
  },
  fiveHour: {
    state: () => ipcRenderer.invoke('fiveHour:state'),
    set: (profileId, on) => ipcRenderer.invoke('fiveHour:set', profileId, on),
    onChange(cb) {
      const h = (_e: unknown, s: FiveHourState): void => cb(s)
      ipcRenderer.on('fiveHour:changed', h)
      return () => ipcRenderer.off('fiveHour:changed', h)
    },
  },
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:readText'),
    writeText: (text) => ipcRenderer.send('clipboard:writeText', text),
  },
  fs: {
    listDirs: (p) => ipcRenderer.invoke('fs:listDirs', p),
    list: (p) => ipcRenderer.invoke('fs:list', p),
    drives: () => ipcRenderer.invoke('fs:drives'),
    exists: (paths) => ipcRenderer.invoke('fs:exists', paths),
    openPath: (p) => ipcRenderer.invoke('fs:openPath', p),
    showInFolder: (p) => ipcRenderer.send('fs:showInFolder', p),
    project: (p) => ipcRenderer.invoke('fs:project', p),
  },
  ui: {
    load: () => ipcRenderer.invoke('ui:load'),
    save: (patch, base) => ipcRenderer.invoke('ui:save', patch, base),
  },
  win: {
    alwaysOnTop: (on) => ipcRenderer.send('win:alwaysOnTop', on),
    opacity: (v) => ipcRenderer.send('win:opacity', v),
    mini: (on) => ipcRenderer.invoke('win:mini', on),
  },
  notify: {
    show: (req) => ipcRenderer.invoke('notify:show', req),
    onClick(cb) {
      const h = (_e: unknown, tab: string): void => cb(tab)
      ipcRenderer.on('notify:click', h)
      return () => ipcRenderer.off('notify:click', h)
    },
  },
  transcripts: {
    list: (cwd) => ipcRenderer.invoke('transcripts:list', cwd),
  },
  git: {
    info: (cwd) => ipcRenderer.invoke('git:info', cwd),
    diff: (cwd, file) => ipcRenderer.invoke('git:diff', cwd, file),
  },
  info: () => ipcRenderer.invoke('app:info'),
  onDebugType: (cb) => onDebugType(cb),
}

contextBridge.exposeInMainWorld('desk', bridge)
