// Recent projects and favourites, kept in ~/.hamster-desk/ui.json (see `uiGet`/`uiSet` in store.ts).
//
// Only folders **this app** opened a terminal in are remembered. It used to merge in Claude Code's
// own prompt history (`~/.claude/history.jsonl`), which meant the list was full of folders the user
// had never opened here; that file is no longer read anywhere in the app.

import { uiGet, uiSet } from '../store'

const MAX_RECENT = 40

/** one row of the `recents` list in ui.json */
export interface RecentDir {
  path: string
  /** last opened here, unix ms */
  at: number
  /** how many terminals this app has opened in it */
  count: number
}

export interface RecentEntry extends RecentDir {
  name: string
  fav: boolean
}

const key = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()

export function baseName(p: string): string {
  const t = p.replace(/[\\/]+$/, '')
  const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'))
  return i >= 0 ? t.slice(i + 1) || t : t
}

/** The stored list, newest first, with anything that is not a `{ path }` row dropped. */
export function recentDirs(): RecentDir[] {
  const raw = uiGet<unknown>('recents', [])
  if (!Array.isArray(raw)) return []
  const out: RecentDir[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const { path, at, count } = r as Partial<RecentDir>
    if (typeof path !== 'string' || !path) continue
    out.push({ path, at: typeof at === 'number' && Number.isFinite(at) ? at : 0, count: typeof count === 'number' && count > 0 ? count : 1 })
  }
  return out.sort((a, b) => b.at - a.at)
}

/** Remember a folder we just opened a terminal in. */
export function rememberRecent(dir: string): void {
  if (!dir) return
  const prev = recentDirs()
  const hit = prev.find((r) => key(r.path) === key(dir))
  const rest = prev.filter((r) => key(r.path) !== key(dir))
  uiSet('recents', [{ path: dir, at: Date.now(), count: (hit?.count ?? 0) + 1 }, ...rest].slice(0, MAX_RECENT))
}

/** Take a folder off the list (the `×` on a row). Favourites are dropped with it. */
export function forgetRecent(dir: string): void {
  uiSet(
    'recents',
    recentDirs().filter((r) => key(r.path) !== key(dir)),
  )
  const favs = favDirs()
  if (favs.some((f) => key(f) === key(dir)))
    uiSet(
      'favs',
      favs.filter((f) => key(f) !== key(dir)),
    )
}

export function favDirs(): string[] {
  const raw = uiGet<unknown>('favs', [])
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x) : []
}

export function toggleFav(dir: string): string[] {
  const favs = favDirs()
  const next = favs.some((f) => key(f) === key(dir)) ? favs.filter((f) => key(f) !== key(dir)) : [...favs, dir]
  uiSet('favs', next)
  return next
}

export function isFav(dir: string, favs: string[]): boolean {
  return favs.some((f) => key(f) === key(dir))
}

/** The folder the next window should start in. */
export function lastCwd(): string {
  const v = uiGet<unknown>('lastCwd', '')
  return typeof v === 'string' ? v : ''
}
export function setLastCwd(dir: string): void {
  uiSet('lastCwd', dir)
}

/**
 * The folder the sidebar's file browser (탐색) shows: the terminal in front, and while there is no
 * terminal at all (the start card) the folder the next one would open in, then home. An empty
 * result means "leave it where it is" — that is what closing the last tab does. It never falls
 * back to the process's working directory: for the installed app that is its install folder, for
 * `npx electron .` the repository, and neither is a place the user chose.
 */
export function explorerDir(activeCwd: string | null | undefined, last: string, home: string): string {
  return activeCwd || last || home
}

/** Favourites first, then newest. Starred folders that were never opened here still show up. */
export function recentEntries(limit = MAX_RECENT): RecentEntry[] {
  const favs = favDirs()
  const byKey = new Map<string, RecentEntry>()
  for (const r of recentDirs()) byKey.set(key(r.path), { ...r, name: baseName(r.path), fav: isFav(r.path, favs) })
  for (const f of favs) if (!byKey.has(key(f))) byKey.set(key(f), { path: f, at: 0, count: 0, name: baseName(f), fav: true })
  return [...byKey.values()].sort((a, b) => (a.fav === b.fav ? b.at - a.at : a.fav ? -1 : 1)).slice(0, limit)
}

/** "방금", "12분 전", "3시간 전", "어제", "9/12" */
export function relTime(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return '방금'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}시간 전`
  if (diff < 172800_000) return '어제'
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** Shorten a path in the middle, so both the drive and the folder stay readable. */
export function middlePath(p: string, max = 38): string {
  if (p.length <= max) return p
  const keep = Math.floor((max - 1) / 2)
  return `${p.slice(0, keep)}…${p.slice(p.length - keep)}`
}

/**
 * Which of these folders are still there. One IPC call for the whole list; the bridge is missing in
 * the browser preview, where every path is simply assumed to exist.
 */
export async function missingDirs(paths: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (!paths.length || !window.desk) return out
  try {
    const map = await window.desk.fs.exists(paths)
    for (const p of paths) if (map[p] === false) out.add(key(p))
  } catch {
    /* treat an unreachable main process as "all fine" */
  }
  return out
}

export const dirKey = key
