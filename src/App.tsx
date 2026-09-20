import { useEffect, useMemo, useRef, useState } from 'react'
import { externalSessions, freezePrefs, hydrateUi, sessionForTab, setDebugClick, useDesk } from './store'
import { setLang } from './i18n'
import { DeskStudio } from './desk/DeskStudio'
import { TerminalPane } from './Terminal'
import { Sidebar } from './sidebar/Sidebar'
import { lastCwd, rememberRecent, setLastCwd } from './sidebar/recent'
import { UsageMeters } from './widgets/Usage'
import { UpdatePill } from './widgets/Version'
import { MoreMenu } from './widgets/MoreMenu'
import { PlusMenu, StartCard } from './widgets/PlusMenu'
import { Popover } from './widgets/Popover'
import { usePainted } from './widgets/theme'
import { IconClose, IconSidebar } from './widgets/icons'
import { startReplay } from './dev/replay-driver'

/** studio size limits, shared by the splitters and their double-click reset */
const DESK_H = { min: 220, max: 700, def: 420 }
const DESK_W = { min: 320, max: 900, def: 520 }

/** The × on a tab. A terminal with a live claude session asks first, in a popover. */
function TabClose({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  if (!busy)
    return (
      <button className="tab-x" title="터미널 닫기" aria-label="터미널 닫기" onClick={onClose}>
        <IconClose size={12} />
      </button>
    )
  return (
    <Popover className="tab-x" label={<IconClose size={12} />} ariaLabel="터미널 닫기" title="터미널 닫기" width={224}>
      {(close) => (
        <div className="pop-body">
          <p>이 터미널에서 Claude 가 실행 중이에요. 닫으면 하던 일이 멈춥니다.</p>
          <button
            className="pop-primary"
            onClick={() => {
              close()
              onClose()
            }}
          >
            그래도 닫기
          </button>
        </div>
      )}
    </Popover>
  )
}

export default function App() {
  const apply = useDesk((s) => s.apply)
  const sessions = useDesk((s) => s.sessions)
  const workspaces = useDesk((s) => s.workspaces)
  const activeTab = useDesk((s) => s.activeTab)
  const setActiveTab = useDesk((s) => s.setActiveTab)
  const addWorkspace = useDesk((s) => s.addWorkspace)
  const removeWorkspace = useDesk((s) => s.removeWorkspace)
  const ptyWaiting = useDesk((s) => s.ptyWaiting)
  const prefs = useDesk((s) => s.prefs)
  const setPrefs = useDesk((s) => s.setPrefs)
  const painted = usePainted()
  const booted = useRef(false)
  // the settings file is read over IPC, so the first frame would be the defaults; hide it instead
  const [booting, setBooting] = useState(() => !!window.desk)
  const colRef = useRef<HTMLDivElement>(null)
  const [colH, setColH] = useState(0)

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
      .then((info) => {
        if (!info) return
        setLang(useDesk.getState().prefs.lang, info.claudeLanguage)
        setDebugClick(info.debugClick)
        if (info.debugPrefs) {
          // forced prefs are for this run only: freeze the store so nothing reaches ~/.hamster-desk/ui.json
          const { demoAgents, ...rest } = info.debugPrefs as { demoAgents?: number } & Partial<typeof prefs>
          freezePrefs()
          useDesk.setState((s) => ({ prefs: { ...s.prefs, ...rest } }))
          const n = Number(demoAgents ?? 0)
          if (n > 0) void import('./dev/demo').then((m) => m.startDemo(apply, n))
        }
        if (useDesk.getState().workspaces.length === 0) addWorkspace(lastCwd() || info.home)
      })
      .finally(() => setBooting(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addWorkspace])

  // the one place the palette is chosen; styles.css keys the dark token set off this attribute
  useEffect(() => {
    document.documentElement.dataset.theme = painted
  }, [painted])

  useEffect(() => {
    window.desk?.win.alwaysOnTop(prefs.onTop)
  }, [prefs.onTop])

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

  // Ctrl+B: the sidebar, wherever the focus is (the terminal lets this one through)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b') return
      e.preventDefault()
      const s = useDesk.getState()
      s.setPrefs({ showSidebar: !s.prefs.showSidebar })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const st = { sessions, workspaces }
  const externals = externalSessions(sessions)
  // browser replay has no terminals: show the replayed session instead of an empty desk
  const active = sessionForTab(st, activeTab) ?? (!window.desk && !activeTab ? externals[0] ?? null : null)
  const activeWs = activeTab?.startsWith('ws:') ? workspaces.find((w) => `ws:${w.id}` === activeTab) ?? null : null
  const changed = useMemo(() => new Set((active?.edits ?? []).map((e) => e.file)).size, [active?.edits])

  const openTerminal = (dir: string): void => {
    setLastCwd(dir)
    rememberRecent(dir)
    addWorkspace(dir)
  }

  const runUpdate = (): void => {
    const cwd = activeWs?.cwd ?? workspaces[0]?.cwd ?? ''
    useDesk.getState().addWorkspace(cwd, '업데이트', 'claude update')
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
  const splitter = (
    <div
      className={`splitter ${beside ? 'is-v' : ''}`}
      role="separator"
      aria-orientation={beside ? 'vertical' : 'horizontal'}
      aria-label="책상 크기"
      title="끌어서 크기 조절 · 더블클릭: 기본값"
      onMouseDown={onDrag}
      onDoubleClick={resetSplit}
    />
  )
  const studio = <DeskStudio session={active} height={beside ? Math.max(1, colH) : prefs.deskH} />

  return (
    <div className="app" data-booting={booting ? '' : undefined}>
      <header className="topbar">
        <button className="icon-btn" onClick={() => setPrefs({ showSidebar: !prefs.showSidebar })} title="사이드바 (Ctrl+B)" aria-label="사이드바" aria-pressed={prefs.showSidebar}>
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
                  <span className="tab-label">{s?.title || w.title}</span>
                  {n > 1 && <span className="count">🐹×{n}</span>}
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
                <button className="tab-main" onClick={() => setActiveTab(id)} title={`${s.info.cwd} (다른 터미널에서 실행 중)`}>
                  <span className={`dot ${s.info.status === 'busy' ? 'busy' : 'idle'}`} />
                  <span className="tab-label">{s.title || s.info.name || s.info.sessionId.slice(0, 8)}</span>
                  {s.order.length > 1 && <span className="count">🐹×{s.order.length}</span>}
                </button>
              </div>
            )
          })}
        </div>
        <div className="status">
          <UsageMeters />
          {changed > 0 && (
            <button
              className={`pill ${prefs.showSidebar && prefs.showLog ? 'on' : ''}`}
              onClick={() => (prefs.showSidebar && prefs.showLog ? setPrefs({ showLog: false }) : setPrefs({ showSidebar: true, showLog: true }))}
              title="사이드바의 '바뀐 파일' 열기"
            >
              바뀐 파일 {changed}
            </button>
          )}
          <UpdatePill onUpdate={runUpdate} />
          <MoreMenu onUpdate={runUpdate} />
        </div>
      </header>
      <div className="body">
        {prefs.showSidebar && <Sidebar start={activeWs?.cwd ?? workspaces[0]?.cwd ?? ''} session={active} onOpen={openTerminal} />}
        <div ref={colRef} className={`column ${beside ? 'is-beside' : ''}`} style={{ ['--desk-w' as string]: `${prefs.deskW}px` }}>
          {!prefs.folded && !beside && (
            <>
              {studio}
              {splitter}
            </>
          )}
          <div className="panes">
            {workspaces.map((w) => (
              <TerminalPane key={w.id} ws={w} visible={activeTab === `ws:${w.id}`} />
            ))}
            {activeTab?.startsWith('session:') && (
              <div className="ext-pane">이 세션은 다른 터미널에서 실행 중입니다. 위 책상에서 지켜볼 수만 있고, 입력은 그 터미널에서 하세요.</div>
            )}
            {!activeTab &&
              (window.desk ? (
                <StartCard onOpen={openTerminal} onShowSidebar={() => setPrefs({ showSidebar: true })} />
              ) : (
                <div className="ext-pane">스튜디오 미리보기 · 터미널은 데스크톱 앱에서 사용할 수 있어요.</div>
              ))}
          </div>
          {!prefs.folded && beside && (
            <>
              {splitter}
              {studio}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
