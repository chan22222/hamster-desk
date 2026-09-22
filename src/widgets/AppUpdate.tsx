import { useEffect, useState } from 'react'
import type { AppUpdateInfo } from '@shared/events'
import { useDesk } from '../store'
import { Popover } from './Popover'
import { IconDownload, IconRefresh } from './icons'

// The app's own updates, in three places that say the same thing:
//   AppUpdatePrompt  — a dialog, once per start, as soon as the check finds something. A pill in a
//                      corner of the top bar was easy to never notice.
//   AppUpdatePill    — stays in the top bar after "later", so the update is one click away
//   AppUpdateSection — the `⋯` menu: which build this is, whether it is current, and *why* a check
//                      failed. "확인 실패" alone was all anyone could report.
//
// Updating closes the app — and every terminal with it — so none of these acts without saying so.

/** not failures to report: there is just nothing to compare this build with */
const BENIGN = new Set(['no build commit', 'unknown commit'])

/** what there is to install, or null: a newer release (an installed build) or newer commits (a build out of a checkout) */
function pending(u: AppUpdateInfo | null): { release: NonNullable<AppUpdateInfo['release']> | null } | null {
  if (!u) return null
  if (u.release) return { release: u.release }
  return u.behind > 0 ? { release: null } : null
}

/** The same body in the dialog and in the pill's popover. `close`: hide whatever is showing it. */
function UpdateBody({ u, close }: { u: AppUpdateInfo; close: () => void }) {
  const [busy, setBusy] = useState(false)
  const run = (): void => {
    setBusy(true)
    void window.desk?.appUpdate
      .run()
      .then((r) => {
        if (r === 'opened') close() // 'updating': the app is quitting, leave this as it is
      })
      .finally(() => setBusy(false))
  }
  const rel = u.release
  if (rel) {
    // nothing is downloaded before "업데이트 받기": that button starts it, the progress bar follows it,
    // and only then does the same button restart into the setup
    const ready = rel.state === 'ready'
    const available = rel.state === 'available'
    return (
      <div className="pop-body">
        <div className="pop-head">
          Hamster Desk {rel.version}
          {u.version ? <span className="dim"> · 지금 {u.version}</span> : null}
        </div>
        {ready ? (
          <p>새 버전을 받아 두었어요. 다시 시작하면 설치 창이 잠깐 떴다가 앱이 스스로 다시 열립니다.</p>
        ) : available ? (
          <p>누르면 새 버전을 받기 시작해요. 받는 동안에도 앱은 그대로 쓸 수 있고, 다 받으면 다시 시작할지 한 번 더 묻습니다.</p>
        ) : (
          <>
            <p>새 버전을 받는 중이에요. 다 받으면 아래 버튼이 켜집니다.</p>
            <div className="upd-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rel.percent}>
              <i style={{ width: `${rel.percent}%` }} />
            </div>
          </>
        )}
        {available && u.error && (
          <p className="pop-note upd-why" title={u.error}>
            {u.error} — 다시 눌러 보세요. 기록: <code>~/.hamster-desk/update.log</code>
          </p>
        )}
        <p className="pop-note">다시 시작할 때 열려 있는 터미널과 그 안의 Claude 는 모두 종료됩니다. 설치가 끝날 때까지 작업 표시줄 아이콘은 누르지 마세요.</p>
        <button className="pop-primary" disabled={busy || rel.state === 'downloading'} onClick={run}>
          {ready ? '다시 시작해서 업데이트' : available ? '업데이트 받기' : `받는 중 ${rel.percent}%`}
        </button>
      </div>
    )
  }
  return (
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
        <p>앱을 닫고 받아서 다시 빌드한 뒤 스스로 다시 엽니다(1분쯤). 진행 상황은 검은 창에 나옵니다.</p>
      ) : (
        <p>이 실행 파일은 git 저장소 밖에 있어 스스로 업데이트할 수 없어요. 변경 내역을 열어 드릴게요.</p>
      )}
      {u.canSelfUpdate && <p className="pop-note">열려 있는 터미널과 그 안의 Claude 는 모두 종료됩니다. 끝날 때까지 작업 표시줄 아이콘은 누르지 마세요.</p>}
      <button className="pop-primary" disabled={busy} onClick={run}>
        {u.canSelfUpdate ? '닫고 업데이트' : 'GitHub 에서 보기'}
      </button>
    </div>
  )
}

