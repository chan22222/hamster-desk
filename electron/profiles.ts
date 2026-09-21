import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_PROFILE_ID, type Profile, type ProfilesState } from '../shared/events'
import { loadUi, saveUi } from './ui-store'
import { claudeDir } from './watcher/paths'

/**
 * Several Claude Code accounts side by side.
 *
 * The CLI keeps everything that makes an account — the login, settings, MCP servers, memory, the
 * transcripts — in one config folder, and `CLAUDE_CONFIG_DIR` says which. So an account here is
 * just a folder: the default one is whatever the CLI uses by itself (~/.claude; the app never sets
 * the variable for it, and never writes there), and every extra one is an empty folder under
 * ~/.hamster-desk/profiles/ that the user logs into once with `/login`.
 *
 * Free of any `electron` import, like ui-store.ts, so scripts/unit can drive it with tsx.
 */

const NAME_MAX = 24
const DEFAULT_NAME = '기본'

/** Read from the env on every call so tests can point HAMSTER_HOME at a temp dir. */
function profilesRoot(): string {
  return join(process.env.HAMSTER_HOME || join(homedir(), '.hamster-desk'), 'profiles')
}

const cleanName = (v: unknown, fallback: string): string => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : ''
  return s || fallback
}

/** Same folder? Windows paths differ in case and trailing separators without meaning anything. */
function sameDir(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const r = resolve(p).replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  return norm(a) === norm(b)
}

/**
 * Whatever is in ui.json → a list that always starts with the default account, has no duplicate
 * ids or folders, and a `currentId` that exists. Pure, so the unit test can feed it rubbish.
 */
export function sanitizeProfiles(raw: unknown): ProfilesState {
  const bag = (raw && typeof raw === 'object' ? raw : {}) as { list?: unknown; currentId?: unknown }
  const items = Array.isArray(bag.list) ? bag.list : []
  let defaultName = DEFAULT_NAME
  const extra: Profile[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const p = it as { id?: unknown; name?: unknown; dir?: unknown }
    if (p.id === DEFAULT_PROFILE_ID) {
      defaultName = cleanName(p.name, DEFAULT_NAME) // the default account can be renamed, nothing else
      continue
    }
    if (typeof p.id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(p.id)) continue
    if (typeof p.dir !== 'string' || !p.dir) continue
    if (extra.some((e) => e.id === p.id || sameDir(e.dir as string, p.dir as string))) continue
    extra.push({ id: p.id, name: cleanName(p.name, p.id), dir: p.dir })
  }
  const list: Profile[] = [{ id: DEFAULT_PROFILE_ID, name: defaultName, dir: null }, ...extra]
  const currentId = typeof bag.currentId === 'string' && list.some((p) => p.id === bag.currentId) ? bag.currentId : DEFAULT_PROFILE_ID
  return { list, currentId }
}

export function loadProfiles(): ProfilesState {
  return sanitizeProfiles(loadUi().profiles)
}

function store(state: ProfilesState): ProfilesState {
  // `email` is looked up, never stored
  saveUi({ profiles: { list: state.list.map(({ id, name, dir }) => ({ id, name, dir })), currentId: state.currentId } })
  return state
}

/** A short id nobody else has: `acc-2`, `acc-3`, … (it is also the folder name). */
export function nextProfileId(taken: string[]): string {
  for (let n = 2; ; n++) {
    const id = `acc-${n}`
    if (!taken.includes(id)) return id
  }
}

/** A new, empty account folder. The user logs in by running `claude` there and typing `/login`. */
export function addProfile(name: string): { state: ProfilesState; added: Profile } {
  const state = loadProfiles()
  const id = nextProfileId(state.list.map((p) => p.id))
  const dir = join(profilesRoot(), id)
  mkdirSync(dir, { recursive: true })
  const added: Profile = { id, name: cleanName(name, `계정 ${state.list.length + 1}`), dir }
  return { state: store({ ...state, list: [...state.list, added] }), added }
}

export function renameProfile(id: string, name: string): ProfilesState {
  const state = loadProfiles()
  return store({ ...state, list: state.list.map((p) => (p.id === id ? { ...p, name: cleanName(name, p.name) } : p)) })
}

/**
 * Forget an account. Its folder stays on disk on purpose — it holds a login and transcripts, and
 * deleting somebody's conversations is not something a list row's × should do.
 */
export function removeProfile(id: string): ProfilesState {
  const state = loadProfiles()
  if (id === DEFAULT_PROFILE_ID) return state
  const list = state.list.filter((p) => p.id !== id)
  return store({ list, currentId: state.currentId === id ? DEFAULT_PROFILE_ID : state.currentId })
}

export function setCurrentProfile(id: string): ProfilesState {
  const state = loadProfiles()
  if (!state.list.some((p) => p.id === id)) return state
  return store({ ...state, currentId: id })
}

/** What `CLAUDE_CONFIG_DIR` should be for a shell of this account; null = leave the env alone. */
export function configDirOf(id: string | null | undefined, state: ProfilesState = loadProfiles()): string | null {
  return state.list.find((p) => p.id === id)?.dir ?? null
}

/** Where this account's `sessions/` and `projects/` are. */
export function baseDirOf(id: string | null | undefined, state: ProfilesState = loadProfiles()): string {
  return configDirOf(id, state) ?? claudeDir()
}

/** a config folder no account here points at (one that was forgotten, or somebody's own setup) */
export const UNKNOWN_PROFILE_ID = 'unknown'

/**
 * Which account a session that ran with this `CLAUDE_CONFIG_DIR` belongs to ('' = unset). A folder
 * nobody here knows is *not* the default account: its rate limits are somebody else's, and showing
 * them on the default account's gauge would be wrong in the one way that matters.
 */
export function profileOfConfigDir(dir: string, state: ProfilesState = loadProfiles()): string {
  if (!dir || sameDir(dir, claudeDir())) return DEFAULT_PROFILE_ID
  return state.list.find((p) => p.dir !== null && sameDir(p.dir, dir))?.id ?? UNKNOWN_PROFILE_ID
}

/** `.claude.json` can grow to megabytes of per-project history; the login sits in the first part. */
const EMAIL_SCAN_BYTES = 4 * 1024 * 1024

/**
 * Who is logged in, read-only, from the file the CLI keeps next to the account: with
 * `CLAUDE_CONFIG_DIR` set it is `<dir>/.claude.json`, without it `~/.claude.json`.
 */
export function emailOf(p: Profile): string | null {
  const file = p.dir ? join(p.dir, '.claude.json') : process.env.CLAUDE_CONFIG_DIR ? join(claudeDir(), '.claude.json') : join(homedir(), '.claude.json')
  try {
    const size = statSync(file).size
    let text: string
    if (size <= EMAIL_SCAN_BYTES) text = readFileSync(file, 'utf8')
    else {
      const fd = openSync(file, 'r')
      try {
        const buf = Buffer.alloc(EMAIL_SCAN_BYTES)
        text = buf.toString('utf8', 0, readSync(fd, buf, 0, EMAIL_SCAN_BYTES, 0))
      } finally {
        closeSync(fd)
      }
    }
    const m = text.match(/"emailAddress"\s*:\s*"([^"\\]{3,120})"/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

export function withEmails(state: ProfilesState): ProfilesState {
  return { ...state, list: state.list.map((p) => ({ ...p, email: emailOf(p) })) }
}
