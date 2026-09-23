import { useEffect, useRef, useState } from 'react'
import type { AppUpdateInfo } from '@shared/events'
import { useDesk } from '../store'
import { useUi } from '../i18n'
import { rich } from '../rich'
import { Popover } from './Popover'
import { isTopTrap, useFocusTrap } from './focus'
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
  const txt = useUi()
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
          {u.version ? <span className="dim">{txt.update.now(u.version)}</span> : null}
        </div>
        {ready ? (
          <p>{txt.update.readyNote}</p>
        ) : available ? (
          <p>{txt.update.availableNote}</p>
        ) : (
          <>
            <p>{txt.update.downloadingNote}</p>
            <div className="upd-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rel.percent}>
              <i style={{ width: `${rel.percent}%` }} />
            </div>
          </>
        )}
        {available && u.error && (
          <p className="pop-note upd-why" title={u.error}>
            {rich(txt.update.errorNote(u.error))}
          </p>
        )}
        <p className="pop-note">{txt.update.restartWarn}</p>
        <button className="pop-primary" disabled={busy || rel.state === 'downloading'} onClick={run}>
          {ready ? txt.update.restartToUpdate : available ? txt.update.download : txt.update.downloading(rel.percent)}
        </button>
      </div>
    )
  }
  return (
    <div className="pop-body">
      <div className="pop-head">{txt.update.devHead(u.behind)}</div>
      <ul className="pop-commits">
        {u.commits.map((c) => (
          <li key={c.sha} title={c.sha}>
            {c.title}
          </li>
        ))}
        {u.behind > u.commits.length && <li className="dim">{txt.update.moreCommits(u.behind - u.commits.length)}</li>}
      </ul>
      {u.canSelfUpdate ? <p>{txt.update.devSelfNote}</p> : <p>{txt.update.devNoGitNote}</p>}
      {u.canSelfUpdate && <p className="pop-note">{txt.update.devSelfWarn}</p>}
      <button className="pop-primary" disabled={busy} onClick={run}>
        {u.canSelfUpdate ? txt.update.closeAndUpdate : txt.update.viewOnGitHub}
      </button>
    </div>
  )
}

/** Only appears when there is something to install. */
export function AppUpdatePill() {
  const txt = useUi()
  const u = useDesk((s) => s.appUpdate)
  const what = pending(u)
  if (!u || !what) return null
  const rel = what.release
  return (
    <Popover
      className="pill alert pill-fold"
      label={
        <>
          <IconDownload size={14} />
          {/* below 1100px only the icon stays, and the percentage while it downloads (styles.css) */}
          <span className="pill-text">{rel?.state === 'downloading' ? txt.update.pillDownloading(rel.percent) : txt.update.pill}</span>
          {rel?.state === 'downloading' && <span className="pill-short">{rel.percent}%</span>}
        </>
      }
      ariaLabel={txt.update.appUpdate}
      title={rel ? `Hamster Desk ${rel.version}` : txt.update.pillTipDev(u.behind)}
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
  const txt = useUi()
  const u = useDesk((s) => s.appUpdate)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const what = pending(u)
  const key = !u || !what ? null : what.release ? `release:${what.release.version}` : `commits:${u.commits[0]?.sha ?? u.behind}`
  const open = !!u && key !== null && key !== dismissed

  // a modal: the focus comes in, Tab stays in, and it goes back where it was on "later"
  useFocusTrap(dialogRef, open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      // the account question can be open over this one; its Esc is not a "later" for this
      if (e.key === 'Escape' && isTopTrap(dialogRef.current)) setDismissed(key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, key])

  if (!u || !open) return null
  const later = (): void => setDismissed(key)
  return (
    <div className="upd-veil" onMouseDown={(e) => e.target === e.currentTarget && later()}>
      <div ref={dialogRef} className="upd-dialog" role="dialog" aria-modal="true" aria-label={txt.update.appUpdate}>
        <div className="upd-title">{txt.update.dialogTitle}</div>
        <UpdateBody u={u} close={later} />
        <button className="pop-ghost upd-later" onClick={later}>
          {txt.common.later}
        </button>
      </div>
    </div>
  )
}

/** The "Hamster Desk" block inside the ⋯ menu: which build this is and whether it is current. */
export function AppUpdateSection() {
  const txt = useUi()
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
          {u?.commit ? u.commit.slice(0, 7) : u?.version ? '' : txt.update.localBuild}
        </span>
        {rel?.state === 'ready' ? (
          <span className="dim">{txt.update.ready(rel.version)}</span>
        ) : rel?.state === 'downloading' ? (
          <span className="dim">{txt.update.downloadingVersion(rel.version, rel.percent)}</span>
        ) : checking ? (
          <span className="dim">{txt.update.checking}</span>
        ) : failed ? (
          <span className="dim">{txt.update.checkFailed}</span>
        ) : rel?.state === 'available' ? (
          <span className="dim">{txt.update.available(rel.version)}</span>
        ) : u?.behind ? (
          <span className="dim">{txt.update.newChanges(u.behind)}</span>
        ) : u && !u.error ? (
          <span className="ok">{txt.update.upToDate}</span>
        ) : null}
      </div>
      {failed && !checking && (
        <p className="pop-note upd-why" title={u?.error ?? ''}>
          {rich(txt.update.autoRetry(u?.error ?? ''))}
        </p>
      )}
      <div className="pop-row">
        <button className="pop-ghost" onClick={recheck} disabled={checking}>
          <IconRefresh size={14} />
          {txt.common.recheck}
        </button>
      </div>
    </>
  )
}
