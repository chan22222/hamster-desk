import { EventEmitter } from 'node:events'
import { promises as fsp, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { SessionInfo } from '../../shared/events'
import { sessionsDir, findTranscript } from './paths'
import { parentMap, isDescendant, processAlive } from './processes'

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

  constructor(private readonly opts: SessionWatcherOptions) {
    super()
  }

  async start(): Promise<void> {
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
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async scan(): Promise<void> {
    if (this.scanning) {
      this.rescan = true
      return
    }
    this.scanning = true
    try {
      do {
        this.rescan = false
        await this.scanOnce()
      } while (this.rescan)
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
      if ((!prev || (ptyId === null && !prev.mine)) && owned.length) {
        pmap ??= await parentMap()
        // A claude that started a second ago is not in a map taken four seconds ago — and "not in
        // the map" used to read as "not ours", so a session started in one of this window's own
        // terminals showed up as a second, foreign tab until a later scan put it right. Ask again,
        // once per scan, before deciding.
        if (!pmap.has(pid) && !refreshed) {
          refreshed = true
          pmap = await parentMap(true)
        }
        const owner = owned.find((o) => isDescendant(pid, o.pid, pmap!))
        ptyId = owner ? owner.ptyId : null
      }
      const cwd = String(j.cwd ?? '')
      const transcriptPath = prev?.transcriptPath ?? findTranscript(sessionId, cwd, this.opts.baseDir)
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

    for (const [id] of this.sessions) {
      if (!seen.has(id)) {
        this.sessions.delete(id)
        this.emit('session_gone', id)
      }
    }
  }
}
