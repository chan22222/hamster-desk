import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LogItem, ProjectActionGroup, ProjectInfo } from '@shared/events'
import { useUi } from '../i18n'
import { explorerDir, favDirs, isFav, lastCwd, toggleFav } from './recent'
import { changedFiles } from '../log/changed'
import { FileLog } from '../log/FileLog'
import { FeedLog } from '../log/FeedLog'
import { useDesk, type SessionState } from '../store'
import { IconBranch, IconChevron, IconClose, IconFile, IconFolder, IconMore, IconPlay, IconSearch, IconStar } from '../widgets/icons'
import { Popover } from '../widgets/Popover'
import { arrowInMenu, listStep, rove } from '../widgets/focus'

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
          {/* one menu of groups: ↑ ↓ run through every row, the heading names its group */}
          <div className="run-groups" role="menu" aria-label={u.run.run}>
            {groups.map((g) => (
              <div key={g.id} className="run-group" role="group" aria-label={g.label}>
                <div className="run-head" aria-hidden="true">
                  {g.label}
                </div>
                {g.rows.map((a) => {
                  const [step, cmd] = splitCommand(a.command)
                  return (
                    <button
                      key={a.id}
                      className="pop-item run-row"
                      role="menuitem"
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
        </div>
      )}
    </Popover>
  )
}

/**
 * A file's right-click menu, also opened from the keyboard (the menu key, Shift+F10). Portalled to
 * `<body>` like the popovers: it is placed in viewport pixels. It is kept on screen — a file near
 * the bottom of the window used to open it half below the edge — and it is a menu to the keyboard
 * too: the focus starts on the first row, ↑ ↓ move, Esc or Tab closes it and hands the focus back.
 */
function FileMenu({ x, y, from, onClose, children }: { x: number; y: number; from: HTMLElement | null; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const back = (): void => {
    if (from?.isConnected) from.focus()
    onClose()
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setAt({
      left: Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8)),
    })
  }, [x, y])

  useEffect(() => {
    const el = ref.current
    if (at && el) rove(el)?.focus()
  }, [at])

  useEffect(() => {
    const off = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') back()
    }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', off)
      document.removeEventListener('keydown', key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{ left: at?.left ?? x, top: at?.top ?? y, visibility: at ? 'visible' : 'hidden' }}
      onKeyDown={(e) => {
        if (arrowInMenu(e)) return
        if (e.key === 'Tab') {
          e.preventDefault()
          back()
        }
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

/** what the bubble log gets while there is no session: the same empty ones every time, which it does not render again for */
const NO_LOG: LogItem[] = []
const NO_HAMSTERS: SessionState['hamsters'] = {}

/** a row of the file browser: a folder (click goes in) or a file (double-click or Enter opens it) */
type BrowseRow = { kind: 'dir'; entry: DirEntry } | { kind: 'file'; entry: FileEntry }

/** a dragged section never gets smaller than its header plus a couple of rows */
export const SECTION_MIN = 84
/** what a drag may not take from the rest of the sidebar (the file browser under the two sections) */
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
  /** the file menu, where it opens, and what gets the focus back when it closes */
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; from: HTMLElement | null } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** the browser row that holds the list's one Tab stop (↑ ↓ move it) */
  const [cursor, setCursor] = useState(0)
  const rowsRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  // Once per new edit, for the count on the section and the list in it alike. The session itself
  // is new with every event of it, so it is its parts the two lists get: they render again when
  // their own part does.
  const edits = session?.edits
  const files = useMemo(() => (edits ? changedFiles(edits, u.common.mainHamster) : null), [edits, u])
  const changed = files?.length ?? 0
  const logged = session?.log.length ?? 0

  const go = async (p: string): Promise<void> => {
    if (!window.desk || !p) return
    const seq = ++goSeq.current
    // the note about a file that would not open, and the filter, were for the folder being left
    setNotice(null)
    setFilter('')
    setCursor(0)
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
  const rows: BrowseRow[] = [
    ...(listing?.dirs ?? []).filter((d) => match(d.name)).map((entry) => ({ kind: 'dir' as const, entry })),
    ...(listing?.files ?? []).filter((f) => match(f.name)).map((entry) => ({ kind: 'file' as const, entry })),
  ]
  const stop = Math.min(cursor, Math.max(0, rows.length - 1))
  // `터미널 이동` wears the accent while it can be pressed. While it cannot — claude runs in the
  // terminal in front, or there is none, which is most of the time — the accent goes to the button
  // that works, and why the other does not is a line under them: a tooltip on a disabled button is
  // out of reach of the keyboard, and was the only place that said it.
  const canMove = !moveWhy
  // At the default 248px, two words and three icons on one line left each word ~50px, and
  // `터미널 이동` · `Nouvel onglet` · `Новая вкладка` all lost their tails. Narrower than this the
  // words get a line of their own and the icons the next (styles.css `.sidebar.is-narrow`). The
  // width is the user's own preference, so it is known here without measuring anything.
  const narrow = prefs.sidebarW < 340

  const focusRow = (i: number): void => {
    setCursor(i)
    rowsRef.current?.querySelectorAll<HTMLButtonElement>('.fs-main')[i]?.focus()
  }
  /** what Enter does to a row: a folder is gone into (as a click does), a file opened (as a double-click does) */
  const act = (r: BrowseRow): void => {
    if (r.kind === 'dir') void go(r.entry.path)
    else void openFile(r.entry.path)
  }
  /** the file menu: from a right-click where it was, from the keyboard under the row */
  const openMenu = (path: string, el: HTMLElement, at?: { x: number; y: number }): void => {
    const b = el.getBoundingClientRect()
    const inside = at && at.x >= b.left && at.x <= b.right && at.y >= b.top && at.y <= b.bottom
    setMenu({ x: inside ? at.x : b.left + 24, y: inside ? at.y : b.bottom, path, from: el })
  }
  const closeMenu = (): void => {
    const from = menu?.from
    setMenu(null)
    if (from?.isConnected) from.focus()
  }
  const onRowKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number, r: BrowseRow): void => {
    if (r.kind === 'file' && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
      e.preventDefault()
      openMenu(r.entry.path, e.currentTarget)
      return
    }
    if (r.kind === 'file' && e.key === 'Enter') {
      e.preventDefault()
      act(r)
      return
    }
    const j = listStep(e.key, i, rows.length)
    if (j === null) return
    e.preventDefault()
    if (j < 0) filterRef.current?.focus()
    else focusRow(j)
  }

  return (
    <aside className={`sidebar ${narrow ? 'is-narrow' : ''}`} style={{ width: prefs.sidebarW }}>
      <Section
        title={u.sidebar.changedFiles}
        count={changed}
        className="side-changed"
        heightKey="sideChangedH"
        open={prefs.showLog}
        onToggle={() => setPrefs({ showLog: !prefs.showLog })}
        empty={changed === 0}
      >
        <FileLog files={files} cwd={session?.info.cwd ?? ''} />
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
        <FeedLog sessionId={session?.info.sessionId ?? null} log={session?.log ?? NO_LOG} hamsters={session?.hamsters ?? NO_HAMSTERS} />
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
              `터미널 새 탭`: a terminal of the folder's own. The accent is on whichever can be
              pressed now (`canMove` above); the two keep their places either way. */}
          <button className={canMove ? 'side-primary' : 'side-second'} onClick={() => onMove(cur)} disabled={!canMove} title={moveWhy ?? u.sidebar.moveTip(cur)}>
            {u.sidebar.moveTerminal}
          </button>
          <button className={canMove ? 'side-second' : 'side-primary'} onClick={() => onOpen(cur)} title={u.sidebar.newTabTip(cur)}>
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
        {moveWhy && <p className="side-why">{moveWhy}</p>}
        {/* only a folder that is something gets the pill; an empty menu would be a question with no answer */}
        {project && onRun && listing && !listing.error && (
          <div className="side-run">
            <RunMenu project={project} onRun={(command) => onRun(listing.path, command)} />
          </div>
        )}

        {/* It filters this list, so it lives with it. At the top of the sidebar it read as a search of
            everything under it (the changed files, the bubble log), and with this section folded it
            took what was typed and showed nothing. It is for the folder in view: going to another
            one empties it. Enter does the first match (goes in, or opens the file); ↓ goes to the list. */}
        <div className="side-search side-browse-search">
          <IconSearch size={14} />
          <input
            ref={filterRef}
            className="side-filter"
            placeholder={u.sidebar.searchHere}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
              setCursor(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && rows[0]) {
                e.preventDefault()
                act(rows[0])
              } else if (e.key === 'ArrowDown' && rows.length > 0) {
                e.preventDefault()
                focusRow(0)
              }
            }}
            aria-label={u.sidebar.searchLabel}
          />
        </div>

        {loading && <div className="side-empty">{u.common.reading}</div>}
        {listing?.error && <div className="side-empty warn-line">{listing.error}</div>}
        {notice && (
          <div className="side-empty side-notice warn-line" role="status">
            <span>{notice}</span>
            <button className="side-notice-x" onClick={() => setNotice(null)} title={u.common.close} aria-label={u.common.close}>
              <IconClose size={12} />
            </button>
          </div>
        )}
        {!loading && !listing?.error && rows.length === 0 && <div className="side-empty">{q ? u.common.noResults : u.common.empty}</div>}

        {/* One Tab stop for the list (the row the arrows left off on): ↑ ↓ Home End move, ↑ off the
            first row goes back to the filter. A folder's `열기` is the next stop after its row. */}
        <div ref={rowsRef}>
          {rows.map((r, i) => {
            const tab = i === stop ? 0 : -1
            if (r.kind === 'dir') {
              const d = r.entry
              return (
                <div key={d.path} className="fs-row" title={u.sidebar.dirTip(d.path)}>
                  <button
                    className="fs-main"
                    tabIndex={tab}
                    onClick={(e) => {
                      // from the keyboard (a click with no mouse behind it): the row goes away with
                      // the folder, so the focus goes on to the first row of the new one
                      const keyboard = e.detail === 0
                      void go(d.path).then(() => keyboard && requestAnimationFrame(() => focusRow(0)))
                    }}
                    onDoubleClick={() => onOpen(d.path)}
                    onFocus={() => setCursor(i)}
                    onKeyDown={(e) => onRowKey(e, i, r)}
                  >
                    <span className="fs-ico">{dirIcon(d)}</span>
                    <span className="fs-name">{d.name}</span>
                  </button>
                  <button className="fs-open" tabIndex={tab} onClick={() => onOpen(d.path)}>
                    {u.common.open}
                  </button>
                </div>
              )
            }
            const f = r.entry
            return (
              <div key={f.path} className="fs-row is-file" title={u.sidebar.fileTip(f.path)}>
                <button
                  className="fs-main"
                  tabIndex={tab}
                  onDoubleClick={() => void openFile(f.path)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    // the menu key sends this as well as its keydown, which has opened it already
                    if (menu?.path === f.path) return
                    openMenu(f.path, e.currentTarget, { x: e.clientX, y: e.clientY })
                  }}
                  onFocus={() => setCursor(i)}
                  onKeyDown={(e) => onRowKey(e, i, r)}
                >
                  <span className={`fs-ico ${fileKind(f.ext)}`}>
                    <IconFile size={14} />
                  </span>
                  <span className="fs-name">{f.name}</span>
                </button>
              </div>
            )
          })}
        </div>
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
        <FileMenu key={`${menu.path}:${menu.x}:${menu.y}`} x={menu.x} y={menu.y} from={menu.from} onClose={() => setMenu(null)}>
          <button
            role="menuitem"
            onClick={() => {
              window.desk?.clipboard.writeText(menu.path)
              closeMenu()
            }}
          >
            {u.sidebar.copyPath}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              window.desk?.fs.showInFolder(menu.path)
              closeMenu()
            }}
          >
            {u.sidebar.showInExplorer}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              void openFile(menu.path)
              closeMenu()
            }}
          >
            {u.sidebar.openDefault}
          </button>
        </FileMenu>
      )}
    </aside>
  )
}
