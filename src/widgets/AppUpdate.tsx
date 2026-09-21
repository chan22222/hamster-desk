import { useState } from 'react'
import { useDesk } from '../store'
import { Popover } from './Popover'
import { IconDownload, IconRefresh } from './icons'

/**
 * Only appears when `main` on GitHub is ahead of this build. Unlike `claude update`, which runs in
 * a tab of its own, updating the app closes it — and every terminal with it — so the button opens
 * what would change and asks first.
 */
export function AppUpdatePill() {
  const u = useDesk((s) => s.appUpdate)
  const [busy, setBusy] = useState(false)
  if (!u?.behind) return null
  const run = (close: () => void): void => {
    setBusy(true)
    void window.desk?.appUpdate
      .run()
      .then((r) => {
        if (r === 'opened') close() // 'updating': the app is quitting, leave the panel as it is
      })
      .finally(() => setBusy(false))
  }
  return (
    <Popover
      className="pill alert"
      label={
        <>
          <IconDownload size={14} />
          앱 업데이트
        </>
      }
      ariaLabel="Hamster Desk 업데이트"
      title={`Hamster Desk 새 버전 (변경 ${u.behind}개)`}
      width={300}
    >
      {(close) => (
        <div className="pop-body">
          <div className="pop-head">Hamster Desk 새 버전 · 변경 {u.behind}개</div>
          <ul className="pop-commits">
            {u.commits.map((c) => (
              <li key={c.sha} title={c.sha}>
                {c.title}
              </li>
            ))}
            {u.behind > u.commits.length && <li className="dim">… 외 {u.behind - u.commits.length}개</li>}
          </ul>
          {u.canSelfUpdate ? (
            <p>앱을 닫고 받아서 다시 빌드한 뒤 다시 엽니다. 열려 있는 터미널과 그 안의 Claude 는 모두 종료됩니다.</p>
          ) : (
            <p>이 실행 파일은 git 저장소 밖에 있어 스스로 업데이트할 수 없어요. 변경 내역을 열어 드릴게요.</p>
          )}
          <button className="pop-primary" disabled={busy} onClick={() => run(close)}>
            {u.canSelfUpdate ? '닫고 업데이트' : 'GitHub 에서 보기'}
          </button>
        </div>
      )}
    </Popover>
  )
}

/** The "Hamster Desk" block inside the ⋯ menu: which build this is and whether it is current. */
export function AppUpdateSection() {
  const u = useDesk((s) => s.appUpdate)
  const recheck = (): void => void window.desk?.appUpdate.check(true)
  // 'no build commit' / 'unknown commit' are not failures to report: there is just nothing to compare
  const failed = !!u?.error && u.error !== 'no build commit' && u.error !== 'unknown commit'
  return (
    <>
      <div className="pop-line">
        <span>{u?.commit ? u.commit.slice(0, 7) : '로컬 빌드'}</span>
        {failed ? (
          <span className="dim"> · 확인 실패</span>
        ) : u?.behind ? (
          <span className="dim"> · 새 변경 {u.behind}개</span>
        ) : u && !u.error ? (
          <span className="ok"> · 최신</span>
        ) : null}
      </div>
      <div className="pop-row">
        <button className="pop-ghost" onClick={recheck}>
          <IconRefresh size={14} />
          다시 확인
        </button>
      </div>
    </>
  )
}
