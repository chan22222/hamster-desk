import { useEffect, useState } from 'react'
import type { RateWindow, StatusSnapshot } from '@shared/events'
import { resolveProfileId, useDesk } from '../store'
import { formatDate, formatTime, useUi, type UiStrings } from '../i18n'
import { rich } from '../rich'
import { Popover } from './Popover'
import '../accounts/accounts.css'

type SLState = 'installed' | 'foreign' | 'none' | 'unknown'

/** `18:20` today, `Sep 13, 18:20` / `9월 13일 18:20` on another day — the day in the UI language's own order */
export function fmtReset(ms: number | null): string {
  if (!ms) return ''
  if (new Date(ms).toDateString() === new Date().toDateString()) return formatTime(ms)
  return formatDate(ms, { time: true })
}

function remaining(ms: number | null, u: UiStrings): string {
  if (!ms) return ''
  const diff = ms - Date.now()
  if (diff <= 0) return u.common.soon
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (h >= 24) return u.time.daysHours(Math.floor(h / 24), h % 24)
  return h ? u.time.hoursMinutes(h, m) : u.time.minutes(m)
}

/** The chip version: one unit past a day, two below it — it has to fit next to the percentage. */
function countdown(ms: number | null, u: UiStrings): string {
  if (!ms) return ''
  const diff = ms - Date.now()
  if (diff <= 0) return u.common.soon
  const h = Math.floor(diff / 3600000)
  if (h >= 24) return u.time.days(Math.floor(h / 24))
  const m = Math.floor((diff % 3600000) / 60000)
  return h ? u.time.hoursMinutes(h, m) : u.time.minutes(m)
}

/**
 * Three steps, and the same class goes on the percentage — colour is never the only cue.
 * Exported because the context meter (src/session/ContextMeter.tsx) has to land on exactly the
 * same thresholds and the same three words the usage chips already use.
 */
export const step = (pct: number): string => (pct >= 90 ? 'is-hot' : pct >= 70 ? 'is-warm' : 'is-ok')
const clamp = (w: RateWindow): number => Math.max(0, Math.min(100, w.usedPercentage))

const SEGMENTS = [0, 1, 2, 3, 4]

/** Five blocks, one per 20 %. Redundant with the number next to it — that is the point. */
export function Meter({ pct }: { pct: number }) {
  const filled = pct <= 0 ? 0 : Math.min(5, Math.ceil(pct / 20))
  return (
    <span className={`meter ${step(pct)}`} aria-hidden="true">
      {SEGMENTS.map((i) => (
        <i key={i} className={i < filled ? 'is-full' : ''} />
      ))}
    </span>
  )
}

function Row({ label, w }: { label: string; w: RateWindow | null }) {
  const u = useUi()
  if (!w) return null
  const pct = clamp(w)
  return (
    <div className="u-row">
      <span className="u-name">{label}</span>
      <span className={`u-track ${step(pct)}`}>
        <span className="u-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="u-pct">{pct.toFixed(0)}%</span>
      <span className="u-when">
        {u.usage.resetAt(fmtReset(w.resetsAt))}
        {w.resetsAt ? u.usage.remaining(remaining(w.resetsAt, u)) : ''}
      </span>
    </div>
  )
}

interface WindowRow {
  key: string
  /** the long name, for the popover */
  name: string
  /** the short name, for the chip */
  short: string
  /** which model's own weekly window this is; the chip says it after the number */
  who?: string
  w: RateWindow
}

/** The weekly window that will stop the account first: the all-model one, or one model's own. */
function weeklyMax(u: StatusSnapshot): { who: string | null; w: RateWindow | null } {
  let best: { who: string | null; w: RateWindow | null } = { who: null, w: u.sevenDay }
  for (const [k, w] of Object.entries(u.otherWindows ?? {})) if (!best.w || w.usedPercentage > best.w.usedPercentage) best = { who: k, w }
  return best
}

/** `주 42%`, or `주·Fable 88%` when a model's own weekly window is the fuller one. */
function WeekBrief({ snap }: { snap: StatusSnapshot }) {
  const u = useUi()
  const m = weeklyMax(snap)
  return <Brief label={m.who ? u.usage.weekOf(m.who) : u.usage.week} w={m.w} />
}

