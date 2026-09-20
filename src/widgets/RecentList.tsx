// The list of projects this app has opened a terminal in: favourites first, then newest. It is the
// body of the `+` menu and of the start card that fills the pane when no terminal is open — the
// sidebar no longer carries a copy, because "recent" is something you want when you are starting
// something, not something you want in the way all day.

import { useEffect, useState } from 'react'
import { dirKey, forgetRecent, middlePath, missingDirs, recentEntries, relTime, toggleFav, type RecentEntry } from '../sidebar/recent'
import { IconClose, IconFolder, IconSearch, IconStar } from './icons'

const GONE = '폴더를 찾을 수 없어요.'

export function RecentList({ onOpen, maxHeight = 300 }: { onOpen: (dir: string) => void; maxHeight?: number }) {
  const [rows, setRows] = useState<RecentEntry[]>(() => recentEntries())
  const [missing, setMissing] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void missingDirs(rows.map((r) => r.path)).then((s) => {
      if (alive) setMissing(s)
    })
    return () => {
      alive = false
    }
  }, [rows])

  const q = filter.trim().toLowerCase()
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)) : rows

  const open = (r: RecentEntry): void => {
    if (missing.has(dirKey(r.path))) {
      setNotice(`${GONE} (${r.name})`)
      return
    }
    onOpen(r.path)
  }

  return (
    <>
      <div className="side-search rl-search">
        <IconSearch size={14} />
        <input className="side-filter" placeholder="프로젝트 검색" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="최근 프로젝트 검색" />
      </div>
      {notice && <p className="pop-note warn-line">{notice}</p>}
      <div className="rl-list" style={{ maxHeight }}>
        {rows.length === 0 && <p className="pop-note">아직 이 앱에서 연 프로젝트가 없어요. 아래에서 폴더를 고르면 여기에 쌓입니다.</p>}
        {rows.length > 0 && shown.length === 0 && <p className="pop-note">검색 결과가 없어요.</p>}
        {shown.map((r) => {
          const gone = missing.has(dirKey(r.path))
          return (
            <div
              key={r.path}
              className={`rec-row ${gone ? 'is-gone' : ''}`}
              title={gone ? `${r.path}\n${GONE}` : `${r.path}\n클릭: 여기서 터미널 열기`}
              onClick={() => open(r)}
            >
              <span className="rec-ico">
                <IconFolder size={14} />
              </span>
              <span className="rec-text">
                <span className="rec-name">{r.name}</span>
                <span className="rec-path">{middlePath(r.path, 34)}</span>
              </span>
              <span className="rec-when">{gone ? '없음' : relTime(r.at)}</span>
              <button
                className={`rec-star ${r.fav ? 'is-on' : ''}`}
                title={r.fav ? '즐겨찾기 해제' : '즐겨찾기'}
                aria-label={r.fav ? '즐겨찾기 해제' : '즐겨찾기'}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFav(r.path)
                  setRows(recentEntries())
                }}
              >
                <IconStar size={13} filled={r.fav} />
              </button>
              <button
                className="rec-x"
                title="목록에서 지우기"
                aria-label="목록에서 지우기"
                onClick={(e) => {
                  e.stopPropagation()
                  forgetRecent(r.path)
                  setNotice(null)
                  setRows(recentEntries())
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
