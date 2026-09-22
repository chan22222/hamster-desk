import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectActionGroup, ProjectInfo } from '@shared/events'
import { useUi } from '../i18n'
import { explorerDir, favDirs, isFav, lastCwd, toggleFav } from './recent'
import { changedFiles, FileLog } from '../log/FileLog'
import { FeedLog } from '../log/FeedLog'
import { useDesk, type SessionState } from '../store'
import { IconBranch, IconChevron, IconFile, IconFolder, IconMore, IconPlay, IconSearch, IconStar } from '../widgets/icons'
import { Popover } from '../widgets/Popover'

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

/** the 실행 menu's headings, in the order they come (worded by `u.run.groups`) */
const RUN_GROUPS: ProjectActionGroup[] = ['dev', 'build', 'test', 'install', 'other']

/**
 * `.venv\Scripts\Activate.ps1; python manage.py runserver` → the environment step and the command
 * after it. The step is the same on every row of a venv project, so when a row is too narrow for
 * the whole line it is the step that gets elided, not the part that tells the rows apart.
 */
function splitCommand(command: string): [string, string] {
  const m = /^(.*?(?:; | && ))(.+)$/.exec(command)
  return m ? [m[1], m[2]] : ['', command]
}

/**
 * `실행 ▾`: the commands the current folder takes, by what it is (electron/project-actions.ts). One
 * pill under the actions row rather than a fourth button in it — at the default sidebar width the
 * row has nothing to spare (two text buttons and three icons), and `터미널 새 탭` would have lost
 * its tail. The pill names what was
 * found (`Node · pnpm · Vite`), so a folder's kind shows without opening anything; the menu repeats
 * it above the groups, and each row is the label with the exact command to be typed on the right.
 */
