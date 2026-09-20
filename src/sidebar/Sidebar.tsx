import { useEffect, useRef, useState } from 'react'
import { favDirs, isFav, middlePath, recentProjects, relTime, toggleFav, type RecentEntry } from './recent'

/** how many recent rows fit before the browser below them is pushed off screen */
const RECENT_SHOWN = 12

interface DirEntry {
  name: string
  path: string
  git: boolean
  claude: boolean
}
interface FileEntry {
  name: string
  path: string
  size: number
  mtime: number
  ext: string
}
interface Listing {
  path: string
  parent: string | null
  dirs: DirEntry[]
  files: FileEntry[]
  error: string | null
}

function fileIcon(ext: string): string {
  const e = ext.replace(/^\./, '').toLowerCase()
  if (e === 'md' || e === 'mdx' || e === 'txt') return '🧾'
  if (e === 'json' || e === 'yaml' || e === 'yml' || e === 'toml' || e === 'ini') return '⚙'
  if (e === 'ts' || e === 'tsx' || e === 'js' || e === 'jsx' || e === 'mjs' || e === 'cjs') return '🟦'
  if (e === 'py') return '🐍'
  if (e === 'png' || e === 'jpg' || e === 'jpeg' || e === 'gif' || e === 'svg' || e === 'webp') return '🖼'
  return '📄'
}

function crumbs(p: string): { label: string; path: string }[] {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  const out: { label: string; path: string }[] = []
  let acc = ''
  parts.forEach((part, i) => {
    acc = i === 0 ? (part.endsWith(':') ? part + '\\' : '/' + part) : acc.replace(/[\\/]$/, '') + '\\' + part
    out.push({ label: part, path: acc })
  })
  return out
}

function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className={`side-section ${open ? 'is-open' : ''}`}>
      <button className="side-title" onClick={onToggle} aria-expanded={open}>
        <span className="side-caret">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && children}
    </div>
  )
}

/**
 * The left sidebar: the projects you worked in recently, and a plain file browser under it.
 * A click on a recent row opens a terminal there — that is what people want nine times out of ten.
 */
