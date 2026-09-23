import { EventEmitter } from 'node:events'
import { promises as fsp, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { SessionInfo } from '../../shared/events'
import { sessionsDir, transcriptAt } from './paths'
import { parentMap, retainParentMap, isDescendant, processAlive } from './processes'

export interface OwnedShell {
  ptyId: number
  pid: number
}

export interface SessionWatcherOptions {
  /** shells this window owns; a claude process descending from one is flagged `mine` with that ptyId */
  ownedShells: () => OwnedShell[]
  pollMs?: number
  /** another account's config folder; without it, the CLI's own (~/.claude) */
  baseDir?: string
  /** stamped on every session found there */
  profileId?: string
  /** the parent-pid map; processes.ts's PowerShell query unless a test hands in its own */
  parents?: (fresh?: boolean) => Promise<Map<number, number>>
}

/**
 * Watches ~/.claude/sessions/<pid>.json (written by every interactive claude process) and emits
 * 'session' (upsert) / 'session_gone'. Liveness is checked with a signal-0 probe because a killed
 * terminal can leave the file behind.
 */
export class SessionWatcher extends EventEmitter {
  readonly sessions = new Map<string, SessionInfo>()
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private scanning = false
  private rescan = false
  private stopped = false
  private release: (() => void) | null = null
  /**
   * Sessions judged to run outside this window, and under which shells. A claude's ancestry does not
   * change, so asking again every scan only re-ran PowerShell + WMI every few seconds for as long as
   * a claude was open in VS Code or another terminal. The verdict stands until a new shell appears.
   */
  private external = new Map<string, { pid: number; shells: number }>()
  private shellKeys = new Set<string>()
  /** bumped whenever this window gets a shell it did not have: every external verdict is asked again */
  private shells = 0

  constructor(private readonly opts: SessionWatcherOptions) {
    super()
  }

  async start(): Promise<void> {
    this.release ??= retainParentMap()
    const dir = sessionsDir(this.opts.baseDir)
    try {
      this.watcher = watch(dir, { persistent: false }, () => void this.scan())
      this.watcher.on('error', () => {})
    } catch {
      // directory may not exist yet; polling covers it
    }
    this.timer = setInterval(() => void this.scan(), this.opts.pollMs ?? 2500)
    await this.scan()
  }

  stop(): void {
    this.stopped = true
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.release?.()
    this.release = null
  }

  async scan(): Promise<void> {
    if (this.stopped) return
    if (this.scanning) {
      this.rescan = true
      return
    }
    this.scanning = true
    try {
      do {
        this.rescan = false
        await this.scanOnce()
      } while (this.rescan && !this.stopped)
    } finally {
      this.scanning = false
    }
  }

  private async scanOnce(): Promise<void> {
    const dir = sessionsDir(this.opts.baseDir)
    let names: string[] = []
    try {
      names = (await fsp.readdir(dir)).filter((n) => /^\d+\.json$/.test(n))
    } catch {
      names = []
    }
    const seen = new Set<string>()
    const owned = this.opts.ownedShells()
    const keys = owned.map((o) => `${o.ptyId}:${o.pid}`)
    if (keys.some((k) => !this.shellKeys.has(k))) this.shells++ // a closed shell cannot adopt anyone
    this.shellKeys = new Set(keys)
    let pmap: Map<number, number> | null = null
    let refreshed = false

    for (const n of names) {
      let raw: string
      try {
        raw = await fsp.readFile(join(dir, n), 'utf8')
      } catch {
        continue
      }
      let j: Record<string, unknown>
      try {
        j = JSON.parse(raw)
      } catch {
        continue // half-written; the next change event will retry
      }
      const pid = Number(j.pid)
      const sessionId = String(j.sessionId ?? '')
      if (!pid || !sessionId) continue
      if (!processAlive(pid)) continue
      seen.add(sessionId)

      const prev = this.sessions.get(sessionId)
      let ptyId = prev?.ptyId ?? null
      const verdict = this.external.get(sessionId)
      const settled = verdict !== undefined && verdict.pid === pid && verdict.shells === this.shells
      if (ptyId === null && !settled && owned.length) {
        const parents = this.opts.parents ?? parentMap
        pmap ??= await parents()
        // A claude that started a second ago is not in a map taken four seconds ago — and "not in
        // the map" used to read as "not ours", so a session started in one of this window's own
        // terminals showed up as a second, foreign tab until a later scan put it right. Ask again,
        // once per scan, before deciding.
        if (!pmap.has(pid) && !refreshed) {
          refreshed = true
          pmap = await parents(true)
        }
        const owner = owned.find((o) => isDescendant(pid, o.pid, pmap!))
        ptyId = owner ? owner.ptyId : null
        // "not ours" only stands when the map knew the pid; otherwise (a failed query, a claude
        // younger than both maps) the next scan asks again
        if (ptyId === null && pmap.has(pid)) this.external.set(sessionId, { pid, shells: this.shells })
      }
      if (this.stopped) return
      const cwd = String(j.cwd ?? '')
      // a session still waiting for its transcript is DeskWatcher's to keep looking for (with backoff);
      // here only a new one gets the one cheap look
      const transcriptPath = prev ? prev.transcriptPath : await transcriptAt(sessionId, cwd, this.opts.baseDir)
      if (this.stopped) return
      const info: SessionInfo = {
        sessionId,
        pid,
        cwd,
        name: String(j.name ?? ''),
        status: String(j.status ?? 'idle'),
        startedAt: Number(j.startedAt ?? 0),
        updatedAt: Number(j.updatedAt ?? 0),
        version: String(j.version ?? ''),
        sessionKind: String(j.kind ?? ''),
        mine: ptyId !== null,
        ptyId,
        transcriptPath,
        ...(this.opts.profileId ? { profileId: this.opts.profileId } : {}),
      }
      if (
        !prev ||
        prev.status !== info.status ||
        prev.name !== info.name ||
        prev.transcriptPath !== info.transcriptPath ||
        prev.cwd !== info.cwd ||
        prev.ptyId !== info.ptyId
      ) {
        this.sessions.set(sessionId, info)
        this.emit('session', info)
      }
    }

    if (this.stopped) return
    for (const [id] of this.sessions) {
      if (!seen.has(id)) {
        this.sessions.delete(id)
        this.external.delete(id)
        this.emit('session_gone', id)
      }
    }
  }
}
