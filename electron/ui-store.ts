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
 * of accounts and the saved tabs, and four things used to be able to wipe it, or parts of it:
 *  - a read that failed because something held the file for a moment (an antivirus or a sync client
 *    going over the user folder right after a reboot) counted as "no file", and the next save — a
 *    window move is enough — wrote that emptiness over everything. Now a file that exists but cannot
 *    be read is retried, and while it stays unreadable nothing is written at all;
 *  - the write was atomic but not durable: rename without fsync can leave a file of zeros after a
 *    power cut. Now the data is flushed before the rename;
 *  - a damaged file meant starting from nothing. Now the previous good file is kept as ui.bak.json
 *    and read instead;
 *  - the file is shared by every run mode — that is the point of it — and each process kept its own
 *    copy in memory and wrote *that* back whole. Two of them alive at once, the installed app and an
 *    `npm run dev` or capture run started from a Claude Code session inside it, overwrote each
 *    other's additions: a folder starred or opened in one was gone from the file as soon as the
 *    other so much as moved its window, and gone for good once the first one restarted and read the
 *    file back. Now a write starts from the file as it is at that moment and puts only the keys this
 *    process changed on top of it; a list both sides changed gets the *difference* this process made
 *    (what it added, what it removed) applied to the other's version rather than replacing it. And a
 *    capture run writes nothing at all (`setUiReadOnly`).
 */

const DEBOUNCE_MS = 300
/** A UI preference file this big is a bug (or an accident); refuse rather than write it. */
const MAX_BYTES = 256 * 1024
/** a file that is there but will not open: how often to look again, and how long to wait in between */
const READ_RETRIES = 8
const READ_RETRY_MS = 60
/** a write that could not happen (the file would not open, the rename failed): when to try again, and how often */
const RETRY_WRITE_MS = 2000
const WRITE_RETRIES = 5

/** ~/.hamster-desk/ui.json. Read from the env on every call so tests can point HAMSTER_HOME at a temp dir. */
export function uiPath(): string {
  return join(process.env.HAMSTER_HOME || join(homedir(), '.hamster-desk'), 'ui.json')
}

// In-memory copy of the file plus this process's changes since it last read or wrote it. What a
// pending (debounced) write will put on disk — merged onto the file as it is then — so it is the
// newest state while `timer` is set. Assumes HAMSTER_HOME does not change under a running process.
let cache: UiState | null = null
/**
 * The keys changed since the last write, each with the value its author was replacing: the base
 * the difference is taken against when the file turns out to hold something else (see `merge`).
 * The first change to a key in a cycle sets the base; later ones keep it, so two changes to the
 * same list still come out as one difference from where the author started.
 */
const dirty = new Map<string, unknown>()
let timer: ReturnType<typeof setTimeout> | null = null
let writeRetries = 0
/** a capture run: changes stay in memory and nothing reaches the file */
let readOnly = false

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

/**
 * The file. `from` says how it came: 'file' — read and parsed; 'backup' — the file was damaged and
 * ui.bak.json stood in for it; 'none' — there is no file (a first run); 'unreadable' — there is a
 * file and it would not open. The last is *not* an empty file (see the header) and comes without
 * a state.
 */
function readFromDisk(): { state: UiState; from: 'file' | 'backup' | 'none' } | { state: null; from: 'unreadable' } {
  const file = uiPath()
  let raw = ''
  for (let attempt = 0; ; attempt++) {
    try {
      raw = readFileSync(file, 'utf8')
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { state: {}, from: 'none' } // no file yet: a first run
      if (attempt >= READ_RETRIES) return { state: null, from: 'unreadable' }
      sleepSync(READ_RETRY_MS)
    }
  }
  const state = parseState(raw)
  if (state) return { state, from: 'file' }
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
  return restored ? { state: restored, from: 'backup' } : { state: {}, from: 'none' }
}

/** true once the file holds `state` */
function writeNow(state: UiState): boolean {
  const file = uiPath()
  try {
    const text = JSON.stringify(state, null, 2)
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
      copyFileSync(file, backupPath()) // what is about to be replaced was just read by us: it is good
    } catch {
      /* no file yet */
    }
    renameSync(tmp, file) // atomic: a crash mid-write leaves the previous ui.json intact
    return true
  } catch {
    return false // a settings file we cannot write is not worth an exception
  }
}

const tooBig = (state: UiState): boolean => {
  try {
    return Buffer.byteLength(JSON.stringify(state, null, 2), 'utf8') > MAX_BYTES
  } catch {
    return true
  }
}

/** Take what is on disk as the state this process knows. Only called with nothing pending. */
function adopt(state: UiState): UiState {
  cache = state
  dirty.clear()
  return state
}

// ---- merging with what another process wrote --------------------------------------------------

/** how src/sidebar/recent.ts tells two folders apart: no case, no trailing slash */
const pathKey = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()

/**
 * What makes two list items the same item. `favs` is a list of paths and `recents` a list of
 * `{ path, at, count }` rows, so a string and an object's `path` are compared as folders — the
 * same rule the renderer uses, or a folder starred as `c:\x\` in one process and `C:\x` in the
 * other would come out twice. Anything else is itself, serialized.
 */
function identity(item: unknown): string {
  if (typeof item === 'string') return `s:${pathKey(item)}`
  const path = item && typeof item === 'object' ? (item as { path?: unknown }).path : undefined
  if (typeof path === 'string') return `p:${pathKey(path)}`
  try {
    return `j:${JSON.stringify(item)}`
  } catch {
    return 'j:?'
  }
}

