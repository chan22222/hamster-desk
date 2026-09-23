import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { externalSessions, freezePrefs, hydrateUi, runInTerminal, sessionForTab, setDebugClick, useDesk, type SessionState, type Workspace } from './store'
import { setLang, useUi, type UiStrings } from './i18n'
import { DeskStudio } from './desk/DeskStudio'
import { useFold } from './desk/useFold'
import { TerminalPane } from './Terminal'
import { Sidebar } from './sidebar/Sidebar'
import { baseName, cdCommand, rememberRecent, setLastCwd } from './sidebar/recent'
import { UsageMeters } from './widgets/Usage'
import { UpdatePill } from './widgets/Version'
import { AppUpdatePill, AppUpdatePrompt } from './widgets/AppUpdate'
import { MoreMenu } from './widgets/MoreMenu'
import { PlusMenu, StartCard } from './widgets/PlusMenu'
import { Popover } from './widgets/Popover'
import { usePainted } from './widgets/theme'
import { IconClose, IconSidebar } from './widgets/icons'
import { revealIn, useHScroll } from './widgets/hscroll'
import { wrapStep } from './widgets/focus'
import { startReplay } from './dev/replay-driver'
import { installDebugHooks } from './dev/debug'
import { useGlobalShortcuts } from './shortcuts'
import { restoreWorkspaces } from './workspaces-persist'
import { SessionBar } from './session/SessionBar'
import { TabContext } from './session/ContextMeter'
import { TabGit } from './git/GitChip'
import { AccountBadge, AccountGate, useAccountsRefresh } from './accounts/Accounts'
import { TurnToast } from './log/TurnToast'
import { Banner } from './notify/Banner'
import { MiniShell } from './mini/MiniShell'
import { dragRange, STUDIO_H, STUDIO_W, studioSize } from './layout'

/**
 * What a tab says, on two lines. The conversation title has the upper line to itself — the chips
 * used to sit beside it and squeezed it to `예약메시지 및 5시…` on every tab. The lower line is the
 * folder (only while a title has taken the upper line; before that the folder *is* the title) and
 * the chips: account, context %, git, sub-agent count. Empty until there is something to say, and
 * then the title sits alone in the middle.
 */
function TabText({ title, folder, children }: { title: string; folder: string | null; children: ReactNode }) {
  return (
    <span className="tab-text">
      <span className="tab-label">{title}</span>
      <span className="tab-meta">
        {folder && <span className="tab-folder">{folder}</span>}
        {children}
      </span>
    </span>
  )
}

/** The × on a tab. A terminal with a live claude session asks first, in a popover. */
function TabClose({ busy, tabIndex, onClose }: { busy: boolean; tabIndex: number; onClose: () => void }) {
  const u = useUi()
  if (!busy)
    return (
      <button className="tab-x" title={u.tabs.closeTerminal} aria-label={u.tabs.closeTerminal} tabIndex={tabIndex} onClick={onClose}>
        <IconClose size={12} />
      </button>
    )
  return (
    <Popover className="tab-x" label={<IconClose size={12} />} ariaLabel={u.tabs.closeTerminal} title={u.tabs.closeTerminal} tabIndex={tabIndex} width={224}>
      {(close) => (
        <div className="pop-body">
          <p>{u.tabs.closeRunningNote}</p>
          <button
            className="pop-primary"
            onClick={() => {
              close()
              onClose()
            }}
          >
            {u.tabs.closeAnyway}
          </button>
        </div>
      )}
    </Popover>
  )
}

/**
 * The state a tab is in, in words, for the tooltip and a screen reader. On screen it is the mark
 * in front of the title: a grey dot (claude idle), an orange dot with a ring (working), and — the
 * one that matters most, a tab in the background waiting on the user — not a third colour of the
 * same 7px dot but a `!` badge on an amber tab.
 */
function tabState(u: UiStrings, s: SessionState | null, wait: 'permission' | 'question' | null): string | null {
  if (wait === 'permission') return u.tabs.waitPermission
  if (wait === 'question') return u.tabs.waitQuestion
  if (!s) return null
  return s.info.status === 'busy' ? u.tabs.stateBusy : u.tabs.stateIdle
}

function TabMark({ s, wait }: { s: SessionState | null; wait: boolean }) {
  if (wait)
    return (
      <span className="tab-alert" aria-hidden="true">
        !
      </span>
    )
  return <span className={`dot ${s ? (s.info.status === 'busy' ? 'busy' : 'idle') : ''}`} aria-hidden="true" />
}

