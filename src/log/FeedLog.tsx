// The speech-bubble log: every row that was ever in a hamster's feed, newest first, searchable.
// The bubbles themselves last a few seconds and a new prompt wipes them; this is where "what did
// it say about that file again?" is answerable.
//
// A bubble is one short line — summarized to fit over a head — so a row opens in place to show
// what was actually said or done (`raw`), in full and selectable, with who and when. Clicking a
// bubble in the studio lands here too: `revealLog` names the row, which is opened and scrolled to.
// Pointing the camera at the speaker, which a row click used to do, is a button inside the detail.

import { useEffect, useMemo, useRef, useState } from 'react'
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
  const reveal = useDesk((s) => s.revealLog)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const sessionId = session?.info.sessionId

  const needle = q.trim().toLowerCase()
  const rows = useMemo(() => {
    const log = session?.log ?? []
    const out = log.filter((l) => (filter === 'all' || l.kind === filter) && (!needle || l.text.toLowerCase().includes(needle) || l.raw.toLowerCase().includes(needle) || l.hidName.toLowerCase().includes(needle)))
    return out.slice().reverse() // newest first, like a chat log read from the top
  }, [session?.log, filter, needle])

  // a bubble was clicked: whatever is typed or filtered must not be what hides its row
  useEffect(() => {
    if (!reveal || reveal.sessionId !== sessionId) return
    setQ('')
    setFilter('all')
    setOpenId(reveal.id)
    // after the row (and the section around it, which may just have been opened) is on screen
    const t = setTimeout(() => list.current?.querySelector(`[data-log-id="${CSS.escape(reveal.id)}"]`)?.scrollIntoView({ block: 'nearest' }), 60)
    return () => clearTimeout(t)
  }, [reveal, sessionId])

  if (!session) return <div className="side-empty">아직 세션이 없어요.</div>

  const copy = (id: string, text: string): void => {
    window.desk?.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200)
  }

  return (
    <div ref={list}>
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
        const open = openId === l.id
        return (
          <div key={l.id} data-log-id={l.id} className={open ? 'log-item is-open' : 'log-item'}>
            <button
              className={`log-row kind-${l.kind} tone-${l.tone} ${gone ? 'is-gone' : ''}`}
              data-debug-click={`log-${i}`}
              aria-expanded={open}
              title={open ? '접기' : '클릭: 자세히 보기'}
              onClick={() => setOpenId(open ? null : l.id)}
            >
              <span className="log-time">{timeOf(l.ts)}</span>
              <span className="log-who">{l.hidName}</span>
              <span className="log-text">{l.text}</span>
              {l.count > 1 && <span className="log-n">×{l.count}</span>}
            </button>
            {open && (
              <div className="log-detail">
                <div className="log-meta">
                  {l.hidName} · {timeOf(l.ts)} · {l.kind === 'say' ? '말' : '활동'}
                  {l.count > 1 ? ` · ${l.count}번` : ''}
                  {gone ? ' · 퇴근한 동료' : ''}
                </div>
                <pre className="log-raw">{l.raw || l.text}</pre>
                <div className="log-actions">
                  <button disabled={gone} title={gone ? '이미 퇴근한 동료예요' : '스튜디오 카메라를 이 햄스터에게'} onClick={() => requestHamsterFocus(session.info.sessionId, l.hid)}>
                    햄스터 보기
                  </button>
                  <button onClick={() => copy(l.id, l.raw || l.text)}>{copied === l.id ? '복사됨' : '복사'}</button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
