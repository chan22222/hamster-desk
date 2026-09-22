import { useEffect, useRef, useState, type ReactNode } from 'react'
import { externalSessions, freezePrefs, hydrateUi, runInTerminal, sessionForTab, setDebugClick, useDesk } from './store'
import { setLang, useUi } from './i18n'
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

/** studio size limits, shared by the splitters and their double-click reset */
const DESK_H = { min: 220, max: 700, def: 420 }
const DESK_W = { min: 320, max: 900, def: 520 }

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
function TabClose({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  const u = useUi()
  if (!busy)
    return (
      <button className="tab-x" title={u.tabs.closeTerminal} aria-label={u.tabs.closeTerminal} onClick={onClose}>
        <IconClose size={12} />
      </button>
    )
  return (
    <Popover className="tab-x" label={<IconClose size={12} />} ariaLabel={u.tabs.closeTerminal} title={u.tabs.closeTerminal} width={224}>
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

export default function App() {
  const u = useUi()
  const apply = useDesk((s) => s.apply)
  const sessions = useDesk((s) => s.sessions)
  const workspaces = useDesk((s) => s.workspaces)
  const activeTab = useDesk((s) => s.activeTab)
  const setActiveTab = useDesk((s) => s.setActiveTab)
  const addWorkspace = useDesk((s) => s.addWorkspace)
  const moveWorkspace = useDesk((s) => s.moveWorkspace)
  const removeWorkspace = useDesk((s) => s.removeWorkspace)
  const ptyWaiting = useDesk((s) => s.ptyWaiting)
  const prefs = useDesk((s) => s.prefs)
  const setPrefs = useDesk((s) => s.setPrefs)
  const mini = useDesk((s) => s.mini)
  const painted = usePainted()
  const booted = useRef(false)
  // the settings file is read over IPC, so the first frame would be the defaults; hide it instead
  const [booting, setBooting] = useState(() => !!window.desk)
  const colRef = useRef<HTMLDivElement>(null)
  const [colH, setColH] = useState(0)
  // a capture run (src/dev/debug.ts) has nobody to answer a dialog: the account question stays away
  const [captureRun, setCaptureRun] = useState(false)

  // event stream (with backlog replay) or browser-only replay
  useEffect(() => {
    const bridge = window.desk
    if (!bridge) return startReplay(apply)
    let last = 0
    const take = (item: { seq: number; ev: import('@shared/events').DeskEvent }): void => {
      if (item.seq <= last) return
      last = item.seq
      apply(item.ev)
    }
    const queue: { seq: number; ev: import('@shared/events').DeskEvent }[] = []
    let ready = false
    const off = bridge.onEvent((item) => (ready ? take(item) : queue.push(item)))
    void bridge.backlog(0).then((items) => {
      items.forEach(take)
      queue.forEach(take)
      queue.length = 0
      ready = true
    })
    return off
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

  // the studio beside the terminal fills the column, which only the DOM knows the height of
  useEffect(() => {
    const el = colRef.current
    if (!el) return
    const read = (): void => setColH((h) => (h === el.clientHeight ? h : el.clientHeight))
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useGlobalShortcuts()
  useAccountsRefresh()

  const st = { sessions, workspaces }
  const externals = externalSessions(sessions)
  // browser replay has no terminals: show the replayed session instead of an empty desk
  const active = sessionForTab(st, activeTab) ?? (!window.desk && !activeTab ? externals[0] ?? null : null)
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

  /**
   * Both splitters. Dragging writes straight to the store and saves once on release, so a drag is
   * one settings write rather than sixty.
   */
  const onDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const side = prefs.deskSide
    const start = side === 'right' ? e.clientX : e.clientY
    const from = side === 'right' ? prefs.deskW : prefs.deskH
    const { min, max } = side === 'right' ? DESK_W : DESK_H
    let v = from
    const move = (ev: MouseEvent): void => {
      // the studio sits to the *right* of the terminal, so dragging left widens it
      const delta = side === 'right' ? start - ev.clientX : ev.clientY - start
      v = Math.max(min, Math.min(max, from + delta))
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

  const resetSplit = (): void => setPrefs(prefs.deskSide === 'right' ? { deskW: DESK_W.def } : { deskH: DESK_H.def })

  const beside = prefs.deskSide === 'right'
  // Folding the studio away blows it up first, unfolding builds it back (src/desk/fold.ts): the
  // studio stays mounted through the blast after `folded` has flipped, so what gates it is this
  // clock's answer, not the preference itself. The saved value arriving at boot is not a flip.
  const fold = useFold(prefs.folded, booting)
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
      height={beside ? Math.max(1, colH) : fold.collapsed ? 0 : prefs.deskH}
      fx={fold.fx}
      story={fold.playing}
      shut={fold.collapsed}
      keep={beside ? { w: prefs.deskW, h: Math.max(1, colH) } : { w: null, h: prefs.deskH }}
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
        <div className="tabs">
          {workspaces.map((w) => {
            const s = Object.values(sessions).find((x) => x.info.ptyId === w.ptyId && w.ptyId !== null)
            const busy = s?.info.status === 'busy'
            const waiting = w.ptyId !== null && !!ptyWaiting[w.ptyId]
            const n = s?.order.length ?? 0
            const id = `ws:${w.id}`
            return (
              <div key={id} className={`tab ${activeTab === id ? 'active' : ''}`}>
                <button className="tab-main" onClick={() => setActiveTab(id)} title={w.cwd}>
                  <span className={`dot ${s ? (busy ? 'busy' : 'idle') : ''} ${waiting ? 'wait' : ''}`} />
                  <TabText title={s?.title || w.title} folder={s?.title ? w.title : null}>
                    <AccountBadge profileId={w.profileId} />
                    <TabContext session={s ?? null} />
                    <TabGit cwd={w.cwd} />
                    {n > 1 && <span className="count">🐹×{n}</span>}
                  </TabText>
                </button>
                <TabClose busy={!!s} onClose={() => removeWorkspace(w.id)} />
              </div>
            )
          })}
          <PlusMenu onOpen={openTerminal} onShowSidebar={() => setPrefs({ showSidebar: true })} />
          {externals.length > 0 && <span className="tab-sep" />}
          {externals.map((s) => {
            const id = `session:${s.info.sessionId}`
            return (
              <div key={id} className={`tab ext ${activeTab === id ? 'active' : ''}`}>
                <button className="tab-main" onClick={() => setActiveTab(id)} title={u.tabs.externalTab(s.info.cwd)}>
                  <span className={`dot ${s.info.status === 'busy' ? 'busy' : 'idle'}`} />
                  <TabText title={s.title || s.info.name || s.info.sessionId.slice(0, 8)} folder={baseName(s.info.cwd) || null}>
                    <AccountBadge profileId={s.info.profileId} />
                    <TabContext session={s} />
                    {s.order.length > 1 && <span className="count">🐹×{s.order.length}</span>}
                  </TabText>
                </button>
              </div>
            )
          })}
        </div>
        <div className="status">
          <UsageMeters />
          <UpdatePill onUpdate={runUpdate} />
          <AppUpdatePill />
          <MoreMenu onUpdate={runUpdate} />
        </div>
      </header>
      <div className="body">
        {prefs.showSidebar && <Sidebar start={activeWs?.cwd ?? workspaces[0]?.cwd ?? ''} session={active} onOpen={openTerminal} onMove={moveTerminal} moveWhy={moveWhy} onRun={runInFolder} />}
        <div ref={colRef} className={`column ${beside ? 'is-beside' : ''}`} style={{ ['--desk-w' as string]: `${beside && fold.collapsed ? 0 : prefs.deskW}px` }}>
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
