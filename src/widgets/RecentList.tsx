// The list of projects this app has opened a terminal in: favourites first, then newest. It is the
// body of the `+` menu and of the start card that fills the pane when no terminal is open — the
// sidebar no longer carries a copy, because "recent" is something you want when you are starting
// something, not something you want in the way all day.

import { useEffect, useMemo, useState } from 'react'
import { useUi } from '../i18n'
import { dirKey, forgetRecent, middlePath, missingDirs, recentEntries, relTime, toggleFav, type RecentEntry } from '../sidebar/recent'
import { useDesk } from '../store'
import { IconClose, IconFolder, IconSearch, IconStar } from './icons'

export function RecentList({ onOpen, maxHeight = 300 }: { onOpen: (dir: string) => void; maxHeight?: number }) {
  const u = useUi()
  // Derived from the settings bag, again whenever it changes (`uiRev`). The start card mounts
  // before the file has been read, so a list taken once at mount was empty for the rest of the
  // run — "no projects yet" on every launch, over a file that had them. A star or × in the
  // sidebar changes the bag too, and shows here without a remount.
  const rev = useDesk((s) => s.uiRev)
  const rows = useMemo<RecentEntry[]>(() => recentEntries(), [rev])
  const [missing, setMissing] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  // one existence check per distinct set of folders, not per change to the bag (a tab switch is one)
  const folders = rows.map((r) => r.path).join('\n')
  useEffect(() => {
    let alive = true
    void missingDirs(folders ? folders.split('\n') : []).then((s) => {
      if (alive) setMissing(s)
    })
    return () => {
      alive = false
    }
  }, [folders])

  const q = filter.trim().toLowerCase()
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)) : rows

  const open = (r: RecentEntry): void => {
    if (missing.has(dirKey(r.path))) {
      setNotice(`${u.sidebar.folderGone} (${r.name})`)
      return
    }
    onOpen(r.path)
  }

  return (
    <>
      <div className="side-search rl-search">
        <IconSearch size={14} />
        <input className="side-filter" placeholder={u.sidebar.searchProjects} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={u.sidebar.searchProjectsLabel} />
      </div>
      {notice && <p className="pop-note warn-line">{notice}</p>}
      <div className="rl-list" style={{ maxHeight }}>
        {rows.length === 0 && <p className="pop-note">{u.sidebar.noProjects}</p>}
        {rows.length > 0 && shown.length === 0 && <p className="pop-note">{u.common.noResults}</p>}
        {shown.map((r) => {
          const gone = missing.has(dirKey(r.path))
          return (
            <div
              key={r.path}
              className={`rec-row ${gone ? 'is-gone' : ''}`}
              title={gone ? `${r.path}\n${u.sidebar.folderGone}` : u.sidebar.recentTip(r.path)}
              onClick={() => open(r)}
            >
              <span className="rec-ico">
                <IconFolder size={14} />
              </span>
              <span className="rec-text">
                <span className="rec-name">{r.name}</span>
                <span className="rec-path">{middlePath(r.path, 34)}</span>
              </span>
              <span className="rec-when">{gone ? u.common.none : relTime(r.at)}</span>
              <button
                className={`rec-star ${r.fav ? 'is-on' : ''}`}
                title={r.fav ? u.sidebar.unfavorite : u.sidebar.favorite}
                aria-label={r.fav ? u.sidebar.unfavorite : u.sidebar.favorite}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFav(r.path) // the bag changes → `rows` is derived again
                }}
              >
                <IconStar size={13} filled={r.fav} />
              </button>
              <button
                className="rec-x"
                title={u.sidebar.removeFromList}
                aria-label={u.sidebar.removeFromList}
                onClick={(e) => {
                  e.stopPropagation()
                  forgetRecent(r.path)
                  setNotice(null)
                }}
              >
                <IconClose size={12} />
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
