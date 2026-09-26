// Past conversations for one folder, read from the transcript files only.
//
// The rule that shapes everything here: never parse a whole file. A single `.jsonl` in this repo
// is already 22 MB and the biggest one measured was 95 MB, while everything the list needs sits at
// the two ends — the first `user` record (when it started, in which folder, on which branch, and
// what was asked first) and the last few hundred KB (the title records and the newest timestamp,
// which Claude Code re-appends rather than rewriting). So: 64 KB from the head, 512 KB from the
// tail, and a cache keyed on `path:size:mtime` so a second visit costs nothing.
//
// Pure node on purpose: no `electron` import anywhere in this module, so `scripts/unit/
// transcripts.test.ts` can run it under tsx. Plan §3.4. Owner: B.

import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_PROFILE_ID, type TranscriptEntry } from '../shared/events'
import { projectsDir, projectSlug } from './watcher/paths'
import { Tailer } from './watcher/tail'

/** how much of the head is scanned for the first prompt (the record is always near the top) */
const HEAD_BYTES = 64 * 1024
/** how much of the tail is scanned for the title records and the last timestamp */
const TAIL_BYTES = 512_000
/** newest files only; 60 × 576 KB is the worst case the first load can cost */
const MAX_FILES = 60
/** a title made from the first prompt is cut here */
const TITLE_MAX = 60
/** the subtitle (the last prompt) is cut here */
const SUB_MAX = 120

/** Everything about one transcript except whether it happens to be running right now, and whose it is. */
type Row = Omit<TranscriptEntry, 'live' | 'profileId'>

/** One account's config folder; no `baseDir` = the CLI's own (~/.claude, or `CLAUDE_CONFIG_DIR`). */
export interface TranscriptSource {
  profileId: string
  baseDir?: string
}

/** `path` → the row, plus the `size:mtime` stamp it was read at. */
const cache = new Map<string, { stamp: string; row: Row | null }>()

