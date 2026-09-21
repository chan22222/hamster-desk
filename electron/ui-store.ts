import { closeSync, copyFileSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { UiState } from '../shared/events'

export type { UiState }

/**
 * Where the renderer's UI settings live: ~/.hamster-desk/ui.json.
 *
 * They used to sit in localStorage, which belongs to the Electron *profile* — and this app gives
 * each run mode its own (packaged %APPDATA%\hamster-desk, `npm run dev` …-dev, smoke %TEMP%\…-smoke,
 * see electron/main.ts). So a language or panel change made in the portable exe was invisible to a
 * dev run, and clearing the cache wiped it. One plain file outside every profile fixes both.
 *
 * Deliberately free of any `electron` import: pure node, so scripts/ui-store-smoke.ts can drive it
 * with tsx. Every failure is swallowed — losing a UI preference must never take the app down.
 *
 * What must never happen is the opposite: the app *causing* the loss. The file also holds the list
 * of accounts and the saved tabs, and three things used to be able to wipe it:
 *  - a read that failed because something held the file for a moment (an antivirus or a sync client
 *    going over the user folder right after a reboot) counted as "no file", and the next save — a
 *    window move is enough — wrote that emptiness over everything. Now a file that exists but cannot
 *    be read is retried, and while it stays unreadable nothing is written at all;
 *  - the write was atomic but not durable: rename without fsync can leave a file of zeros after a
 *    power cut. Now the data is flushed before the rename;
 *  - a damaged file meant starting from nothing. Now the previous good file is kept as ui.bak.json
 *    and read instead.
 */

const DEBOUNCE_MS = 300
/** A UI preference file this big is a bug (or an accident); refuse rather than write it. */
const MAX_BYTES = 256 * 1024
/** a file that is there but will not open: how often to look again, and how long to wait in between */
const READ_RETRIES = 8
const READ_RETRY_MS = 60

/** ~/.hamster-desk/ui.json. Read from the env on every call so tests can point HAMSTER_HOME at a temp dir. */
export function uiPath(): string {
  return join(process.env.HAMSTER_HOME || join(homedir(), '.hamster-desk'), 'ui.json')
}

// In-memory copy of the file. Also what a pending (debounced) write will flush, so it is the newest
// state while `timer` is set. Assumes HAMSTER_HOME does not change under a running process.
let cache: UiState | null = null
let timer: ReturnType<typeof setTimeout> | null = null

const backupPath = (): string => join(dirname(uiPath()), 'ui.bak.json')

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function parseState(raw: string): UiState | null {
  try {
    const j: unknown = JSON.parse(raw)
    if (j && typeof j === 'object' && !Array.isArray(j)) return j as UiState
  } catch {
    /* corrupt */
  }
  return null
}

/** `null`: the file exists but could not be read. That is *not* an empty file — see the header. */
function readFromDisk(): UiState | null {
  const file = uiPath()
  let raw = ''
  for (let attempt = 0; ; attempt++) {
    try {
      raw = readFileSync(file, 'utf8')
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {} // no file yet: a first run
      if (attempt >= READ_RETRIES) return null
      sleepSync(READ_RETRY_MS)
    }
  }
  const state = parseState(raw)
  if (state) return state
  // damaged: the previous good file, if there is one, beats starting from nothing
  let restored: UiState | null = null
  try {
    restored = parseState(readFileSync(backupPath(), 'utf8'))
  } catch {
    restored = null
  }
  // Keep the damaged file around once (overwriting an older copy) instead of silently deleting it.
  try {
    const bad = join(dirname(file), 'ui.corrupt.json')
    try {
      renameSync(file, bad)
    } catch {
      copyFileSync(file, bad)
      rmSync(file, { force: true })
    }
  } catch {
    /* ignore */
  }
  return restored ?? {}
}

function writeNow(state: UiState): void {
  const file = uiPath()
  try {
    const text = JSON.stringify(state, null, 2)
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    // flushed before the rename: without it the rename can survive a power cut that the data does not
    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, text, null, 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try {
      copyFileSync(file, backupPath()) // what is about to be replaced was read (or written) by us: it is good
    } catch {
      /* no file yet */
    }
    renameSync(tmp, file) // atomic: a crash mid-write leaves the previous ui.json intact
  } catch {
    /* a settings file we cannot write is not worth an exception */
  }
}

export function loadUi(): UiState {
  // nothing pending → the file is the truth (it may have changed elsewhere); unreadable → what we last knew
  if (!timer) cache = readFromDisk() ?? cache
  return { ...(cache ?? {}) }
}

/**
 * Shallow-merge `patch` into the stored state and schedule a write; returns the merged result.
 * A `null` value deletes its key. Values that JSON cannot represent (functions, undefined, cycles)
 * are dropped. If the result would exceed 256 KB nothing changes at all.
 */
export function saveUi(patch: UiState): UiState {
  if (cache === null) cache = readFromDisk()
  // never merge into — and then write over — a file we could not read
  if (cache === null) return {}
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ...cache }

  const next: UiState = { ...cache }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      delete next[k]
      continue
    }
    let ser: string | undefined
    try {
      ser = JSON.stringify(v)
    } catch {
      continue // circular, BigInt, throwing toJSON …
    }
    if (ser === undefined) continue // function / undefined
    try {
      next[k] = JSON.parse(ser) as unknown // normalized copy, so the caller cannot mutate it later
    } catch {
      /* unreachable, but never throw from here */
    }
  }

  try {
    if (Buffer.byteLength(JSON.stringify(next, null, 2), 'utf8') > MAX_BYTES) return { ...cache }
  } catch {
    return { ...cache }
  }

  cache = next
  // Trailing debounce that does NOT restart on every call: a slider being dragged still lands on
  // disk within 300 ms of its first move instead of only when the user stops.
  if (!timer) timer = setTimeout(() => flushUi(), DEBOUNCE_MS)
  return { ...cache }
}

/** Write a pending change out immediately (called on shutdown so the last edit is not lost). */
export function flushUi(): void {
  if (!timer) return
  clearTimeout(timer)
  timer = null
  if (cache) writeNow(cache)
}
