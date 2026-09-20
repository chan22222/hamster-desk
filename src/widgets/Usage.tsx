import { useEffect, useState } from 'react'
import type { RateWindow } from '@shared/events'
import { useDesk } from '../store'
import { Popover } from './Popover'

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

/** three steps, and the same class goes on the percentage — colour is never the only cue */
const step = (pct: number): string => (pct >= 90 ? 'is-hot' : pct >= 70 ? 'is-warm' : 'is-ok')
const clamp = (w: RateWindow): number => Math.max(0, Math.min(100, w.usedPercentage))

const SEGMENTS = [0, 1, 2, 3, 4]

/** Five blocks, one per 20 %. Redundant with the number next to it — that is the point. */
function Meter({ pct }: { pct: number }) {
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

/** One gauge. Clicking it opens the same detail panel, scrolled to this window. */
function Chip({ row, rows, extra, onUninstall }: { row: WindowRow; rows: WindowRow[]; extra: string; onUninstall: () => void }) {
  const pct = clamp(row.w)
  const reset = fmtReset(row.w.resetsAt)
  const title = `${row.name} 사용량 ${pct.toFixed(0)}%${reset ? ` · ${reset} 초기화 (${remaining(row.w.resetsAt)} 남음)` : ''}`
  const label = (
    <>
      <span className="um-label">{row.short}</span>
      <Meter pct={pct} />
      <span className={`um-pct ${step(pct)}`}>{pct.toFixed(0)}%</span>
      {/* only when it is nearly spent is the reset time worth the width */}
      {pct >= 90 && reset && <span className="um-reset">{reset}</span>}
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
  const usage = useDesk((s) => s.usage)
  const [sl, setSl] = useState<SLState>('unknown')
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    void window.desk?.statusline.state().then((s) => setSl(s))
    const t = setInterval(() => tick((n) => n + 1), 30000) // countdown text
    return () => clearInterval(t)
  }, [])

  const install = async (): Promise<void> => {
    if (!window.desk) return
    setBusy(true)
    try {
      setSl(await window.desk.statusline.install())
    } finally {
      setBusy(false)
    }
  }
  const uninstall = async (): Promise<void> => {
    if (!window.desk) return
    setSl(await window.desk.statusline.uninstall())
  }

  if (sl === 'unknown') return null

  if (sl === 'none' || sl === 'foreign') {
    return (
      <Popover className="pill" label="사용량 연동" title="5시간·주간 사용량을 상단에 표시합니다">
        {(close) => (
          <div className="pop-body">
            <p>
              5시간·주간 사용량과 초기화 시각을 여기에 보여 드려요. <code>~/.claude/settings.json</code> 에 상태줄 한 줄을 추가하면, Claude Code 가 대화가 갱신될 때마다 작은 스크립트를 비동기로 실행해 사용량을
              파일로 남깁니다(응답 속도에는 영향이 없어요).
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
          </div>
        )}
      </Popover>
    )
  }

  const five = usage?.fiveHour ?? null
  const week = usage?.sevenDay ?? null
  const others = Object.entries(usage?.otherWindows ?? {})

  if (!five && !week) {
    return (
      <Popover className="pill dim" label="사용량 대기 중" title="새 세션에서 첫 메시지를 보내면 표시됩니다">
        {(close) => (
          <div className="pop-body">
            <p>연동은 끝났어요. 새 세션에서 첫 메시지를 보내면 사용량이 나타납니다.</p>
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
      {fiveRow && <Chip row={fiveRow} rows={rows} extra="um-5h" onUninstall={() => void uninstall()} />}
      {fiveRow && weekRow && <span className="bar-sep" />}
      {weekRow && <Chip row={weekRow} rows={rows} extra="um-week" onUninstall={() => void uninstall()} />}
    </div>
  )
}
