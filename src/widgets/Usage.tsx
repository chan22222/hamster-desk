import { useEffect, useState } from 'react'
import { DEFAULT_PROFILE_ID, type RateWindow, type StatusSnapshot } from '@shared/events'
import { useDesk } from '../store'
import { Popover } from './Popover'
import '../accounts/accounts.css'

type SLState = 'installed' | 'foreign' | 'none' | 'unknown'
/** which window a chip stands for; the popover shows them all and highlights this one */
type Which = string

function fmtReset(ms: number | null): string {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date()
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === now.toDateString()) return hh
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}`
}

function remaining(ms: number | null): string {
  if (!ms) return ''
  const diff = ms - Date.now()
  if (diff <= 0) return '곧'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (h >= 24) return `${Math.floor(h / 24)}일 ${h % 24}시간`
  return h ? `${h}시간 ${m}분` : `${m}분`
}

/** The chip version: one unit past a day, two below it — it has to fit next to the percentage. */
function countdown(ms: number | null): string {
  if (!ms) return ''
  const diff = ms - Date.now()
  if (diff <= 0) return '곧'
  const h = Math.floor(diff / 3600000)
  if (h >= 24) return `${Math.floor(h / 24)}일`
  const m = Math.floor((diff % 3600000) / 60000)
  return h ? `${h}시간 ${m}분` : `${m}분`
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

function Row({ label, w, current }: { label: string; w: RateWindow | null; current: boolean }) {
  if (!w) return null
  const pct = clamp(w)
  return (
    <div className="u-row" aria-current={current ? 'true' : undefined}>
      <span className="u-name">{label}</span>
      <span className={`u-track ${step(pct)}`}>
        <span className="u-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="u-pct">{pct.toFixed(0)}%</span>
      <span className="u-when">
        {fmtReset(w.resetsAt)} 초기화{w.resetsAt ? ` · ${remaining(w.resetsAt)} 남음` : ''}
      </span>
    </div>
  )
}

interface WindowRow {
  key: Which
  /** the long name, for the popover */
  name: string
  /** the short name, for the chip */
  short: string
  w: RateWindow
}

/** `3분 전` — how old a snapshot is. An account nobody is using right now keeps its last numbers. */
function ago(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`
}

/** `5h 81%`; a window whose reset time has passed since the snapshot is simply empty again. */
function Brief({ label, w }: { label: string; w: RateWindow | null }) {
  if (!w) return null
  if (w.resetsAt && w.resetsAt < Date.now()) return <span className="au-num">{label} 초기화됨</span>
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
  const u = useDesk((s) => s.usageByProfile[profileId])
  if (!u || (!u.fiveHour && !u.sevenDay)) return null
  return (
    <span className="au-line">
      <Brief label="5h" w={u.fiveHour} />
      <Brief label="주" w={u.sevenDay} />
      <span className="au-age">{ago(u.ts)}</span>
    </span>
  )
}

/**
 * Every account's last known numbers, under the detail of the one on screen. Rate limits belong
 * to whoever is logged in, and the CLI only reports them while that account is talking — so each
 * row also says how old it is. Nothing while there is only one account.
 */
function AccountUsageList({ shownId }: { shownId: string }) {
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
      <div className="pop-head">계정별 사용량</div>
      {profiles.map((p) => {
        const u: StatusSnapshot | undefined = usageBy[p.id]
        const st = states[p.id]
        return (
          <div key={p.id} className="au-row" aria-current={p.id === shownId ? 'true' : undefined} title={p.email ?? undefined}>
            <span className="au-name">{p.name}</span>
            {u ? (
              <>
                <Brief label="5h" w={u.fiveHour} />
                <Brief label="주" w={u.sevenDay} />
                <span className="au-age">{ago(u.ts)}</span>
              </>
            ) : st === 'none' || st === 'foreign' ? (
              <button className="au-link" onClick={() => void link(p.id)} title="이 계정의 settings.json 에 상태줄을 추가합니다">
                연동하기
              </button>
            ) : (
              <span className="au-none">아직 기록 없음</span>
            )}
          </div>
        )
      })}
      <p className="pop-note">사용량은 그 계정으로 Claude 를 쓰는 동안에만 갱신돼요.</p>
    </>
  )
}