/**
 * One terminal tab. It subscribes to its own session and its own "waiting" flag, so an event for
 * one session repaints that tab — not the whole window, which is what App subscribing to every
 * session used to do.
 */
function WsTab({ w, active, stop }: { w: Workspace; active: boolean; stop: boolean }) {
  const u = useUi()
  const s = useDesk((st) => (w.ptyId === null ? null : Object.values(st.sessions).find((x) => x.info.ptyId === w.ptyId) ?? null))
  const wait = useDesk((st) => (w.ptyId === null ? null : st.ptyWaiting[w.ptyId]?.reason ?? null))
  const setActiveTab = useDesk((st) => st.setActiveTab)
  const removeWorkspace = useDesk((st) => st.removeWorkspace)
  const n = s?.order.length ?? 0
  const state = tabState(u, s, wait)
  return (
    <div className={`tab ${active ? 'active' : ''} ${wait ? 'is-waiting' : ''}`} role="presentation">
      <button
        className="tab-main"
        role="tab"
        aria-selected={active}
        tabIndex={stop ? 0 : -1}
        onClick={() => setActiveTab(`ws:${w.id}`)}
        title={state ? `${w.cwd}\n${state}` : w.cwd}
      >
        <TabMark s={s} wait={!!wait} />
        <TabText title={s?.title || w.title} folder={s?.title ? w.title : null}>
          <AccountBadge profileId={w.profileId} />
          <TabContext session={s} />
          <TabGit cwd={w.cwd} />
          {n > 1 && <span className="count">🐹×{n}</span>}
        </TabText>
        {state && <span className="sr-only">{state}</span>}
      </button>
      <TabClose busy={!!s} tabIndex={active ? 0 : -1} onClose={() => removeWorkspace(w.id)} />
    </div>
  )
}

/** A session running in some other terminal: the desk only, no ×. */
function ExtTab({ s, active, stop }: { s: SessionState; active: boolean; stop: boolean }) {
  const u = useUi()
  const setActiveTab = useDesk((st) => st.setActiveTab)
  const state = tabState(u, s, null)
  return (
    <div className={`tab ext ${active ? 'active' : ''}`} role="presentation">
      <button
        className="tab-main"
        role="tab"
        aria-selected={active}
        tabIndex={stop ? 0 : -1}
        onClick={() => setActiveTab(`session:${s.info.sessionId}`)}
        title={state ? `${u.tabs.externalTab(s.info.cwd)}\n${state}` : u.tabs.externalTab(s.info.cwd)}
      >
        <TabMark s={s} wait={false} />
        <TabText title={s.title || s.info.name || s.info.sessionId.slice(0, 8)} folder={baseName(s.info.cwd) || null}>
          <AccountBadge profileId={s.info.profileId} />
          <TabContext session={s} />
          {s.order.length > 1 && <span className="count">🐹×{s.order.length}</span>}
        </TabText>
        {state && <span className="sr-only">{state}</span>}
      </button>
    </div>
  )
}

/**
 * The tab strip. It scrolls sideways when the tabs outgrow it — the wheel does it, a fade at an
 * end says there is more that way, and the active tab (Ctrl+T, Ctrl+1…9, a click on a bubble) is
 * always scrolled into view. `+` sits after it, outside the scrolling box, so it never goes off
 * the end with the tabs. A tablist: one Tab stop, ← → Home End between tabs, Enter to switch —
 * not switch-on-arrow, because a tab that comes to the front hands the focus to its terminal.
 */
function TabStrip({ onOpen, onShowSidebar }: { onOpen: (dir: string) => void; onShowSidebar: () => void }) {
  const u = useUi()
  const workspaces = useDesk((s) => s.workspaces)
  const activeTab = useDesk((s) => s.activeTab)
  const externals = useDesk(useShallow((s) => externalSessions(s.sessions)))
  const boxRef = useRef<HTMLDivElement>(null)
  useHScroll(boxRef)

  const ids = [...workspaces.map((w) => `ws:${w.id}`), ...externals.map((s) => `session:${s.info.sessionId}`)]
  // the strip's one Tab stop: the active tab, or the first while the active one is not a tab here
  const stop = activeTab && ids.includes(activeTab) ? activeTab : ids[0]

  useEffect(() => {
    const box = boxRef.current
    if (box) revealIn(box, box.querySelector('.tab.active'))
  }, [activeTab, ids.length])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // keys from a popover's panel travel up the React tree to here too; only a tab's own count
    if (!(e.target instanceof HTMLElement) || e.target.getAttribute('role') !== 'tab') return
    const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')]
    const j = wrapStep(e.key, tabs.indexOf(e.target), tabs.length, 'h')
    if (j === null) return
    e.preventDefault()
    tabs[j].focus()
    revealIn(e.currentTarget, tabs[j])
  }

  return (
    <>
      <div ref={boxRef} className="tabs" role="tablist" aria-label={u.tabs.stripLabel} onKeyDown={onKeyDown}>
        {workspaces.map((w) => (
          <WsTab key={w.id} w={w} active={activeTab === `ws:${w.id}`} stop={stop === `ws:${w.id}`} />
        ))}
        {externals.length > 0 && <span className="tab-sep" role="presentation" />}
        {externals.map((s) => {
          const id = `session:${s.info.sessionId}`
          return <ExtTab key={id} s={s} active={activeTab === id} stop={stop === id} />
        })}
      </div>
      <PlusMenu onOpen={onOpen} onShowSidebar={onShowSidebar} />
    </>
  )
}

