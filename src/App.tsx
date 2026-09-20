import { useEffect, useMemo, useRef } from 'react'
import { externalSessions, sessionForTab, useDesk } from './store'
import { setLang } from './i18n'
import { DeskStudio } from './desk/DeskStudio'
import { TerminalPane } from './Terminal'
import { HarnessPill } from './widgets/Harness'
import { FileLog } from './log/FileLog'
import { Sidebar } from './sidebar/Sidebar'
import { rememberRecent } from './sidebar/recent'
import { UsagePill } from './widgets/Usage'
import { UpdatePill } from './widgets/Version'
import { MoreMenu } from './widgets/MoreMenu'
import { PlusMenu } from './widgets/PlusMenu'
import { Popover } from './widgets/Popover'
import { startReplay } from './dev/replay-driver'

const LAST_CWD = 'hd.lastCwd'

/** The × on a tab. A terminal with a live claude session asks first, in a popover. */
function TabClose({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  if (!busy)
    return (
      <button className="tab-x" title="터미널 닫기" aria-label="터미널 닫기" onClick={onClose}>
        ×
      </button>
    )
  return (
    <Popover className="tab-x" label="×" ariaLabel="터미널 닫기" title="터미널 닫기" width={224}>
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
  const booted = useRef(false)

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

  // first terminal
  useEffect(() => {
    if (booted.current || !window.desk) return
    booted.current = true
    void window.desk.info().then((info) => {
      setLang(useDesk.getState().prefs.lang, info.claudeLanguage)
      if (info.debugPrefs) {
        // in-memory only: smoke tests must not overwrite the user's saved preferences
        const { demoAgents, ...rest } = info.debugPrefs as { demoAgents?: number } & Partial<typeof prefs>
        useDesk.setState((s) => ({ prefs: { ...s.prefs, ...rest } }))
        const n = Number(demoAgents ?? 0)
        if (n > 0) void import('./dev/demo').then((m) => m.startDemo(apply, n))
      }
      let cwd = info.home
      try {
        cwd = localStorage.getItem(LAST_CWD) || cwd
      } catch {
        /* ignore */
      }
      if (useDesk.getState().workspaces.length === 0) addWorkspace(cwd)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addWorkspace])

  useEffect(() => {
    window.desk?.win.alwaysOnTop(prefs.onTop)
  }, [prefs.onTop])

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
    try {
      localStorage.setItem(LAST_CWD, dir)
    } catch {
      /* ignore */
    }
    rememberRecent(dir)
    addWorkspace(dir)
  }

  const runUpdate = (): void => {
    const cwd = activeWs?.cwd ?? workspaces[0]?.cwd ?? ''
    useDesk.getState().addWorkspace(cwd, '업데이트', 'claude update')
  }

  const onDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = prefs.deskH
    const move = (ev: MouseEvent): void => setPrefs({ deskH: Math.max(220, Math.min(700, startH + ev.clientY - startY)) })
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setPrefs({ showSidebar: !prefs.showSidebar })} title="사이드바 (Ctrl+B)" aria-label="사이드바" aria-pressed={prefs.showSidebar}>
          ≡
        </button>
        <span className="brand" title="Hamster Desk">
          🐹
        </span>
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
                {workspaces.length > 1 && <TabClose busy={!!s} onClose={() => removeWorkspace(w.id)} />}
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
          <UsagePill />
          <HarnessPill />
          {changed > 0 && (
            <button className={`pill ${prefs.showLog ? 'on' : ''}`} onClick={() => setPrefs({ showLog: !prefs.showLog })} title="바뀐 파일 목록 열기">
              바뀐 파일 {changed}
            </button>
          )}
          <UpdatePill onUpdate={runUpdate} />
          <MoreMenu onUpdate={runUpdate} />
        </div>
      </header>
      <div className="body">
        {prefs.showSidebar && <Sidebar start={activeWs?.cwd ?? workspaces[0]?.cwd ?? ''} onOpen={openTerminal} />}
        <div className="column">
          {!prefs.folded && (
            <>
              <DeskStudio session={active} height={prefs.deskH} />
              <div className="splitter" onMouseDown={onDrag} />
            </>
          )}
          <div className="panes">
            {workspaces.map((w) => (
              <TerminalPane key={w.id} ws={w} visible={activeTab === `ws:${w.id}`} />
            ))}
            {activeTab?.startsWith('session:') && (
              <div className="ext-pane">이 세션은 다른 터미널에서 실행 중입니다. 위 책상에서 지켜볼 수만 있고, 입력은 그 터미널에서 하세요.</div>
            )}
            {!activeTab && <div className="ext-pane">{window.desk ? '터미널을 여는 중…' : '스튜디오 미리보기 · 터미널은 데스크톱 앱에서 사용할 수 있어요.'}</div>}
          </div>
        </div>
        {prefs.showLog && <FileLog session={active} onClose={() => setPrefs({ showLog: false })} />}
      </div>
    </div>
  )
}