/** One gauge. Clicking it opens the same detail panel, scrolled to this window. */
function Chip({ row, rows, extra, shownId, onUninstall }: { row: WindowRow; rows: WindowRow[]; extra: string; shownId: string; onUninstall: () => void }) {
  const pct = clamp(row.w)
  const reset = fmtReset(row.w.resetsAt)
  const title = `${row.name} 사용량 ${pct.toFixed(0)}%${reset ? ` · ${reset} 초기화 (${remaining(row.w.resetsAt)} 남음)` : ''}`
  const label = (
    <>
      <span className="um-label">{row.short}</span>
      <Meter pct={pct} />
      <span className={`um-pct ${step(pct)}`}>{pct.toFixed(0)}%</span>
      {/* "얼마나 썼나" 만큼이나 "언제 다시 차나" 가 궁금한 숫자라, 남은 시간은 늘 붙어 있다.
          초기화 *시각* 은 title 과 팝오버에 있다. 좁은 창에서는 이 조각이 가장 먼저 접힌다. */}
      {row.w.resetsAt && <span className="um-reset">· {countdown(row.w.resetsAt)}</span>}
    </>
  )
  return (
    <Popover className={`pill um ${extra}`} label={label} title={title} ariaLabel={title} width={252}>
      {(close) => (
        <div className="pop-body">
          <div className="pop-head">사용량</div>
          {rows.map((r) => (
            <Row key={r.key} label={r.name} w={r.w} current={r.key === row.key} />
          ))}
          <AccountUsageList shownId={shownId} />
          <button
            className="pop-ghost"
            onClick={() => {
              onUninstall()
              close()
            }}
          >
            연동 해제
          </button>
        </div>
      )}
    </Popover>
  )
}

/** 5-hour and weekly usage as two separate gauges, with the one-click opt-in behind them. */
export function UsageMeters() {
  // Rate limits belong to an account, so the gauges follow the tab in front: its account's numbers,
  // and its account's status line. With nothing open, the account new terminals would use.
  const shownId = useDesk((s) => {
    const tab = s.activeTab
    if (tab?.startsWith('ws:')) return s.workspaces.find((w) => `ws:${w.id}` === tab)?.profileId ?? s.currentProfileId
    if (tab?.startsWith('session:')) return s.sessions[tab.slice('session:'.length)]?.info.profileId ?? DEFAULT_PROFILE_ID
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

  if (sl === 'none' || sl === 'foreign') {
    return (
      <Popover className="pill" label={`사용량 연동${who}`} title="5시간·주간 사용량을 상단에 표시합니다">
        {(close) => (
          <div className="pop-body">
            <p>
              5시간·주간 사용량과 초기화 시각을 여기에 보여 드려요. {shown?.dir ? <>이 계정(<b>{shown.name}</b>)의 <code>settings.json</code></> : <code>~/.claude/settings.json</code>} 에 상태줄 한 줄을 추가하면, Claude Code 가
              대화가 갱신될 때마다 작은 스크립트를 비동기로 실행해 사용량을 파일로 남깁니다(응답 속도에는 영향이 없어요).
            </p>
            {sl === 'foreign' && <p className="warn-line">이미 다른 상태줄이 설정돼 있어요. 기존 설정은 보관했다가 연동을 해제할 때 되돌립니다.</p>}
            <button
              className="pop-primary"
              disabled={busy}
              onClick={() => {
                void install()
                close()
              }}
            >
              {sl === 'foreign' ? '기존 상태줄 교체하기' : '연동하기'}
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
      <Popover className="pill dim" label={`사용량 대기 중${who}`} title="새 세션에서 첫 메시지를 보내면 표시됩니다">
        {(close) => (
          <div className="pop-body">
            <p>연동은 끝났어요. {many ? '이 계정으로 ' : ''}새 세션에서 첫 메시지를 보내면 사용량이 나타납니다.</p>
            <AccountUsageList shownId={shownId} />
            <button
              className="pop-ghost"
              onClick={() => {
                void uninstall()
                close()
              }}
            >
              연동 해제
            </button>
          </div>
        )}
      </Popover>
    )
  }

  const rows: WindowRow[] = []
  if (five) rows.push({ key: 'five', name: '5시간', short: '5h', w: five })
  if (week) rows.push({ key: 'week', name: '주간', short: '주', w: week })
  for (const [k, w] of others) rows.push({ key: `other:${k}`, name: k, short: k, w })

  const fiveRow = rows.find((r) => r.key === 'five')
  const weekRow = rows.find((r) => r.key === 'week')

  return (
    <div className="usage">
      {/* whose numbers these are — they change with the tab once there is a second account */}
      {many && shown && (
        <span className="um-acct" title={`${shown.name} 계정의 사용량${shown.email ? ` · ${shown.email}` : ''}`}>
          {shown.name}
        </span>
      )}
      {fiveRow && <Chip row={fiveRow} rows={rows} extra="um-5h" shownId={shownId} onUninstall={() => void uninstall()} />}
      {fiveRow && weekRow && <span className="bar-sep" />}
      {weekRow && <Chip row={weekRow} rows={rows} extra="um-week" shownId={shownId} onUninstall={() => void uninstall()} />}
    </div>
  )
}