export default function App() {
  const u = useUi()
  const apply = useDesk((s) => s.apply)
  const workspaces = useDesk((s) => s.workspaces)
  const activeTab = useDesk((s) => s.activeTab)
  const addWorkspace = useDesk((s) => s.addWorkspace)
  const moveWorkspace = useDesk((s) => s.moveWorkspace)
  const prefs = useDesk((s) => s.prefs)
  const setPrefs = useDesk((s) => s.setPrefs)
  const mini = useDesk((s) => s.mini)
  // Only the session in front, not every session: this component is the whole window, and it used
  // to repaint on every event of every session (and every key that cleared a prompt). A session
  // object is replaced when that session changes, so this re-renders exactly when the front one does.
  // Browser replay has no terminals: it shows the replayed session instead of an empty desk.
  const active = useDesk((s) => sessionForTab(s, s.activeTab) ?? (!window.desk && !s.activeTab ? externalSessions(s.sessions)[0] ?? null : null))
  const painted = usePainted()
  const booted = useRef(false)
  // the settings file is read over IPC, so the first frame would be the defaults; hide it instead
  const [booting, setBooting] = useState(() => !!window.desk)
  const colRef = useRef<HTMLDivElement>(null)
  const [col, setCol] = useState({ w: 0, h: 0 })
  // a capture run (src/dev/debug.ts) has nobody to answer a dialog: the account question stays away
  const [captureRun, setCaptureRun] = useState(false)

  // event stream (with backlog replay) or browser-only replay
  useEffect(() => {
    const bridge = window.desk
    if (!bridge) return startReplay(apply)
    // StrictMode mounts twice in development: the first mount's backlog answer can still be on its
    // way when its cleanup runs, and applying it as well doubled every turn, edit and ×N
    let alive = true
    let last = 0
    const take = (item: { seq: number; ev: import('@shared/events').DeskEvent }): void => {
      if (!alive || item.seq <= last) return
      last = item.seq
      apply(item.ev)
    }
    const queue: { seq: number; ev: import('@shared/events').DeskEvent }[] = []
    let ready = false
    const off = bridge.onEvent((item) => (ready ? take(item) : queue.push(item)))
    void bridge.backlog(0).then((items) => {
      if (!alive) return
      items.forEach(take)
      queue.forEach(take)
      queue.length = 0
      ready = true
    })
    return () => {
      alive = false
      off()
    }
  }, [apply])

  // settings, then the first terminal — in that order, so it opens in the folder we left off in
  useEffect(() => {
    if (booted.current || !window.desk) return
    booted.current = true
    void hydrateUi()
      .then(() => window.desk?.info())
      .then(async (info) => {
        if (!info) return
        setLang(useDesk.getState().prefs.lang, info.claudeLanguage)
        setDebugClick(info.debugClick)
        if (info.debugClick || info.debugPrefs || info.debugClicks.length) setCaptureRun(true)
        if (info.debugPrefs) {
          // forced prefs are for this run only: freeze the store so nothing reaches ~/.hamster-desk/ui.json
          const { demoAgents, ...rest } = info.debugPrefs as { demoAgents?: number } & Partial<typeof prefs>
          freezePrefs()
          useDesk.setState((s) => ({ prefs: { ...s.prefs, ...rest } }))
          // straight into the store, past `setPrefs`: the language has to be told by hand
          if (rest.lang) setLang(rest.lang, info.claudeLanguage)
          const n = Number(demoAgents ?? 0)
          if (n > 0) void import('./dev/demo').then((m) => m.startDemo(apply, n))
        }
        await restoreWorkspaces(info.home)
        installDebugHooks(info)
      })
      .finally(() => setBooting(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addWorkspace])

  // the loading screen is markup in index.html, up since before this bundle ran; it goes once the
  // app behind it is no longer the hidden first frame
  useEffect(() => {
    if (booting) return
    window.desk?.bootDone()
    const el = document.getElementById('splash')
    if (!el) return
    el.dataset.done = ''
    const t = setTimeout(() => el.remove(), 260) // a little past the 0.22s fade in index.html
    return () => clearTimeout(t)
  }, [booting])

  // the one place the palette is chosen; styles.css keys the dark token set off this attribute
  useEffect(() => {
    document.documentElement.dataset.theme = painted
  }, [painted])

  // mini mode is always on top, whatever the preference says; leaving it puts the preference back
  useEffect(() => {
    window.desk?.win.alwaysOnTop(mini || prefs.onTop)
  }, [mini, prefs.onTop])

  // The column's size, which only the DOM knows: the studio beside the terminal fills its height,
  // and what is left of it once the terminal has its minimum is as big as the studio may get.
  useEffect(() => {
    const el = colRef.current
    if (!el) return
    const read = (): void => setCol((c) => (c.w === el.clientWidth && c.h === el.clientHeight ? c : { w: el.clientWidth, h: el.clientHeight }))
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useGlobalShortcuts()
  useAccountsRefresh()

  const activeWs = activeTab?.startsWith('ws:') ? workspaces.find((w) => `ws:${w.id}` === activeTab) ?? null : null

  const openTerminal = (dir: string): void => {
    setLastCwd(dir)
    rememberRecent(dir)
    addWorkspace(dir)
  }

  /**
   * The sidebar's `터미널 이동`: the terminal in front changes to that folder — a `cd` typed into
   * it, and the tab moved with it (its name, its git chip, the explorer following). Only a shell
   * with no claude in it: typed into claude, the `cd` would be a prompt. A session is dropped the
   * moment claude exits (`session_gone`), so "there is a session for this tab" is exactly that.
   */
  const moveWhy = !activeWs || activeWs.ptyId === null ? u.tabs.noFrontTerminal : active ? u.tabs.cannotMoveRunning : null
  const moveTerminal = (dir: string): void => {
    if (!activeWs || activeWs.ptyId === null || active) return
    setLastCwd(dir)
    rememberRecent(dir)
    runInTerminal(activeWs.ptyId, cdCommand(dir))
    moveWorkspace(activeWs.id, dir)
  }

  /**
   * The sidebar's 실행 menu: a fresh terminal in that folder with the command already typed. It goes
   * in as `runOnce`, like a new account's login, not as `initialCommand`: the tab is that folder's
   * terminal — named after the folder, and back at the next start as a plain shell, with the dev
   * server *not* started again (src/workspaces-persist.ts keeps no command).
   */
  const runInFolder = (dir: string, command: string): void => {
    setLastCwd(dir)
    rememberRecent(dir)
    addWorkspace(dir, undefined, undefined, undefined, command)
  }

  const runUpdate = (): void => {
    const cwd = activeWs?.cwd ?? workspaces[0]?.cwd ?? ''
    useDesk.getState().addWorkspace(cwd, u.tabs.updateTab, 'claude update')
  }

  const beside = prefs.deskSide === 'right'
  // the studio's size on screen: the saved one, as far as the terminal's minimum allows (src/layout.ts)
  const deskW = studioSize('w', prefs.deskW, col.w)
  const deskH = studioSize('h', prefs.deskH, col.h)

  /**
   * Both splitters. Dragging writes straight to the store and saves once on release, so a drag is
   * one settings write rather than sixty. It starts from the size on screen, which a narrow window
   * may have made smaller than the saved one, and stops where the terminal would go under its
   * minimum.
   */
  const onDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const side = prefs.deskSide
    const start = side === 'right' ? e.clientX : e.clientY
    const from = side === 'right' ? deskW : deskH
    const { lo, hi } = side === 'right' ? dragRange('w', col.w) : dragRange('h', col.h)
    let v = from
    const move = (ev: MouseEvent): void => {
      // the studio sits to the *right* of the terminal, so dragging left widens it
      const delta = side === 'right' ? start - ev.clientX : ev.clientY - start
      v = Math.round(Math.max(lo, Math.min(hi, from + delta)))
      useDesk.setState((s) => ({ prefs: { ...s.prefs, ...(side === 'right' ? { deskW: v } : { deskH: v }) } }))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setPrefs(side === 'right' ? { deskW: v } : { deskH: v })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const resetSplit = (): void => setPrefs(prefs.deskSide === 'right' ? { deskW: STUDIO_W.def } : { deskH: STUDIO_H.def })

  // Folding the studio away blows it up first, unfolding builds it back (src/desk/fold.ts): the
  // studio stays mounted through the blast after `folded` has flipped, so what gates it is this
  // clock's answer, not the preference itself. The saved value arriving at boot is not a flip.
  const fold = useFold(prefs.folded, booting)
  const keep = useMemo(() => (beside ? { w: deskW, h: Math.max(1, col.h) } : { w: null, h: deskH }), [beside, deskW, deskH, col.h])
  const splitter = (
    <div
      className={`splitter ${beside ? 'is-v' : ''}`}
      role="separator"
      aria-orientation={beside ? 'vertical' : 'horizontal'}
      aria-label={u.tabs.deskSize}
      title={u.tabs.deskResizeTip}
      onMouseDown={onDrag}
      onDoubleClick={resetSplit}
    />
  )
  // shut = zero height (or, beside the terminal, zero width through `--desk-w`); `.is-story` makes the change a slide
  const studio = (
    <DeskStudio
      session={active}
      height={beside ? Math.max(1, col.h) : fold.collapsed ? 0 : deskH}
      fx={fold.fx}
      story={fold.playing}
      shut={fold.collapsed}
      keep={keep}
    />
  )

  /*
   * Mini mode does *not* replace the tree. `TerminalPane` kills its pty when it unmounts, so
   * swapping the whole app out would take every shell — and the claude running in it — down with
   * it, and give back fresh ones on the way out. The normal tree therefore stays mounted and
   * `.app.is-mini` hides it in CSS; `MiniShell` renders on top.
   *
   * The studio is the one thing that cannot be in both: `DeskStudio` is a singleton renderer, so
   * mini mode owns it while it is on and the normal layout skips it.
   */
  return (
    <div className={`app ${mini ? 'is-mini' : ''}`} data-booting={booting ? '' : undefined}>
      {mini && <MiniShell session={active} />}
      <header className="topbar">
        <button className="icon-btn" onClick={() => setPrefs({ showSidebar: !prefs.showSidebar })} title={u.tabs.sidebarTip} aria-label={u.tabs.sidebar} aria-pressed={prefs.showSidebar}>
          <IconSidebar />
        </button>
        <span className="bar-sep" />
        <TabStrip onOpen={openTerminal} onShowSidebar={() => setPrefs({ showSidebar: true })} />
        <div className="status">
          <UsageMeters />
          <UpdatePill onUpdate={runUpdate} />
          <AppUpdatePill />
          <MoreMenu onUpdate={runUpdate} />
        </div>
      </header>
      <div className="body">
        {prefs.showSidebar && <Sidebar start={activeWs?.cwd ?? workspaces[0]?.cwd ?? ''} session={active} onOpen={openTerminal} onMove={moveTerminal} moveWhy={moveWhy} onRun={runInFolder} />}
        <div ref={colRef} className={`column ${beside ? 'is-beside' : ''}`} style={{ ['--desk-w' as string]: `${beside && fold.collapsed ? 0 : deskW}px` }}>
          <Banner />
          {!mini && fold.shown && !beside && (
            <>
              {studio}
              {splitter}
            </>
          )}
          <div className="panes">
            <SessionBar ws={activeWs} session={active} />
            {workspaces.map((w) => (
              <TerminalPane key={w.id} ws={w} visible={activeTab === `ws:${w.id}`} />
            ))}
            {activeTab?.startsWith('session:') && (
              <div className="ext-pane">{u.tabs.externalPane}</div>
            )}
            {!activeTab &&
              (window.desk ? (
                <StartCard onOpen={openTerminal} onShowSidebar={() => setPrefs({ showSidebar: true })} />
              ) : (
                <div className="ext-pane">{u.tabs.studioPreview}</div>
              ))}
          </div>
          {!mini && fold.shown && beside && (
            <>
              {splitter}
              {studio}
            </>
          )}
          <TurnToast />
        </div>
      </div>
      {/* asks once per start as soon as the check finds a newer version; the mini window has no room for it */}
      {!mini && !booting && <AppUpdatePrompt />}
      {/* after the update dialog in the DOM, so it paints over it: the account is answered first */}
      {/* no bridge = the browser preview (scripts/office-smoke.cjs): no accounts to choose from, and a veil would swallow its clicks */}
      {!mini && !booting && !captureRun && !!window.desk && <AccountGate />}
    </div>
  )
}
