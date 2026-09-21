// The speech-bubble log: every row that was ever in a hamster's feed, newest first, searchable.
// The bubbles themselves last a few seconds and a new prompt wipes them; this is where "what did
// it say about that file again?" is answerable. Clicking a row points the studio camera at whoever
// said it.

import { useMemo, useState } from 'react'
import { useDesk, type SessionState } from '../store'
import './log.css'

type Filter = 'all' | 'say' | 'act'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'say', label: '말' },
  { value: 'act', label: '활동' },
]

function timeOf(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

export function FeedLog({ session }: { session: SessionState | null }) {
  const requestHamsterFocus = useDesk((s) => s.requestHamsterFocus)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const needle = q.trim().toLowerCase()
  const rows = useMemo(() => {
    const log = session?.log ?? []
    const out = log.filter((l) => (filter === 'all' || l.kind === filter) && (!needle || l.text.toLowerCase().includes(needle) || l.raw.toLowerCase().includes(needle) || l.hidName.toLowerCase().includes(needle)))
    return out.slice().reverse() // newest first, like a chat log read from the top
  }, [session?.log, filter, needle])

  if (!session) return <div className="side-empty">아직 세션이 없어요.</div>

  return (
    <>
      <div className="log-tools">
        <input className="log-search" placeholder="말풍선 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="말풍선 로그 검색" />
        <span className="seg" role="radiogroup" aria-label="종류">
          {FILTERS.map((f) => (
            <button key={f.value} className={`seg-btn ${filter === f.value ? 'is-on' : ''}`} role="radio" aria-checked={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </span>
      </div>
      {rows.length === 0 && <div className="side-empty">{session.log.length === 0 ? '아직 기록이 없어요.' : '찾는 말이 없어요.'}</div>}
      {rows.map((l, i) => {
        const gone = !session.hamsters[l.hid]
        return (
          <button
            key={l.id}
            className={`log-row kind-${l.kind} tone-${l.tone} ${gone ? 'is-gone' : ''}`}
            data-debug-click={`log-${i}`}
            title={`${l.hidName} · ${timeOf(l.ts)}\n${l.raw}${gone ? '\n(퇴근한 동료예요)' : ''}`}
            onClick={() => requestHamsterFocus(session.info.sessionId, l.hid)}
          >
            <span className="log-time">{timeOf(l.ts)}</span>
            <span className="log-who">{l.hidName}</span>
            <span className="log-text">{l.text}</span>
            {l.count > 1 && <span className="log-n">×{l.count}</span>}
          </button>
        )
      })}
    </>
  )
}