/** `3분 전` — how old a snapshot is. An account nobody is using right now keeps its last numbers. */
function ago(ts: number, u: UiStrings): string {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return u.time.justNow
  if (m < 60) return u.time.minutesAgo(m)
  const h = Math.floor(m / 60)
  return h < 24 ? u.time.hoursAgo(h) : u.time.daysAgo(Math.floor(h / 24))
}

/** `5h 81%`; a window whose reset time has passed since the snapshot is simply empty again. */
function Brief({ label, w }: { label: string; w: RateWindow | null }) {
  const u = useUi()
  if (!w) return null
  if (w.resetsAt && w.resetsAt < Date.now()) return <span className="au-num">{u.usage.wasReset(label)}</span>
  const pct = clamp(w)
  return (
    <span className={`au-num ${step(pct)}`}>
      {label} {pct.toFixed(0)}%
    </span>
  )
}

/**
 * One account's last known numbers on one line — `5h 81% · 주 42% · 3분 전` — for wherever accounts
 * are listed (the accounts menu). Nothing when that account has never reported any: the CLI only
 * says them while the account is talking, and only with the status line linked.
 */
export function AccountUsageLine({ profileId }: { profileId: string }) {
  const u = useUi()
  const snap = useDesk((s) => s.usageByProfile[profileId])
  if (!snap || (!snap.fiveHour && !snap.sevenDay)) return null
  return (
    <span className="au-line">
      <Brief label="5h" w={snap.fiveHour} />
      <WeekBrief snap={snap} />
      <span className="au-age">{ago(snap.ts, u)}</span>
    </span>
  )
}

/**
 * Every account's last known numbers, under the detail of the one on screen. Rate limits belong
 * to whoever is logged in, and the CLI only reports them while that account is talking — so each
 * row also says how old it is. Nothing while there is only one account.
 */
function AccountUsageList({ shownId }: { shownId: string }) {
  const u = useUi()
  const profiles = useDesk((s) => s.profiles)
  const usageBy = useDesk((s) => s.usageByProfile)
  const [states, setStates] = useState<Record<string, SLState>>({})

  useEffect(() => {
    let alive = true
    for (const p of profiles) {
      void window.desk?.statusline.state(p.id).then((st) => {
        if (alive) setStates((prev) => ({ ...prev, [p.id]: st }))
      })
    }
    return () => {
      alive = false
    }
  }, [profiles])

  if (profiles.length < 2) return null

  const link = async (id: string): Promise<void> => {
    if (!window.desk) return
    const st = await window.desk.statusline.install(id)
    setStates((prev) => ({ ...prev, [id]: st }))
  }

  return (
    <>
      <div className="pop-sep" />
      <div className="pop-head">{u.usage.perAccount}</div>
      {profiles.map((p) => {
        const snap: StatusSnapshot | undefined = usageBy[p.id]
        const st = states[p.id]
        return (
          <div key={p.id} className="au-row" aria-current={p.id === shownId ? 'true' : undefined} title={p.email ?? undefined}>
            <span className="au-name">{p.name}</span>
            {snap ? (
              <>
                <Brief label="5h" w={snap.fiveHour} />
                <WeekBrief snap={snap} />
                <span className="au-age">{ago(snap.ts, u)}</span>
              </>
            ) : st === 'none' || st === 'foreign' ? (
              <button className="au-link" onClick={() => void link(p.id)} title={u.usage.linkTip}>
                {u.usage.link}
              </button>
            ) : (
              <span className="au-none">{u.usage.noRecord}</span>
            )}
          </div>
        )
      })}
      <p className="pop-note">{u.usage.perAccountNote}</p>
    </>
  )
}

/** One line of the chip: `5h ▰▰▰▰▱ 81% · 2시간 10분`. */
function Line({ row }: { row: WindowRow }) {
  const u = useUi()
  const pct = clamp(row.w)
  return (
    <span className="um-line">
      <span className="um-label">{row.short}</span>
      <Meter pct={pct} />
      <span className={`um-pct ${step(pct)}`}>{pct.toFixed(0)}%</span>
      {row.who && <span className="um-who">{row.who}</span>}
      {/* "얼마나 썼나" 만큼이나 "언제 다시 차나" 가 궁금한 숫자라, 남은 시간은 늘 붙어 있다.
          초기화 *시각* 은 title 과 팝오버에 있다. 좁은 창에서는 이 조각이 가장 먼저 접힌다. */}
      {row.w.resetsAt && <span className="um-reset">· {countdown(row.w.resetsAt, u)}</span>}
    </span>
  )
}

