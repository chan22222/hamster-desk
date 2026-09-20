import { useEffect, useMemo, useRef, useState } from 'react'
import { favDirs, isFav, toggleFav } from './recent'
import { changedFiles, FileLog } from '../log/FileLog'
import { useDesk, type SessionState } from '../store'
import { IconBranch, IconChevron, IconFile, IconFolder, IconMore, IconSearch, IconStar } from '../widgets/icons'

/** the sidebar's own limits; the handle on its right edge writes `prefs.sidebarW` */
export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 480
export const SIDEBAR_DEFAULT = 248

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

/** All files wear the same sheet; the extension only tints it, so a folder of code reads as one. */
function fileKind(ext: string): string {
  const e = ext.replace(/^\./, '').toLowerCase()
  if (e === 'md' || e === 'mdx' || e === 'txt') return 'is-doc'
  if (e === 'json' || e === 'yaml' || e === 'yml' || e === 'toml' || e === 'ini') return 'is-config'
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go'].includes(e)) return 'is-code'
  return ''
}

/** 🐹 stays an emoji: it means "Claude Code knows this folder", which is a mark, not an icon. */
function dirIcon(d: { git: boolean; claude: boolean }) {
  if (d.claude) return '🐹'
  return d.git ? <IconBranch className="git" size={14} /> : <IconFolder size={14} />
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

function Section({
  title,
  count,
  open,
  className,
  onToggle,
  children,
}: {
  title: string
  count?: number
  open: boolean
  className: string
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className={`side-section ${className} ${open ? 'is-open' : ''}`}>
      <button className="side-title" onClick={onToggle} aria-expanded={open}>
        <span className="side-caret">
          <IconChevron dir={open ? 'down' : 'right'} size={14} />
        </span>
        {title}
        {count !== undefined && <span className="side-count">{count}</span>}
      </button>
      {open && <div className="side-rows">{children}</div>}
    </section>
  )
}

/**
 * The left sidebar: what this session changed, and a plain file browser under it. Recent projects
 * used to sit on top; they moved to the `+` menu, where you are actually starting something.
 */
export function Sidebar({ start, session, onOpen }: { start: string; session: SessionState | null; onOpen: (dir: string) => void }) {
  const prefs = useDesk((s) => s.prefs)
  const setPrefs = useDesk((s) => s.setPrefs)
  const [listing, setListing] = useState<Listing | null>(null)
  const [drives, setDrives] = useState<string[]>([])
  const [favs, setFavs] = useState<string[]>(() => favDirs())
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const changed = useMemo(() => changedFiles(session).length, [session])

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

  const star = (dir: string): void => setFavs(toggleFav(dir))

  const browse = async (): Promise<void> => {
    const d = await window.desk?.dialog.pickFolder(listing?.path)
    if (d) void go(d)
  }

  const openFile = async (path: string): Promise<void> => {
    const err = await window.desk?.fs.openPath(path)
    setNotice(err ? err : null)
  }

  // Dragging writes straight to the store and only saves on release: one settings write per drag,
  // not one per mouse move.
  const onResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = prefs.sidebarW
    let w = startW
    const move = (ev: MouseEvent): void => {
      w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + ev.clientX - startX))
      useDesk.setState((s) => ({ prefs: { ...s.prefs, sidebarW: w } }))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setPrefs({ sidebarW: w })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const cur = listing?.path ?? start
  const q = filter.trim().toLowerCase()
  const match = (s: string): boolean => !q || s.toLowerCase().includes(q)
  const dirs = (listing?.dirs ?? []).filter((d) => match(d.name))
  const files = (listing?.files ?? []).filter((f) => match(f.name))

  return (
    <aside className="sidebar" style={{ width: prefs.sidebarW }}>
      <div className="side-search">
        <IconSearch size={14} />
        <input className="side-filter" placeholder="이 폴더에서 검색" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="폴더·파일 검색" />
      </div>

      {changed > 0 && (
        <Section title="바뀐 파일" count={changed} className="side-changed" open={prefs.showLog} onToggle={() => setPrefs({ showLog: !prefs.showLog })}>
          <FileLog session={session} />
        </Section>
      )}

      <Section title="탐색" className="side-browse" open={prefs.showExplorer} onToggle={() => setPrefs({ showExplorer: !prefs.showExplorer })}>
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
          <button className="side-primary" onClick={() => onOpen(cur)} title={cur}>
            여기서 터미널 열기
          </button>
          <button className="side-mini" onClick={() => listing?.parent && void go(listing.parent)} disabled={!listing?.parent} title="상위 폴더" aria-label="상위 폴더">
            <IconChevron dir="up" size={14} />
          </button>
          <button className={`side-mini ${isFav(cur, favs) ? 'is-on' : ''}`} onClick={() => star(cur)} title="즐겨찾기" aria-label="즐겨찾기">
            <IconStar size={14} filled={isFav(cur, favs)} />
          </button>
          <button className="side-mini" onClick={() => void browse()} title="폴더 찾아보기" aria-label="폴더 찾아보기">
            <IconMore size={14} />
          </button>
        </div>

        {loading && <div className="side-empty">읽는 중…</div>}
        {listing?.error && <div className="side-empty warn-line">{listing.error}</div>}
        {notice && <div className="side-empty warn-line">{notice}</div>}
        {!loading && !listing?.error && dirs.length === 0 && files.length === 0 && <div className="side-empty">비어 있어요.</div>}

        {dirs.map((d) => (
          <div key={d.path} className="fs-row" title={`${d.path}\n클릭: 들어가기 · 더블클릭: 터미널 열기`} onClick={() => void go(d.path)} onDoubleClick={() => onOpen(d.path)}>
            <span className="fs-ico">{dirIcon(d)}</span>
            <span className="fs-name">{d.name}</span>
            <button
              className="fs-open"
              onClick={(e) => {
                e.stopPropagation()
                onOpen(d.path)
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
            <span className={`fs-ico ${fileKind(f.ext)}`}>
              <IconFile size={14} />
            </span>
            <span className="fs-name">{f.name}</span>
          </div>
        ))}
      </Section>

      <div
        className="side-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="사이드바 폭"
        title="끌어서 폭 조절 · 더블클릭: 기본값"
        onMouseDown={onResize}
        onDoubleClick={() => setPrefs({ sidebarW: SIDEBAR_DEFAULT })}
      />

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