export function Sidebar({ start, onOpen }: { start: string; onOpen: (dir: string) => void }) {
  const [listing, setListing] = useState<Listing | null>(null)
  const [drives, setDrives] = useState<string[]>([])
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [favs, setFavs] = useState<string[]>(() => favDirs())
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [sections, setSections] = useState({ recent: true, browse: true })
  const [allRecent, setAllRecent] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const refreshRecent = (): void => void recentProjects(30).then(setRecent)

  const go = async (p: string): Promise<void> => {
    if (!window.desk) return
    setLoading(true)
    try {
      setListing(await window.desk.fs.list(p))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void go(start)
    void window.desk?.fs.drives().then(setDrives)
    refreshRecent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', off)
      document.removeEventListener('keydown', key)
    }
  }, [menu])

  const open = (dir: string): void => {
    onOpen(dir)
    setTimeout(refreshRecent, 0)
  }

  const star = (dir: string): void => {
    setFavs(toggleFav(dir))
    refreshRecent()
  }

  const browse = async (): Promise<void> => {
    const d = await window.desk?.dialog.pickFolder(listing?.path)
    if (d) void go(d)
  }

  const openFile = async (path: string): Promise<void> => {
    const err = await window.desk?.fs.openPath(path)
    setNotice(err ? err : null)
  }

  const cur = listing?.path ?? start
  const q = filter.trim().toLowerCase()
  const match = (s: string): boolean => !q || s.toLowerCase().includes(q)
  const dirs = (listing?.dirs ?? []).filter((d) => match(d.name))
  const files = (listing?.files ?? []).filter((f) => match(f.name))
  const recentRows = recent.filter((r) => match(r.name) || match(r.path))
  const recentShown = allRecent || q ? recentRows : recentRows.slice(0, RECENT_SHOWN)

  return (
    <aside className="sidebar">
      <input className="side-filter" placeholder="이름으로 거르기" value={filter} onChange={(e) => setFilter(e.target.value)} />

      <div className="side-scroll">
        <Section title="최근" open={sections.recent} onToggle={() => setSections((s) => ({ ...s, recent: !s.recent }))}>
          {recentRows.length === 0 && <div className="side-empty">아직 연 프로젝트가 없어요.</div>}
          {recentShown.map((r) => (
            <div key={r.path} className="rec-row" title={`${r.path}\n클릭: 여기서 터미널 열기`} onClick={() => open(r.path)}>
              <span className="rec-ico">{r.claude ? '🐹' : r.git ? '⎇' : '📁'}</span>
              <span className="rec-text">
                <span className="rec-name">{r.name}</span>
                <span className="rec-path dim">{middlePath(r.path)}</span>
              </span>
              <span className="rec-when dim">{relTime(r.at)}</span>
              <button
                className={`rec-star ${r.fav ? 'is-on' : ''}`}
                title={r.fav ? '즐겨찾기 해제' : '즐겨찾기'}
                aria-label={r.fav ? '즐겨찾기 해제' : '즐겨찾기'}
                onClick={(e) => {
                  e.stopPropagation()
                  star(r.path)
                }}
              >
                {r.fav ? '★' : '☆'}
              </button>
            </div>
          ))}
          {recentShown.length < recentRows.length && (
            <button className="side-more" onClick={() => setAllRecent(true)}>
              {recentRows.length - recentShown.length}개 더 보기
            </button>
          )}
        </Section>

        <Section title="탐색" open={sections.browse} onToggle={() => setSections((s) => ({ ...s, browse: !s.browse }))}>
          <div className="side-crumbs">
            {drives.length > 1 && (
              <select value={cur.slice(0, 3).toUpperCase()} onChange={(e) => void go(e.target.value)} aria-label="드라이브">
                {drives.map((d) => (
                  <option key={d} value={d.toUpperCase()}>
                    {d}
                  </option>
                ))}
              </select>
            )}
            {crumbs(cur).map((c, i, arr) => (
              <span key={c.path}>
                <button className="crumb" onClick={() => void go(c.path)} title={c.path}>
                  {c.label}
                </button>
                {i < arr.length - 1 && <span className="dim">›</span>}
              </span>
            ))}
          </div>

          <div className="side-actions">
            <button className="side-primary" onClick={() => open(cur)} title={cur}>
              여기서 터미널 열기
            </button>
            <button className="side-mini" onClick={() => listing?.parent && void go(listing.parent)} disabled={!listing?.parent} title="상위 폴더">
              ↑
            </button>
            <button className={`side-mini ${isFav(cur, favs) ? 'is-on' : ''}`} onClick={() => star(cur)} title="즐겨찾기">
              {isFav(cur, favs) ? '★' : '☆'}
            </button>
            <button className="side-mini" onClick={() => void browse()} title="폴더 찾아보기">
              …
            </button>
          </div>

          {loading && <div className="side-empty">읽는 중…</div>}
          {listing?.error && <div className="side-empty warn-line">{listing.error}</div>}
          {notice && <div className="side-empty warn-line">{notice}</div>}
          {!loading && !listing?.error && dirs.length === 0 && files.length === 0 && <div className="side-empty">비어 있어요.</div>}

          {dirs.map((d) => (
            <div key={d.path} className="fs-row" title={`${d.path}\n클릭: 들어가기 · 더블클릭: 터미널 열기`} onClick={() => void go(d.path)} onDoubleClick={() => open(d.path)}>
              <span className="fs-ico">{d.claude ? '🐹' : d.git ? '⎇' : '📁'}</span>
              <span className="fs-name">{d.name}</span>
              <button
                className="fs-open"
                onClick={(e) => {
                  e.stopPropagation()
                  open(d.path)
                }}
              >
                열기
              </button>
            </div>
          ))}
          {files.map((f) => (
            <div
              key={f.path}
              className="fs-row is-file"
              title={`${f.path}\n더블클릭: 기본 앱으로 열기 · 우클릭: 메뉴`}
              onDoubleClick={() => void openFile(f.path)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, path: f.path })
              }}
            >
              <span className="fs-ico">{fileIcon(f.ext)}</span>
              <span className="fs-name dim">{f.name}</span>
            </div>
          ))}
        </Section>
      </div>

      {menu && (
        <div ref={menuRef} className="ctx-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 190), top: menu.y }}>
          <button
            role="menuitem"
            onClick={() => {
              window.desk?.clipboard.writeText(menu.path)
              setMenu(null)
            }}
          >
            경로 복사
          </button>
          <button
            role="menuitem"
            onClick={() => {
              window.desk?.fs.showInFolder(menu.path)
              setMenu(null)
            }}
          >
            탐색기에서 보기
          </button>
          <button
            role="menuitem"
            onClick={() => {
              void openFile(menu.path)
              setMenu(null)
            }}
          >
            기본 앱으로 열기
          </button>
        </div>
      )}
    </aside>
  )
}
