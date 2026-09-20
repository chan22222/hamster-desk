// Recent and favourite folders. Two sources are merged: what Claude Code itself remembers
// (`projects.recent`, read from its history file by the main process) and the folders opened
// from this app (`hd.recentDirs` + `hd.recentMeta`, kept in localStorage).

const RECENT_KEY = 'hd.recentDirs'
const META_KEY = 'hd.recentMeta'
const FAV_KEY = 'hd.favDirs'
const MAX_RECENT = 24

export interface RecentEntry {
  path: string
  name: string
  /** last opened / last active, unix ms (0 when unknown) */
  at: number
  git: boolean
  claude: boolean
  fav: boolean
}

function loadList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function saveList(key: string, v: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}
function loadMeta(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(META_KEY) ?? '{}')
    return v && typeof v === 'object' ? (v as Record<string, number>) : {}
  } catch {
    return {}
  }
}

export function baseName(p: string): string {
  const t = p.replace(/[\\/]+$/, '')
  const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'))
  return i >= 0 ? t.slice(i + 1) || t : t
}

/** Remember a folder we just opened a terminal in. */
export function rememberRecent(dir: string): void {
  const list = [dir, ...loadList(RECENT_KEY).filter((d) => d.toLowerCase() !== dir.toLowerCase())].slice(0, MAX_RECENT)
  saveList(RECENT_KEY, list)
  const meta = loadMeta()
  meta[dir.toLowerCase()] = Date.now()
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    /* ignore */
  }
}

export function favDirs(): string[] {
  return loadList(FAV_KEY)
}
export function toggleFav(dir: string): string[] {
  const favs = favDirs()
  const next = favs.some((f) => f.toLowerCase() === dir.toLowerCase()) ? favs.filter((f) => f.toLowerCase() !== dir.toLowerCase()) : [...favs, dir]
  saveList(FAV_KEY, next)
  return next
}
export function isFav(dir: string, favs: string[]): boolean {
  return favs.some((f) => f.toLowerCase() === dir.toLowerCase())
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

/** Claude Code's own recent projects merged with the folders opened here, newest first. */
export async function recentProjects(limit = 30): Promise<RecentEntry[]> {
  const favs = favDirs()
  const byKey = new Map<string, RecentEntry>()
  const add = (e: RecentEntry): void => {
    const key = e.path.toLowerCase()
    const prev = byKey.get(key)
    if (prev) {
      prev.at = Math.max(prev.at, e.at)
      prev.git = prev.git || e.git
      prev.claude = prev.claude || e.claude
      return
    }
    byKey.set(key, e)
  }

  try {
    const rows = (await window.desk?.projects.recent(limit)) ?? []
    for (const r of rows) {
      if (r.exists === false) continue
      add({ path: r.path, name: baseName(r.path), at: r.lastActiveAt, git: r.git, claude: r.claude, fav: isFav(r.path, favs) })
    }
  } catch {
    /* the bridge may not be there (browser preview) */
  }

  const meta = loadMeta()
  for (const p of loadList(RECENT_KEY)) {
    add({ path: p, name: baseName(p), at: meta[p.toLowerCase()] ?? 0, git: false, claude: false, fav: isFav(p, favs) })
  }
  for (const p of favs) add({ path: p, name: baseName(p), at: meta[p.toLowerCase()] ?? 0, git: false, claude: false, fav: true })

  return [...byKey.values()]
    .map((e) => ({ ...e, fav: isFav(e.path, favs) }))
    .sort((a, b) => (a.fav === b.fav ? b.at - a.at : a.fav ? -1 : 1))
    .slice(0, limit)
}
