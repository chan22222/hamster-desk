import { useEffect, useState } from 'react'
import { middlePath, recentProjects, relTime, type RecentEntry } from '../sidebar/recent'
import { Popover } from './Popover'

function Body({ onOpen, onShowSidebar, close }: { onOpen: (dir: string) => void; onShowSidebar: () => void; close: () => void }) {
  const [rows, setRows] = useState<RecentEntry[]>([])
  useEffect(() => {
    void recentProjects(6).then(setRows)
  }, [])

  const browse = async (): Promise<void> => {
    const dir = await window.desk?.dialog.pickFolder()
    if (dir) onOpen(dir)
  }

  return (
    <div className="pop-body">
      <div className="pop-head">최근 프로젝트</div>
      {rows.length === 0 && <p className="pop-note">아직 연 프로젝트가 없어요.</p>}
      {rows.map((r) => (
        <button
          key={r.path}
          className="pop-item"
          title={r.path}
          onClick={() => {
            onOpen(r.path)
            close()
          }}
        >
          <span className="pop-item-ico">{r.claude ? '🐹' : r.git ? '⎇' : '📁'}</span>
          <span className="pop-item-text">
            <span className="pop-item-name">{r.name}</span>
            <span className="pop-item-sub dim">{middlePath(r.path, 34)}</span>
          </span>
          <span className="dim">{relTime(r.at)}</span>
        </button>
      ))}
      <div className="pop-sep" />
      <button
        className="pop-item"
        onClick={() => {
          void browse()
          close()
        }}
      >
        <span className="pop-item-ico">🔎</span>
        <span className="pop-item-text">폴더 찾아보기…</span>
      </button>
      <button
        className="pop-item"
        onClick={() => {
          onShowSidebar()
          close()
        }}
      >
        <span className="pop-item-ico">≡</span>
        <span className="pop-item-text">사이드바에서 고르기</span>
      </button>
    </div>
  )
}

/** The `+` next to the tabs: open a terminal in a recent project, or go find a folder. */
export function PlusMenu({ onOpen, onShowSidebar }: { onOpen: (dir: string) => void; onShowSidebar: () => void }) {
  return (
    <Popover className="tab-plus" label="+" ariaLabel="새 터미널" title="새 터미널 열기" width={252}>
      {(close) => <Body onOpen={onOpen} onShowSidebar={onShowSidebar} close={close} />}
    </Popover>
  )
}
