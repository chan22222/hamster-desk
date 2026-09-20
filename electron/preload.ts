import { contextBridge, ipcRenderer } from 'electron'
import type { BubbleRequest, BubbleResult, BubbleState, DeskEvent, DirEntry, FileEntry, PtyInfo, SessionInfo, UiState, VersionInfo } from '../shared/events'

export interface SeqEvent {
  seq: number
  ev: DeskEvent
}

export type StatusLineState = 'installed' | 'foreign' | 'none'

export interface DeskBridge {
  onEvent(cb: (e: SeqEvent) => void): () => void
  backlog(after: number): Promise<SeqEvent[]>
  sessions(): Promise<SessionInfo[]>
  pty: {
    create(cols: number, rows: number, cwd?: string): Promise<PtyInfo>
    input(id: number, data: string): void
    resize(id: number, cols: number, rows: number): void
    kill(id: number): void
    onData(cb: (id: number, data: string) => void): () => void
    onExit(cb: (id: number, code: number) => void): () => void
  }
  statusline: {
    state(): Promise<StatusLineState>
    install(): Promise<StatusLineState>
    uninstall(): Promise<StatusLineState>
  }
  version: { check(force?: boolean): Promise<VersionInfo> }
  dialog: { pickFolder(defaultPath?: string): Promise<string | null> }
  /** short speech-bubble lines summarized by a headless `claude -p --model haiku` (electron/summarize.ts) */
  bubble: {
    summarize(req: BubbleRequest): Promise<BubbleResult>
    state(): Promise<BubbleState>
    resetStats(): Promise<BubbleState>
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
  }
  /**
   * UI settings kept in ~/.hamster-desk/ui.json — not localStorage, which lives in the Electron
   * profile and therefore differs between the portable exe, `npm run dev` and the smoke runs.
   * `save` shallow-merges the patch (a `null` value deletes the key) and resolves to the merged state.
   */
  ui: {
    load(): Promise<UiState>
    save(patch: UiState): Promise<UiState>
  }
  win: {
    alwaysOnTop(on: boolean): void
    opacity(v: number): void
  }
  info(): Promise<{ version: string; platform: string; home: string; debugPrefs: Record<string, unknown> | null; claudeLanguage: string | null; uiPath: string }>
  /** smoke tests only: text to feed through xterm as if typed */
  onDebugType(cb: (ptyId: number, text: string) => void): () => void
}

const bridge: DeskBridge = {
  onEvent(cb) {
    const h = (_e: unknown, ev: SeqEvent): void => cb(ev)
    ipcRenderer.on('desk:event', h)
    return () => ipcRenderer.off('desk:event', h)
  },
  backlog: (after) => ipcRenderer.invoke('desk:backlog', after),
  sessions: () => ipcRenderer.invoke('desk:sessions'),
  pty: {
    create: (cols, rows, cwd) => ipcRenderer.invoke('pty:create', cols, rows, cwd),
    input: (id, data) => ipcRenderer.send('pty:input', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData(cb) {
      const h = (_e: unknown, id: number, data: string): void => cb(id, data)
      ipcRenderer.on('pty:data', h)
      return () => ipcRenderer.off('pty:data', h)
    },
    onExit(cb) {
      const h = (_e: unknown, id: number, code: number): void => cb(id, code)
      ipcRenderer.on('pty:exit', h)
      return () => ipcRenderer.off('pty:exit', h)
    },
  },
  statusline: {
    state: () => ipcRenderer.invoke('statusline:state'),
    install: () => ipcRenderer.invoke('statusline:install'),
    uninstall: () => ipcRenderer.invoke('statusline:uninstall'),
  },
  version: { check: (force) => ipcRenderer.invoke('version:check', force) },
  dialog: { pickFolder: (d) => ipcRenderer.invoke('dialog:pickFolder', d) },
  bubble: {
    summarize: (req) => ipcRenderer.invoke('bubble:summarize', req),
    state: () => ipcRenderer.invoke('bubble:state'),
    resetStats: () => ipcRenderer.invoke('bubble:resetStats'),
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
  },
  ui: {
    load: () => ipcRenderer.invoke('ui:load'),
    save: (patch) => ipcRenderer.invoke('ui:save', patch),
  },
  win: {
    alwaysOnTop: (on) => ipcRenderer.send('win:alwaysOnTop', on),
    opacity: (v) => ipcRenderer.send('win:opacity', v),
  },
  info: () => ipcRenderer.invoke('app:info'),
  onDebugType(cb) {
    const h = (_e: unknown, id: number, text: string): void => cb(id, text)
    ipcRenderer.on('debug:type', h)
    return () => ipcRenderer.off('debug:type', h)
  },
}

contextBridge.exposeInMainWorld('desk', bridge)