/** One window in words, for the tooltip and the screen reader: `5시간 사용량 81% · 18:20 초기화 (2시간 10분 남음)`. */
function describe(row: WindowRow, u: UiStrings): string {
  const pct = clamp(row.w)
  const reset = fmtReset(row.w.resetsAt)
  return `${u.usage.windowWords(row.name, pct.toFixed(0))}${reset ? u.usage.windowReset(reset, remaining(row.w.resetsAt, u)) : ''}`
}

/**
 * The gauge chip: the 5-hour window on the upper line, the weekly one on the lower, in one pill.
 * They used to be two pills side by side and were the widest thing in the bar; stacked, the pair
 * costs about half the width and the bar does not grow (two 11px lines fit inside its 44px).
 * Clicking anywhere on it opens the one detail panel with every window in it.
 */
function UsageChip({ lines, rows, ts, shownId, onRefresh, onUninstall }: { lines: WindowRow[]; rows: WindowRow[]; ts: number; shownId: string; onRefresh: () => void; onUninstall: () => void }) {
  const u = useUi()
  const label = lines.map((r) => <Line key={r.key} row={r} />)
  // the tooltip gets one line per window; the accessible name is the same words on one line
  const words = lines.map((r) => describe(r, u))
  return (
    <Popover className="pill um" label={label} title={words.join('\n')} ariaLabel={words.join(', ')} width={292} debugClick="usage">
      {(close) => (
        <div className="pop-body">
          <div className="pop-head">{u.usage.head}</div>
          {rows.map((r) => (
            <Row key={r.key} label={r.name} w={r.w} />
          ))}
          {/* the numbers are as old as the last status line or usage query; the button asks the CLI now */}
          <div className="pop-usage">
            <span>{u.usage.asOf(ago(ts, u))}</span>
            <button onClick={onRefresh} title={u.usage.refreshTip} data-debug-click="usage-refresh">
              {u.common.recheck}
            </button>
          </div>
          <AccountUsageList shownId={shownId} />
          <button
            className="pop-ghost"
            onClick={() => {
              onUninstall()
              close()
            }}
          >
            {u.usage.unlink}
          </button>
        </div>
      )}
    </Popover>
  )
}

