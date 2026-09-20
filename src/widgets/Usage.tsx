import { useEffect, useState } from 'react'
import type { RateWindow } from '@shared/events'
import { useDesk } from '../store'
import { Popover } from './Popover'

type SLState = 'installed' | 'foreign' | 'none' | 'unknown'

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

const tone = (pct: number): string => (pct >= 90 ? 'hot' : pct >= 70 ? 'warm' : '')
const clamp = (w: RateWindow): number => Math.max(0, Math.min(100, w.usedPercentage))

function Row({ label, w }: { label: string; w: RateWindow | null }) {
  if (!w) return null
  const pct = clamp(w)
  return (
    <div className="u-row">
      <span className="u-name">{label}</span>
      <span className={`u-track ${tone(pct)}`}>
        <span className="u-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="u-pct">{pct.toFixed(0)}%</span>
      <span className="u-when dim">
        {fmtReset(w.resetsAt)} 초기화{w.resetsAt ? ` · ${remaining(w.resetsAt)} 남음` : ''}
      </span>
    </div>
  )
}

/** 5-hour / weekly usage from the status-line snapshots, with the one-click opt-in behind it. */
export function UsagePill() {
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

  const fivePct = five ? clamp(five) : 0
  const label = (
    <>
      {five && (
        <span className={`u-mini ${tone(fivePct)}`}>
          <i style={{ width: `${fivePct}%` }} />
        </span>
      )}
      <span>
        {five ? `5h ${fivePct.toFixed(0)}%` : ''}
        {five && week ? ' · ' : ''}
        {week ? `주 ${clamp(week).toFixed(0)}%` : ''}
      </span>
    </>
  )

  return (
    <Popover className="pill" label={label} title="사용량 자세히 보기">
      {(close) => (
        <div className="pop-body">
          <Row label="5시간" w={five} />
          <Row label="주간" w={week} />
          {others.map(([k, w]) => (
            <Row key={k} label={k} w={w} />
          ))}
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