/** capture runs forward `[`-tagged stdout; a normal run stays quiet */
function log(msg: string): void {
  if (process.env.HAMSTER_CAPTURE) console.log(msg)
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function parse(line: string): Record<string, unknown> | null {
  if (!line || line[0] !== '{') return null
  try {
    const v = JSON.parse(line) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function msOf(v: unknown): number {
  if (typeof v !== 'string' || !v) return 0
  const n = Date.parse(v)
  return Number.isFinite(n) ? n : 0
}

/** how the CLI wraps the `user` records it writes for slash commands and `!` shell lines */
const LOCAL_WRAPPER = /^<(?:command-name|command-message|command-args|local-command-(?:stdout|stderr|caveat)|bash-(?:input|stdout|stderr))>/

/**
 * The text of a typed prompt, or null when this `user` record is not one.
 *
 * A `user` record is also how a tool result comes back, and how the CLI injects its own housekeeping
 * (`isMeta`). Neither is something a human asked, so neither may become a title.
 */
function promptOf(r: Record<string, unknown>): string | null {
  if (r.type !== 'user' || r.isMeta === true) return null
  const msg = r.message as Record<string, unknown> | undefined
  const content = msg?.content
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (b.type === 'tool_result') return null // a result, not a question
      if (b.type === 'text' && typeof b.text === 'string') text += (text ? ' ' : '') + b.text
    }
  } else return null
  text = text.trim()
  // `/login`, `/effort low`, a `!` shell line: the CLI files these as `user` records too, wrapped in
  // its own tags. A session made of nothing else never talked to the model and has nothing to resume.
  if (!text || LOCAL_WRAPPER.test(text)) return null
  return text
}

interface Head {
  /** the first typed prompt, or '' when the head holds none (see `readOne`) */
  prompt: string
  startedAt: number
  branch: string | null
}

/** Read the first `HEAD_BYTES` and stop at the first real prompt. */
async function readHead(path: string, size: number): Promise<Head> {
  const none: Head = { prompt: '', startedAt: 0, branch: null }
  const len = Math.min(size, HEAD_BYTES)
  if (len <= 0) return none
  const fh = await fsp.open(path, 'r')
  let buf: Buffer
  try {
    buf = Buffer.alloc(len)
    const { bytesRead } = await fh.read(buf, 0, len, 0)
    buf = buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
  // a head that stops short of the end cuts a line in half; drop that last fragment
  const complete = size > buf.length ? buf.subarray(0, Math.max(0, buf.lastIndexOf(0x0a))) : buf
  for (const raw of complete.toString('utf8').split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const r = parse(line)
    if (!r) continue
    const at = msOf(r.timestamp)
    const branch = typeof r.gitBranch === 'string' && r.gitBranch ? r.gitBranch : null
    // whatever comes first is when (and where) the session started, prompt or not
    if (!none.startedAt && at) none.startedAt = at
    if (!none.branch && branch) none.branch = branch
    const prompt = promptOf(r)
    if (prompt === null) continue
    return { prompt, startedAt: none.startedAt || at, branch: branch ?? none.branch }
  }
  return none
}

interface Tail {
  customTitle: string
  aiTitle: string
  lastPrompt: string
  lastAt: number
}

/** Read the last `TAIL_BYTES` and keep the *last* of each marker — they are appended, not rewritten. */
async function readTail(path: string): Promise<Tail> {
  const out: Tail = { customTitle: '', aiTitle: '', lastPrompt: '', lastAt: 0 }
  const tailer = new Tailer(
    path,
    (line) => {
      const r = parse(line)
      if (!r) return
      const at = msOf(r.timestamp)
      if (at > out.lastAt) out.lastAt = at
      if (r.type === 'custom-title' && typeof r.customTitle === 'string') out.customTitle = r.customTitle
      else if (r.type === 'ai-title' && typeof r.aiTitle === 'string') out.aiTitle = r.aiTitle
      else if (r.type === 'last-prompt' && typeof r.lastPrompt === 'string') out.lastPrompt = r.lastPrompt
    },
    { tailBytes: TAIL_BYTES },
  )
  await tailer.open()
  tailer.close()
  return out
}

/**
 * One transcript, summarized. `null` means "leave it out of the list": a file with no typed prompt
 * is a session that was opened and abandoned, and it has nothing to resume.
 */
async function readOne(path: string, sessionId: string, size: number, mtimeMs: number): Promise<Row | null> {
  const head = await readHead(path, size)
  const tail = await readTail(path)
  // No prompt in the head is not yet "no prompt": a first message with a pasted image is a single
  // line longer than the whole head, and a conversation opened with a custom slash command has no
  // plain text at the top either. The `last-prompt` marker settles it — the CLI only writes one
  // once something was really asked, so `/login`-and-leave sessions never have it.
  if (!head.prompt && !tail.lastPrompt.trim()) return null
  const title =
    clip(tail.customTitle, TITLE_MAX) ||
    clip(tail.aiTitle, TITLE_MAX) ||
    clip(head.prompt, TITLE_MAX) ||
    clip(tail.lastPrompt, TITLE_MAX) ||
    sessionId.slice(0, 8)
  return {
    sessionId,
    path,
    title,
    subtitle: clip(tail.lastPrompt || head.prompt, SUB_MAX),
    startedAt: head.startedAt || mtimeMs,
    lastAt: tail.lastAt || mtimeMs,
    branch: head.branch,
    size,
  }
}

/**
 * The past conversations of one folder, newest first, from every account at once.
 *
 * Each account keeps its own transcripts, and someone with several accounts switches between them —
 * so a folder's conversations are scattered over them all. Listing only the tab's account showed
 * whatever that account happened to hold (often weeks old) and hid yesterday's conversation because
 * it ran under another login. Each row says whose it is (`profileId`), and resuming it has to happen
 * under that account: `claude --resume` only looks in its own config folder.
 *
 * `live` = the session ids a claude is running right now (watcher.liveSessions); those rows are
 * shown but not resumable, because two claudes on one transcript would fight over the file.
 */
export async function listTranscripts(
  cwd: string,
  live: Set<string>,
  sources: TranscriptSource[] = [{ profileId: DEFAULT_PROFILE_ID }],
): Promise<TranscriptEntry[]> {
  if (!cwd) return []
  const t0 = Date.now()
  const stats: { path: string; sessionId: string; size: number; mtimeMs: number; profileId: string }[] = []
  for (const src of sources) {
    const dir = join(projectsDir(src.baseDir), projectSlug(cwd))
    let names: string[]
    try {
      names = (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => d.isFile() && d.name.endsWith('.jsonl')).map((d) => d.name)
    } catch {
      continue // no folder means this project has never been opened in Claude Code under this account
    }
    for (const name of names) {
      const path = join(dir, name)
      try {
        const st = await fsp.stat(path)
        if (st.size > 0) stats.push({ path, sessionId: name.slice(0, -6), size: st.size, mtimeMs: st.mtimeMs, profileId: src.profileId })
      } catch {
        /* vanished between readdir and stat */
      }
    }
  }
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs)
  // the same id under two accounts is one conversation copied over; the newer copy is the one that went on
  const seen = new Set<string>()
  const take = stats.filter((f) => !seen.has(f.sessionId) && seen.add(f.sessionId)).slice(0, MAX_FILES)

  let cached = 0
  const out: TranscriptEntry[] = []
  for (const f of take) {
    const stamp = `${f.path}:${f.size}:${f.mtimeMs}`
    const hit = cache.get(f.path)
    let row: Row | null
    if (hit && hit.stamp === stamp) {
      row = hit.row
      cached++
    } else {
      try {
        row = await readOne(f.path, f.sessionId, f.size, f.mtimeMs)
      } catch {
        row = null
      }
      cache.set(f.path, { stamp, row })
    }
    if (row) out.push({ ...row, profileId: f.profileId, live: live.has(row.sessionId) })
  }
  // the folder may have shrunk; do not let the cache grow forever
  if (cache.size > MAX_FILES * 4) for (const k of [...cache.keys()].slice(0, cache.size - MAX_FILES * 2)) cache.delete(k)

  log(`[transcripts] ${out.length} entries from ${take.length} files (${cached} cached, ${Date.now() - t0}ms)`)
  return out
}