/** 5-hour and weekly usage as one two-line gauge chip, with the one-click opt-in behind it. */
export function UsageMeters() {
  const u = useUi()
  // Rate limits belong to an account, so the gauges follow the tab in front: its account's numbers,
  // and its account's status line. With nothing open, the account new terminals would use.
  const shownId = useDesk((s) => {
    const tab = s.activeTab
    if (tab?.startsWith('ws:')) return s.workspaces.find((w) => `ws:${w.id}` === tab)?.profileId ?? s.currentProfileId
    // a session under ~/.claude counts as the account that folder is folded into, when there is one
    if (tab?.startsWith('session:')) return resolveProfileId(s.sessions[tab.slice('session:'.length)]?.info.profileId)
    return s.currentProfileId
  })
  const usage = useDesk((s) => s.usageByProfile[shownId] ?? null)
  const profiles = useDesk((s) => s.profiles)
  const [sl, setSl] = useState<SLState>('unknown')
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000) // countdown text
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let alive = true
    // the old answer stays up until the new one arrives, so switching tabs does not blink the chips
    void window.desk?.statusline.state(shownId).then((s) => {
      if (alive) setSl(s)
    })
    return () => {
      alive = false
    }
  }, [shownId])

  const install = async (): Promise<void> => {
    if (!window.desk) return
    setBusy(true)
    try {
      setSl(await window.desk.statusline.install(shownId))
    } finally {
      setBusy(false)
    }
  }
  const uninstall = async (): Promise<void> => {
    if (!window.desk) return
    setSl(await window.desk.statusline.uninstall(shownId))
  }

  if (sl === 'unknown') return null

  const many = profiles.length > 1
  const shown = profiles.find((p) => p.id === shownId)
  /** ` · 회사` after a label, once there is more than one account to be talking about */
  const who = many && shown ? ` · ${shown.name}` : ''
  /** a pill's words: they give way with an ellipsis, and the account part goes first in a narrow window (styles.css) */
  const pillLabel = (words: string) => (
    <span className="pill-text">
      {words}
      {who && <span className="pill-who">{who}</span>}
    </span>
  )

  if (sl === 'none' || sl === 'foreign') {
    return (
      <Popover className="pill" label={pillLabel(u.usage.linkPill)} title={`${u.usage.linkPill}${who}\n${u.usage.linkPillTip}`} ariaLabel={`${u.usage.linkPill}${who}`}>
        {(close) => (
          <div className="pop-body">
            <p>{rich(u.usage.linkNote(shown?.dir ? u.usage.accountFile(shown.name) : '<code>~/.claude/settings.json</code>'))}</p>
            {sl === 'foreign' && <p className="warn-line">{u.usage.foreignWarn}</p>}
            <button
              className="pop-primary"
              disabled={busy}
              onClick={() => {
                void install()
                close()
              }}
            >
              {sl === 'foreign' ? u.usage.replaceForeign : u.usage.link}
            </button>
            <AccountUsageList shownId={shownId} />
          </div>
        )}
      </Popover>
    )
  }

  // A snapshot is only as new as that account's last message. A window whose reset time has passed
  // since then is empty again, whatever the old number says — which is the normal state of an
  // account that is not the one being used right now.
  const fresh = (w: RateWindow | null): RateWindow | null => (w && w.resetsAt && w.resetsAt < Date.now() ? { usedPercentage: 0, resetsAt: null } : w)
  const five = fresh(usage?.fiveHour ?? null)
  const week = fresh(usage?.sevenDay ?? null)
  const others = Object.entries(usage?.otherWindows ?? {})

  if (!five && !week) {
    return (
      <Popover className="pill dim" label={pillLabel(u.usage.waitingPill)} title={`${u.usage.waitingPill}${who}\n${u.usage.waitingPillTip}`} ariaLabel={`${u.usage.waitingPill}${who}`}>
        {(close) => (
          <div className="pop-body">
            <p>{many ? u.usage.waitingNoteAccount : u.usage.waitingNote}</p>
            <AccountUsageList shownId={shownId} />
            <button
              className="pop-ghost"
              onClick={() => {
                void uninstall()
                close()
              }}
            >
              {u.usage.unlink}
            </button>
          </div>
        )}
      </Popover>
    )
  }

  const rows: WindowRow[] = []
  if (five) rows.push({ key: 'five', name: u.usage.fiveHourName, short: '5h', w: five })
  // The weekly windows: the all-model one, then each model's own. Fable has a weekly budget of its
  // own that can run out before the all-model one does — the usage query is what knows it
  // (src/store.ts 'usage_windows'); the status line never says.
  const weekly: WindowRow[] = []
  if (week) weekly.push({ key: 'week', name: u.usage.weekAll, short: u.usage.week, w: week })
  for (const [k, w] of others) {
    const f = fresh(w)
    if (f) weekly.push({ key: `week:${k}`, name: u.usage.weekModel(k), short: u.usage.week, who: k, w: f })
  }
  rows.push(...weekly)
  // the chip's lower line is whichever weekly window is fullest — that is the one that stops the
  // account first; the panel lists them all
  const fullest = weekly.reduce<WindowRow | null>((best, r) => (best && best.w.usedPercentage >= r.w.usedPercentage ? best : r), null)
  const lines = [...rows.filter((r) => r.key === 'five'), ...(fullest ? [fullest] : [])]

  return (
    <div className="usage">
      {/* whose numbers these are — they change with the tab once there is a second account */}
      {many && shown && (
        <span className="um-acct" title={`${u.usage.accountTip(shown.name)}${shown.email ? ` · ${shown.email}` : ''}`}>
          {shown.name}
        </span>
      )}
      <UsageChip lines={lines} rows={rows} ts={usage?.ts ?? 0} shownId={shownId} onRefresh={() => void window.desk?.usage.refresh(shownId)} onUninstall={() => void uninstall()} />
    </div>
  )
}