function RunMenu({ project, onRun }: { project: ProjectInfo; onRun: (command: string) => void }) {
  const u = useUi()
  // a folder that is two things at once: `Node · pnpm · Vite + Make`
  const badge = project.kinds.map((k) => k.badge).join(' + ')
  let n = 0
  const groups = RUN_GROUPS.map((id) => ({
    id,
    label: u.run.groups[id],
    rows: project.kinds.flatMap((k) => k.actions.filter((a) => a.group === id)).map((a) => ({ ...a, n: n++ })),
  })).filter((g) => g.rows.length > 0)
  const label = (
    <>
      <IconPlay size={14} />
      <span className="side-run-name">{u.run.run}</span>
      <span className="side-run-badge">{badge}</span>
      <IconChevron dir="down" size={12} />
    </>
  )
  return (
    <Popover className="side-run-btn" label={label} title={u.run.tip(badge)} ariaLabel={u.run.run} width={320} debugClick="run">
      {(close) => (
        <div className="pop-body run-menu">
          <p className="pop-note run-badge">{badge}</p>
          {groups.map((g) => (
            <div key={g.id} className="run-group">
              <div className="run-head">{g.label}</div>
              {g.rows.map((a) => {
                const [step, cmd] = splitCommand(a.command)
                return (
                  <button
                    key={a.id}
                    className="pop-item run-row"
                    data-debug-click={`run-${a.n}`}
                    title={u.run.rowTip(a.command)}
                    onClick={() => {
                      onRun(a.command)
                      close()
                    }}
                  >
                    {/* a known command is worded by the UI; a script the app does not know keeps its own name */}
                    <span className="run-label">{a.labelKey ? u.run.actions[a.labelKey] + (a.detail ? ` (${a.detail})` : '') : a.label}</span>
                    <span className="run-cmd dim">
                      {step && <span className="run-cmd-step">{step}</span>}
                      <span className="run-cmd-main">{cmd}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </Popover>
  )
}

/** a dragged section never gets smaller than its header plus a couple of rows */
export const SECTION_MIN = 84
/** what a drag may not take from the rest of the sidebar (the search box and the file browser) */
const SIDE_RESERVE = 180

/** which preference holds a section's dragged height */
type SectionHeightKey = 'sideChangedH' | 'sideFeedH'

function Section({
  title,
  count,
  open,
  className,
  onToggle,
  heightKey,
  empty = false,
  children,
}: {
  title: string
  count?: number
  open: boolean
  className: string
  onToggle: () => void
  /** set on the sections that can be dragged taller or shorter; the file browser takes the rest */
  heightKey?: SectionHeightKey
  /**
   * Set while the section has nothing to show: it stays in the sidebar as one quiet line — its
   * name and a 0 — instead of only coming into existence with the first edit; nobody looks for a
   * section they have never seen. It cannot be opened (there is nothing in it) and keeps the
   * user's open/closed choice for when it fills.
   */
  empty?: boolean
  children: React.ReactNode
}) {
  if (empty) open = false
  const u = useUi()
  const height = useDesk((s) => (heightKey ? s.prefs[heightKey] : null))
  const setPrefs = useDesk((s) => s.setPrefs)
  const ref = useRef<HTMLElement>(null)
  // a hand-edited ui.json can hold anything; only a real number counts as a dragged height
  const sized = open && typeof height === 'number' && Number.isFinite(height)

  // Same rule as the sidebar's width: the drag writes straight to the store and saves once, on
  // release. It starts from the height on screen, so the first drag out of the automatic layout
  // does not jump; and it saves the height the layout actually gave, which can be less than asked
  // for when the file browser is already down to its third.
  const onDrag = (e: React.MouseEvent): void => {
    const el = ref.current
    if (!el || !heightKey) return
    e.preventDefault()
    const startY = e.clientY
    const startH = el.getBoundingClientRect().height
    const max = Math.max(SECTION_MIN, (el.parentElement?.clientHeight ?? 600) - SIDE_RESERVE)
    const move = (ev: MouseEvent): void => {
      const h = Math.round(Math.max(SECTION_MIN, Math.min(max, startH + ev.clientY - startY)))
      useDesk.setState((s) => ({ prefs: { ...s.prefs, [heightKey]: h } }))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('is-row-resizing')
      setPrefs({ [heightKey]: Math.round(el.getBoundingClientRect().height) })
    }
    document.body.classList.add('is-row-resizing')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <section
      ref={ref}
      className={`side-section ${className} ${open ? 'is-open' : ''} ${sized ? 'is-sized' : ''} ${empty ? 'is-empty' : ''}`}
      style={sized ? { flexBasis: height } : undefined}
    >
      <button className="side-title" onClick={empty ? undefined : onToggle} aria-expanded={open} aria-disabled={empty}>
        <span className="side-caret">
          <IconChevron dir={open ? 'down' : 'right'} size={14} />
        </span>
        {title}
        {count !== undefined && <span className="side-count">{count}</span>}
      </button>
      {open && <div className="side-rows">{children}</div>}
      {open && heightKey && (
        <div
          className="side-split"
          role="separator"
          aria-orientation="horizontal"
          aria-label={u.sidebar.heightOf(title)}
          title={u.sidebar.heightTip}
          onMouseDown={onDrag}
          onDoubleClick={() => setPrefs({ [heightKey]: null })}
        />
      )}
    </section>
  )
}

/**
 * The left sidebar: what this session changed, and a plain file browser under it. Recent projects
 * used to sit on top; they moved to the `+` menu, where you are actually starting something.
 *
 * `start` is the folder of the terminal in front ('' while there is none), and the browser follows
 * it: a terminal opened through the folder picker, a recent project, a favourite, `터미널 새 탭`
 * or a double-clicked folder moves the browser there — `터미널 이동` too, since it changes the
 * tab's folder — and so does switching to a tab of
 * another folder. It used to read `start` once, when it mounted — and it mounts with the start
 * card, before any tab exists, so `start` was '' and the listing of '' is the process's working
 * directory: the install folder of the packaged app, the repository of `npx electron .`. The
 * user's own words: "cli 는 그 폴더로 켜지는데 왼쪽은 계속 hamster 데스크 설치쪽으로 감".
 *
 * `onRun` opens a terminal in a folder with a command already typed — the 실행 menu's rows.
 */
export function Sidebar({
  start,
  session,
  onOpen,
  onMove,
  moveWhy,
  onRun,
}: {
  start: string
  session: SessionState | null
  /** `터미널 새 탭`: a terminal of the folder's own */
  onOpen: (dir: string) => void
  /** `터미널 이동`: the terminal in front goes to the folder (App types the `cd` and moves the tab with it) */
  onMove: (dir: string) => void
  /** why the move is not possible right now (no terminal in front, claude running in it), or null */
  moveWhy: string | null
  onRun?: (dir: string, command: string) => void
}) {
  const u = useUi()
  const prefs = useDesk((s) => s.prefs)
  const setPrefs = useDesk((s) => s.setPrefs)
  const [listing, setListing] = useState<Listing | null>(null)
  /** what the listed folder is (Node, Python, …) and what can be run in it; null = nothing in particular */
  const [project, setProject] = useState<ProjectInfo | null>(null)
  /** the newest `go` wins: two folders clicked in a row must not paint the slower answer last */
  const goSeq = useRef(0)
  const [drives, setDrives] = useState<string[]>([])
  // derived from the settings bag, again whenever it changes — the sidebar can be up before the
  // file has been read, and a star pressed in the `+` menu has to show on the button here too
  const rev = useDesk((s) => s.uiRev)
  const favs = useMemo(() => favDirs(), [rev])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const changed = useMemo(() => changedFiles(session).length, [session])
  const logged = session?.log.length ?? 0

  const go = async (p: string): Promise<void> => {
    if (!window.desk || !p) return
    const seq = ++goSeq.current
    setLoading(true)
    try {
      // the project question rides along with the listing: one round trip per folder change, and
      // the main process answers it from a cache keyed on the marker files' mtimes
      const [next, proj] = await Promise.all([window.desk.fs.list(p), window.desk.fs.project(p).catch(() => null)])
      if (seq !== goSeq.current) return
      setListing(next)
      setProject(proj && proj.kinds.length > 0 ? proj : null)
    } finally {
      if (seq === goSeq.current) setLoading(false)
    }
  }

  useEffect(() => {
    void window.desk?.fs.drives().then(setDrives)
  }, [])

  // Follow the terminal in front (see the component's comment). With no terminal — the start card,
  // or the last tab just closed — the browser is not moved, except when it has nowhere yet: then it
  // opens where the next terminal would, or home.
  useEffect(() => {
    if (start) {
      void go(start)
      return
    }
    if (listing) return
    let alive = true
    void (async () => {
      const home = (await window.desk?.info())?.home ?? ''
      if (alive) void go(explorerDir(null, lastCwd(), home))
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start])

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

  const star = (dir: string): void => void toggleFav(dir) // the bag changes → `favs` is derived again

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
        <input className="side-filter" placeholder={u.sidebar.searchHere} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={u.sidebar.searchLabel} />
      </div>

      <Section
        title={u.sidebar.changedFiles}
        count={changed}
        className="side-changed"
        heightKey="sideChangedH"
        open={prefs.showLog}
        onToggle={() => setPrefs({ showLog: !prefs.showLog })}
        empty={changed === 0}
      >
        <FileLog session={session} />
      </Section>

      <Section
        title={u.sidebar.feedLog}
        count={logged}
        className="side-feedlog"
        heightKey="sideFeedH"
        open={prefs.showFeedLog}
        onToggle={() => setPrefs({ showFeedLog: !prefs.showFeedLog })}
        empty={logged === 0}
      >
        <FeedLog session={session} />
      </Section>

      <Section title={u.sidebar.explore} className="side-browse" open={prefs.showExplorer} onToggle={() => setPrefs({ showExplorer: !prefs.showExplorer })}>
        <div className="side-crumbs">
          {drives.length > 1 && (
            <select value={cur.slice(0, 3).toUpperCase()} onChange={(e) => void go(e.target.value)} aria-label={u.sidebar.drive}>
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
          {/* `터미널 이동`: the terminal in front goes to this folder (a `cd`, and the tab follows);
              `터미널 새 탭`: a terminal of the folder's own. The move is the accent one — it is what
              the browser is mostly for — and the one that is sometimes not possible (a shell with
              claude running in it), which its title then says. */}
          <button className="side-primary" onClick={() => onMove(cur)} disabled={!!moveWhy} title={moveWhy ?? u.sidebar.moveTip(cur)}>
            {u.sidebar.moveTerminal}
          </button>
          <button className="side-second" onClick={() => onOpen(cur)} title={u.sidebar.newTabTip(cur)}>
            {u.sidebar.newTab}
          </button>
          <button className="side-mini" onClick={() => listing?.parent && void go(listing.parent)} disabled={!listing?.parent} title={u.sidebar.parent} aria-label={u.sidebar.parent}>
            <IconChevron dir="up" size={14} />
          </button>
          <button className={`side-mini ${isFav(cur, favs) ? 'is-on' : ''}`} onClick={() => star(cur)} title={u.sidebar.favorite} aria-label={u.sidebar.favorite}>
            <IconStar size={14} filled={isFav(cur, favs)} />
          </button>
          <button className="side-mini" onClick={() => void browse()} title={u.sidebar.browse} aria-label={u.sidebar.browse}>
            <IconMore size={14} />
          </button>
        </div>
        {/* only a folder that is something gets the pill; an empty menu would be a question with no answer */}
        {project && onRun && listing && !listing.error && (
          <div className="side-run">
            <RunMenu project={project} onRun={(command) => onRun(listing.path, command)} />
          </div>
        )}

        {loading && <div className="side-empty">{u.common.reading}</div>}
        {listing?.error && <div className="side-empty warn-line">{listing.error}</div>}
        {notice && <div className="side-empty warn-line">{notice}</div>}
        {!loading && !listing?.error && dirs.length === 0 && files.length === 0 && <div className="side-empty">{u.common.empty}</div>}

        {dirs.map((d) => (
          <div key={d.path} className="fs-row" title={u.sidebar.dirTip(d.path)} onClick={() => void go(d.path)} onDoubleClick={() => onOpen(d.path)}>
            <span className="fs-ico">{dirIcon(d)}</span>
            <span className="fs-name">{d.name}</span>
            <button
              className="fs-open"
              onClick={(e) => {
                e.stopPropagation()
                onOpen(d.path)
              }}
            >
              {u.common.open}
            </button>
          </div>
        ))}
        {files.map((f) => (
          <div
            key={f.path}
            className="fs-row is-file"
            title={u.sidebar.fileTip(f.path)}
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
        aria-label={u.sidebar.width}
        title={u.sidebar.widthTip}
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
            {u.sidebar.copyPath}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              window.desk?.fs.showInFolder(menu.path)
              setMenu(null)
            }}
          >
            {u.sidebar.showInExplorer}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              void openFile(menu.path)
              setMenu(null)
            }}
          >
            {u.sidebar.openDefault}
          </button>
        </div>
      )}
    </aside>
  )
}
