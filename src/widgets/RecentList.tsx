// The list of projects this app has opened a terminal in: favourites first, then newest. It is the
// body of the `+` menu and of the start card that fills the pane when no terminal is open — the
// sidebar no longer carries a copy, because "recent" is something you want when you are starting
// something, not something you want in the way all day.
//
// The keyboard: Enter in the search box opens the first match and ↓ goes down into the list, where
// ↑ ↓ Home End move between rows. The list is one Tab stop (the row the arrows left off on); ★ and
// × are the next two, and show themselves when their row has the focus, as they do on hover.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useUi } from '../i18n'
import { dirKey, forgetRecent, middlePath, missingDirs, recentEntries, relTime, toggleFav, type RecentEntry } from '../sidebar/recent'
import { useDesk } from '../store'
import { IconClose, IconFolder, IconSearch, IconStar } from './icons'
import { listStep } from './focus'

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
  /** the row that holds the list's one Tab stop */
  const [cursor, setCursor] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

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
  const stop = Math.min(cursor, Math.max(0, shown.length - 1))

  const open = (r: RecentEntry): void => {
    if (missing.has(dirKey(r.path))) {
      setNotice(`${u.sidebar.folderGone} (${r.name})`)
      return
    }
    onOpen(r.path)
  }

  /** put the focus on row `i` (and the Tab stop with it) */
  const focusRow = (i: number): void => {
    setCursor(i)
    listRef.current?.querySelectorAll<HTMLButtonElement>('.rec-main')[i]?.focus()
  }

  const onRowKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number): void => {
    const j = listStep(e.key, i, shown.length)
    if (j === null) return
    e.preventDefault()
    if (j < 0) searchRef.current?.focus()
    else focusRow(j)
  }

  return (
    <>
      <div className="side-search rl-search">
        <IconSearch size={14} />
        <input
          ref={searchRef}
          className="side-filter"
          placeholder={u.sidebar.searchProjects}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            setCursor(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shown[0]) {
              e.preventDefault()
              open(shown[0])
            } else if (e.key === 'ArrowDown' && shown.length > 0) {
              e.preventDefault()
              focusRow(0)
            }
          }}
          aria-label={u.sidebar.searchProjectsLabel}
        />
      </div>
      {notice && <p className="pop-note warn-line">{notice}</p>}
      <div ref={listRef} className="rl-list" style={{ maxHeight }}>
        {rows.length === 0 && <p className="pop-note">{u.sidebar.noProjects}</p>}
        {rows.length > 0 && shown.length === 0 && <p className="pop-note">{u.common.noResults}</p>}
        {shown.map((r, i) => {
          const gone = missing.has(dirKey(r.path))
          const tab = i === stop ? 0 : -1
          return (
            <div key={r.path} className={`rec-row ${gone ? 'is-gone' : ''}`}>
              <button
                className="rec-main"
                tabIndex={tab}
                title={gone ? `${r.path}\n${u.sidebar.folderGone}` : u.sidebar.recentTip(r.path)}
                onClick={() => open(r)}
                onFocus={() => setCursor(i)}
                onKeyDown={(e) => onRowKey(e, i)}
              >
                <span className="rec-ico">
                  <IconFolder size={14} />
                </span>
                <span className="rec-text">
                  <span className="rec-name">{r.name}</span>
                  <span className="rec-path">{middlePath(r.path, 34)}</span>
                </span>
                <span className="rec-when">{gone ? u.common.none : relTime(r.at)}</span>
              </button>
              <button
                className={`rec-star ${r.fav ? 'is-on' : ''}`}
                tabIndex={tab}
                title={r.fav ? u.sidebar.unfavorite : u.sidebar.favorite}
                aria-label={r.fav ? u.sidebar.unfavorite : u.sidebar.favorite}
                aria-pressed={r.fav}
                onClick={() => toggleFav(r.path) /* the bag changes → `rows` is derived again */}
              >
                <IconStar size={13} filled={r.fav} />
              </button>
              <button
                className="rec-x"
                tabIndex={tab}
                title={u.sidebar.removeFromList}
                aria-label={u.sidebar.removeFromList}
                onClick={() => {
                  forgetRecent(r.path)
                  setNotice(null)
                  // the focus was on a button that is going away: the row that takes its place, or the box
                  requestAnimationFrame(() => (listRef.current?.querySelectorAll<HTMLButtonElement>('.rec-main')[i] ?? searchRef.current)?.focus())
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
