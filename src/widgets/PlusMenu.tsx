import { AccountPicker } from '../accounts/Accounts'
import { RecentList } from './RecentList'
import { Popover } from './Popover'
import { IconPlus, IconSearch, IconSidebar } from './icons'

function Actions({ onOpen, onShowSidebar, close }: { onOpen: (dir: string) => void; onShowSidebar: () => void; close: () => void }) {
  const browse = async (): Promise<void> => {
    const dir = await window.desk?.dialog.pickFolder()
    if (dir) onOpen(dir)
  }
  return (
    <>
      <div className="pop-sep" />
      <button
        className="pop-item"
        onClick={() => {
          void browse()
          close()
        }}
      >
        <span className="pop-item-ico">
          <IconSearch size={14} />
        </span>
        <span className="pop-item-text">폴더 찾아보기…</span>
      </button>
      <button
        className="pop-item"
        onClick={() => {
          onShowSidebar()
          close()
        }}
      >
        <span className="pop-item-ico">
          <IconSidebar size={14} />
        </span>
        <span className="pop-item-text">사이드바에서 고르기</span>
      </button>
    </>
  )
}

/** The `+` next to the tabs: the whole "new terminal" screen — search, every recent project, browse. */
export function PlusMenu({ onOpen, onShowSidebar }: { onOpen: (dir: string) => void; onShowSidebar: () => void }) {
  return (
    <Popover className="tab-plus" label={<IconPlus />} ariaLabel="새 터미널" title="새 터미널 열기" width={320} debugClick="plus">
      {(close) => (
        <div className="pop-body">
          <div className="pop-head">새 터미널</div>
          <AccountPicker />
          <RecentList
            onOpen={(dir) => {
              onOpen(dir)
              close()
            }}
            maxHeight={420}
          />
          <Actions onOpen={onOpen} onShowSidebar={onShowSidebar} close={close} />
        </div>
      )}
    </Popover>
  )
}

/** The middle of the window when there is no terminal at all: the same list, as a card. */
export function StartCard({ onOpen, onShowSidebar }: { onOpen: (dir: string) => void; onShowSidebar: () => void }) {
  return (
    <div className="start-pane">
      <div className="start-card">
        <div className="pop-body">
          <div className="pop-head">새 터미널</div>
          <AccountPicker />
          <RecentList onOpen={onOpen} maxHeight={280} />
          <Actions onOpen={onOpen} onShowSidebar={onShowSidebar} close={() => undefined} />
        </div>
      </div>
    </div>
  )
}