/** Only appears when there is something to install. */
export function AppUpdatePill() {
  const u = useDesk((s) => s.appUpdate)
  const what = pending(u)
  if (!u || !what) return null
  const rel = what.release
  return (
    <Popover
      className="pill alert"
      label={
        <>
          <IconDownload size={14} />
          {rel?.state === 'downloading' ? `업데이트 받는 중 ${rel.percent}%` : '앱 업데이트'}
        </>
      }
      ariaLabel="Hamster Desk 업데이트"
      title={rel ? `Hamster Desk ${rel.version}` : `Hamster Desk 새 버전 (변경 ${u.behind}개)`}
      width={300}
    >
      {(close) => <UpdateBody u={u} close={close} />}
    </Popover>
  )
}

/**
 * The dialog. Once per start and per version: "later" keeps it away until the app is started again
 * (the pill stays), and a newer version found while the app is open asks again.
 */
export function AppUpdatePrompt() {
  const u = useDesk((s) => s.appUpdate)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const what = pending(u)
  const key = !u || !what ? null : what.release ? `release:${what.release.version}` : `commits:${u.commits[0]?.sha ?? u.behind}`
  const open = key !== null && key !== dismissed

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDismissed(key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, key])

  if (!u || !open) return null
  const later = (): void => setDismissed(key)
  return (
    <div className="upd-veil" onMouseDown={(e) => e.target === e.currentTarget && later()}>
      <div className="upd-dialog" role="dialog" aria-modal="true" aria-label="Hamster Desk 업데이트">
        <div className="upd-title">새 버전이 나왔어요</div>
        <UpdateBody u={u} close={later} />
        <button className="pop-ghost upd-later" onClick={later}>
          나중에
        </button>
      </div>
    </div>
  )
}

/** The "Hamster Desk" block inside the ⋯ menu: which build this is and whether it is current. */
export function AppUpdateSection() {
  const u = useDesk((s) => s.appUpdate)
  const [checking, setChecking] = useState(false)
  const recheck = (): void => {
    setChecking(true)
    void window.desk?.appUpdate.check(true).finally(() => setChecking(false))
  }
  const failed = !!u?.error && !BENIGN.has(u.error)
  const rel = u?.release
  return (
    <>
      <div className="pop-line">
        <span>
          {u?.version ? `v${u.version}` : ''}
          {u?.version && u.commit ? ' · ' : ''}
          {u?.commit ? u.commit.slice(0, 7) : u?.version ? '' : '로컬 빌드'}
        </span>
        {rel?.state === 'ready' ? (
          <span className="dim"> · 새 버전 {rel.version} 준비됨</span>
        ) : rel?.state === 'downloading' ? (
          <span className="dim"> · 새 버전 {rel.version} 받는 중 {rel.percent}%</span>
        ) : checking ? (
          <span className="dim"> · 확인 중…</span>
        ) : failed ? (
          <span className="dim"> · 확인 실패</span>
        ) : rel?.state === 'available' ? (
          <span className="dim"> · 새 버전 {rel.version} 있음</span>
        ) : u?.behind ? (
          <span className="dim"> · 새 변경 {u.behind}개</span>
        ) : u && !u.error ? (
          <span className="ok"> · 최신</span>
        ) : null}
      </div>
      {failed && !checking && (
        <p className="pop-note upd-why" title={u?.error ?? ''}>
          {u?.error} — 잠시 뒤 자동으로 다시 확인해요. 기록: <code>~/.hamster-desk/update.log</code>
        </p>
      )}
      <div className="pop-row">
        <button className="pop-ghost" onClick={recheck} disabled={checking}>
          <IconRefresh size={14} />
          다시 확인
        </button>
      </div>
    </>
  )
}