/**
 * This process's version of a list (`ours`, made from `base`) and the file's (`theirs`) as one:
 * ours, in our order, then whatever the other side has that we never had. An item in `base` that
 * ours dropped stays dropped — that was an `×` or an un-star, done on purpose — and one the other
 * side dropped stays while ours still has it: a stale row is cheaper than a lost one. Where both
 * hold the same folder, ours is taken.
 */
function mergeLists(ours: unknown[], theirs: unknown[], base: unknown[]): unknown[] {
  const had = new Set(base.map(identity))
  const have = new Set(ours.map(identity))
  const out = [...ours]
  for (const item of theirs) {
    const id = identity(item)
    if (have.has(id) || had.has(id)) continue
    have.add(id)
    out.push(item)
  }
  return out
}

const sameJson = (a: unknown, b: unknown): boolean => {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/**
 * The file as another process may have left it (`theirs`) with this process's changes on top.
 * A key this process did not touch is theirs, whatever this process last saw in it: it was never
 * ours to write. A key it did touch is ours — unless it is a list and the file's version is not
 * what the change was made from, in which case the two are merged (above): "the last one to save
 * wins" is exactly how a folder starred in one window vanished from the other.
 */
function merge(theirs: UiState, ours: UiState): UiState {
  const next: UiState = { ...theirs }
  for (const [k, base] of dirty) {
    const mine = ours[k]
    if (mine === undefined) {
      delete next[k]
      continue
    }
    const other = theirs[k]
    const contested = Array.isArray(mine) && Array.isArray(other) && !sameJson(other, base)
    next[k] = contested ? mergeLists(mine, other, Array.isArray(base) ? base : []) : mine
  }
  return next
}

// ---- the API ----------------------------------------------------------------------------------

export function loadUi(): UiState {
  // nothing pending → the file is the truth (it may have changed elsewhere); unreadable → what we
  // last knew. A read-only run keeps what it changed in memory, so it reads the file only once.
  if (!timer && !(readOnly && cache)) {
    const { state } = readFromDisk()
    if (state) adopt(state)
  }
  return { ...(cache ?? {}) }
}

/**
 * Shallow-merge `patch` into the stored state and schedule a write; returns the merged result.
 * A `null` value deletes its key. Values that JSON cannot represent (functions, undefined, cycles)
 * are dropped. If the result would exceed 256 KB nothing changes at all.
 *
 * `base` is what the caller is replacing, per key — the renderer sends the value its own copy held,
 * `null` for none. A key left out of it is taken from this process's copy, which is right for the
 * main-process callers (they read through `loadUi` just before). It matters for a list: the write
 * applies the difference between `base` and the new value to the file, so what the caller added
 * and removed is what changes, and what another process put there meanwhile stays.
 */
export function saveUi(patch: UiState, base?: UiState): UiState {
  const known = cache ?? readFromDisk().state
  // never merge into — and then write over — a file we could not read
  if (known === null) return {}
  if (cache === null) adopt(known)
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ...known }

  const next: UiState = { ...known }
  const touched: string[] = []
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      delete next[k]
      touched.push(k)
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
      touched.push(k)
    } catch {
      /* unreachable, but never throw from here */
    }
  }

  if (tooBig(next)) return { ...known }

  cache = next
  if (readOnly) return { ...next }
  for (const k of touched) {
    if (dirty.has(k)) continue
    const own = base && Object.prototype.hasOwnProperty.call(base, k)
    dirty.set(k, own ? (base[k] === null ? undefined : base[k]) : known[k])
  }
  // Trailing debounce that does NOT restart on every call: a slider being dragged still lands on
  // disk within 300 ms of its first move instead of only when the user stops.
  if (!timer) timer = setTimeout(() => flushUi(), DEBOUNCE_MS)
  return { ...next }
}

/**
 * Write a pending change out immediately (called on shutdown so the last edit is not lost).
 *
 * The file is read again first: another process may have written it since, and what it wrote is
 * kept (see `merge`). A file that will not open right now is not written over — the change stays
 * pending and is tried again shortly; if that was the shutdown, the last 300 ms of settings are
 * the price, which is less than a file another process may be writing this very moment.
 */
export function flushUi(): void {
  if (!timer) return
  clearTimeout(timer)
  timer = null
  if (!cache || dirty.size === 0) return
  const retryLater = (): void => {
    if (writeRetries++ < WRITE_RETRIES) timer = setTimeout(() => flushUi(), RETRY_WRITE_MS)
    else {
      writeRetries = 0
      dirty.clear() // given up: the change stays in memory for this run and that is all
    }
  }
  const disk = readFromDisk()
  if (disk.state === null) {
    retryLater()
    return
  }
  const next = disk.from === 'none' ? { ...cache } : merge(disk.state, cache)
  if (tooBig(next)) {
    dirty.clear() // refused, as saveUi refuses: nothing this size is written
    return
  }
  if (!writeNow(next)) {
    retryLater()
    return
  }
  writeRetries = 0
  adopt(next)
}

/**
 * A capture run (HAMSTER_CAPTURE) restores what the file says — that is what it photographs — but
 * nothing it does may reach the file: it shares ~/.hamster-desk/ui.json with the installed app that
 * is usually running beside it, and the README's recipes are run without a HAMSTER_HOME of their
 * own more often than not. Changes are kept in memory so the run itself stays consistent (the
 * account it adds, the folder it opens) and are forgotten with it.
 */
export function setUiReadOnly(on: boolean): void {
  readOnly = on
}
