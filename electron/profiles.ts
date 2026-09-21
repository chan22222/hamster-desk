import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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
/** left inside an account folder whose delete could not finish, so that nothing takes it for a live account */
const TOMBSTONE = '.hamster-deleted'

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
  const bag = (raw && typeof raw === 'object' ? raw : {}) as { list?: unknown; currentId?: unknown; hideDefault?: unknown }
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
  // hidden only while there is another account to use: a list must never come out empty
  const hiddenDefault = bag.hideDefault === true && extra.length > 0
  const list: Profile[] = hiddenDefault ? extra : [{ id: DEFAULT_PROFILE_ID, name: defaultName, dir: null }, ...extra]
  const currentId = typeof bag.currentId === 'string' && list.some((p) => p.id === bag.currentId) ? bag.currentId : list[0].id
  // only said when true: a file of someone who never hid it keeps exactly the shape it always had
  return hiddenDefault ? { list, currentId, hiddenDefault } : { list, currentId }
}

export function loadProfiles(): ProfilesState {
  return sanitizeProfiles(loadUi().profiles)
}

function store(state: ProfilesState): ProfilesState {
  // `email` is looked up, never stored
  saveUi({ profiles: { list: state.list.map(({ id, name, dir }) => ({ id, name, dir })), currentId: state.currentId, ...(state.hiddenDefault ? { hideDefault: true } : {}) } })
  return state
}

/**
 * A short id nobody else has: `acc-2`, `acc-3`, … (it is also the folder name). `folderTaken` skips
 * an id whose folder is still there — a delete that could not finish (a file was locked) must not
 * hand its leftovers, login included, to the next account that gets the same number.
 */
export function nextProfileId(taken: string[], folderTaken: (id: string) => boolean = () => false): string {
  for (let n = 2; ; n++) {
    const id = `acc-${n}`
    if (!taken.includes(id) && !folderTaken(id)) return id
  }
}

/** A new, empty account folder. The user logs in by running `claude` there and typing `/login`. */
export function addProfile(name: string): { state: ProfilesState; added: Profile } {
  const state = loadProfiles()
  const id = nextProfileId(state.list.map((p) => p.id), (x) => existsSync(join(profilesRoot(), x)))
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
 * Take an account off the list. `removed` is what the caller then hands to `deleteProfileDir` —
 * which does nothing for the CLI's own account (it has no folder of ours: `dir` is null). That one
 * is only *hidden*, and only while another account is left to use; `showDefaultProfile` brings it back.
 */
export function removeProfile(id: string): { state: ProfilesState; removed: Profile | null } {
  const state = loadProfiles()
  const removed = state.list.find((p) => p.id === id) ?? null
  if (!removed) return { state, removed: null }
  const list = state.list.filter((p) => p.id !== id)
  if (list.length === 0) return { state, removed: null } // the last account stays
  const hiddenDefault = state.hiddenDefault === true || id === DEFAULT_PROFILE_ID
  return { state: store({ list, currentId: state.currentId === id ? list[0].id : state.currentId, hiddenDefault }), removed }
}

/** Put the CLI's own account back on the list (its folder and login were never touched). */
export function showDefaultProfile(): ProfilesState {
  const state = loadProfiles()
  if (!state.hiddenDefault) return state
  store({ ...state, hiddenDefault: false })
  return loadProfiles()
}

/**
 * Delete a removed account's folder — its login, settings and conversations. Only ever a folder
 * directly under ~/.hamster-desk/profiles: the default account has none, and a list somebody
 * edited by hand must not be able to point this at anything else. Best effort; what a running
 * process still holds stays behind (and `nextProfileId` then leaves that number alone).
 */
export function deleteProfileDir(p: Profile | null): boolean {
  if (!p?.dir) return false
  const root = resolve(profilesRoot())
  const dir = resolve(p.dir)
  if (!sameDir(dirname(dir), root) || sameDir(dir, root)) return false
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch {
    /* locked by something still running */
  }
  if (!existsSync(dir)) return true
  try {
    writeFileSync(join(dir, TOMBSTONE), '', 'utf8') // see adoptOrphanProfiles: this one was deleted on purpose
  } catch {
    /* ignore */
  }
  return false
}

/**
 * Accounts whose folder is still there but which the list no longer knows — put back on the list.
 *
 * The list lives in ui.json; the login lives in the folder. When ui.json is lost (see ui-store.ts
 * for how that used to happen after a reboot) every account vanished from the app while its folder,
 * login included, sat untouched under profiles/. Called once at start: a folder is adopted when its
 * name is one this app hands out (`acc-N`), nothing on the list points at it, the CLI has written
 * into it (so it was really used), and it was not deleted on purpose — a folder carrying the
 * tombstone is a delete that could not finish, and gets another try instead.
 */
export function adoptOrphanProfiles(): Profile[] {
  let names: string[]
  try {
    names = readdirSync(profilesRoot())
  } catch {
    return [] // no profiles folder: nothing was ever added
  }
  const state = loadProfiles()
  const adopted: Profile[] = []
  for (const id of names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (!/^acc-\d{1,6}$/.test(id)) continue
    const dir = join(profilesRoot(), id)
    if (state.list.some((p) => p.id === id || (p.dir !== null && sameDir(p.dir, dir)))) continue
    if (existsSync(join(dir, TOMBSTONE))) {
      deleteProfileDir({ id, name: id, dir })
      continue
    }
    if (!existsSync(join(dir, '.credentials.json')) && !existsSync(join(dir, '.claude.json'))) continue
    const email = emailOf({ id, name: id, dir })
    adopted.push({ id, name: cleanName(email?.split('@')[0], `계정 ${state.list.length + adopted.length + 1}`), dir })
  }
  if (adopted.length) store({ ...state, list: [...state.list, ...adopted] })
  return adopted
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

/**
 * The list as the UI shows it: every account with the login found next to it.
 *
 * There is no "default account" on screen. The CLI's own folder (~/.claude) is one account among
 * the others — it only differs in where it lives — so until the user names it, it is called what
 * the others are called when they are recovered: the first part of the login's email. `기본` stays
 * what is *stored* for "never named", so a file written by an older version reads the same.
 */
export function withEmails(state: ProfilesState): ProfilesState {
  return {
    ...state,
    list: state.list.map((p) => {
      const email = emailOf(p)
      const unnamed = p.id === DEFAULT_PROFILE_ID && p.name === DEFAULT_NAME
      return { ...p, email, name: unnamed ? cleanName(email?.split('@')[0], '계정 1') : p.name }
    }),
  }
}
