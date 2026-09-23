// The speech-bubble log: every row that was ever in a hamster's feed, newest first, searchable.
// The bubbles themselves last a few seconds and a new prompt wipes them; this is where "what did
// it say about that file again?" is answerable.
//
// A bubble is one short line — summarized to fit over a head — so a row opens in place to show
// what was actually said or done (`raw`), in full and selectable, with who and when. Clicking a
// bubble in the studio lands here too: `revealLog` names the row, which is opened and scrolled to.
// Pointing the camera at the speaker, which a row click used to do, is a button inside the detail.
//
// A session keeps up to 500 rows, and a busy one adds a couple with every event. So only the rows
// in view are rendered (src/log/window.ts), and a row renders again only when it changes itself —
// not because a new one came in above it and every row moved one down.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LogItem } from '@shared/events'
import { useUi, type UiStrings } from '../i18n'
import { useDesk, type Hamster } from '../store'
import { debugRows, useRowWindow } from './window'
import './log.css'

type Filter = 'all' | 'say' | 'act'

/** the filter segment's rows, worded in the current language */
const filters = (u: UiStrings): { value: Filter; label: string }[] => [
  { value: 'all', label: u.feed.all },
  { value: 'say', label: u.feed.say },
  { value: 'act', label: u.feed.act },
]

function timeOf(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

/**
 * Who said it. The main hamster is named in the current language: the name a row carries was
 * worded when its session began, and the language may have changed since.
 */
const whoOf = (u: UiStrings, l: LogItem): string => (l.hid === 'main' ? u.common.mainHamster : l.hidName)

/** One row of the log, and what was said or done in full once it is opened. */
const FeedRow = memo(function FeedRow({
  l,
  u,
  open,
  gone,
  copied,
  debug,
  onToggle,
  onFocus,
  onCopy,
}: {
  l: LogItem
  u: UiStrings
  open: boolean
  /** the hamster has gone home: the row stays, as history */
  gone: boolean
  copied: boolean
  /** `log-<n>`, in a capture run only (see `debugRows`) */
  debug?: string
  onToggle: (id: string) => void
  onFocus: (hid: string) => void
  onCopy: (id: string, text: string) => void
}) {
  return (
    <div data-log-id={l.id} className={open ? 'log-item is-open' : 'log-item'}>
      <button
        className={`log-row kind-${l.kind} tone-${l.tone} ${gone ? 'is-gone' : ''}`}
        data-debug-click={debug}
        aria-expanded={open}
        title={open ? u.feed.fold : u.feed.unfoldTip}
        onClick={() => onToggle(l.id)}
      >
        <span className="log-time">{timeOf(l.ts)}</span>
        <span className="log-who">{whoOf(u, l)}</span>
        <span className="log-text">{l.text}</span>
        {l.count > 1 && <span className="log-n">×{l.count}</span>}
      </button>
      {open && (
        <div className="log-detail">
          <div className="log-meta">
            {whoOf(u, l)} · {timeOf(l.ts)} · {l.kind === 'say' ? u.feed.say : u.feed.act}
            {l.count > 1 ? u.feed.times(l.count) : ''}
            {gone ? u.feed.gone : ''}
          </div>
          <pre className="log-raw">{l.raw || l.text}</pre>
          <div className="log-actions">
            <button disabled={gone} title={gone ? u.feed.goneTip : u.feed.focusTip} onClick={() => onFocus(l.hid)}>
              {u.feed.showHamster}
            </button>
            <button onClick={() => onCopy(l.id, l.raw || l.text)}>{copied ? u.common.copied : u.common.copy}</button>
          </div>
        </div>
      )}
    </div>
  )
})

/**
 * The log of one session. It gets that session's parts rather than the session itself: the
 * session object is new with every event, the log only when a row comes or changes.
 */
export const FeedLog = memo(function FeedLog({ sessionId, log, hamsters }: { sessionId: string | null; log: readonly LogItem[]; hamsters: Record<string, Hamster> }) {
  const u = useUi()
  const requestHamsterFocus = useDesk((s) => s.requestHamsterFocus)
  const reveal = useDesk((s) => s.revealLog)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const needle = q.trim().toLowerCase()
  const rows = useMemo(() => {
    const out = log.filter((l) => (filter === 'all' || l.kind === filter) && (!needle || l.text.toLowerCase().includes(needle) || l.raw.toLowerCase().includes(needle) || whoOf(u, l).toLowerCase().includes(needle)))
    return out.reverse() // newest first, like a chat log read from the top
  }, [log, filter, needle, u])
  const keys = useMemo(() => rows.map((l) => l.id), [rows])
  const search = useRef<HTMLInputElement>(null)
  // ↑ off the first row goes back up into the search box, ↓ from the box to the first row (as in the file browser)
  const win = useRowWindow(keys, () => search.current?.focus())
  const scrollTo = win.reveal

  // a bubble was clicked: whatever is typed or filtered must not be what hides its row
  useEffect(() => {
    if (!reveal || reveal.sessionId !== sessionId) return
    setQ('')
    setFilter('all')
    setOpenId(reveal.id)
    // after the row (and the section around it, which may just have been opened) is on screen
    const t = setTimeout(() => scrollTo(reveal.id), 60)
    return () => clearTimeout(t)
  }, [reveal, sessionId, scrollTo])

  const toggle = useCallback((id: string) => setOpenId((o) => (o === id ? null : id)), [])
  const focus = useCallback(
    (hid: string): void => {
      if (sessionId) requestHamsterFocus(sessionId, hid)
    },
    [requestHamsterFocus, sessionId],
  )
  const copy = useCallback((id: string, text: string): void => {
    window.desk?.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200)
  }, [])

  if (!sessionId) return <div className="side-empty">{u.feed.noSession}</div>

  const named = debugRows()
  return (
    <div>
      <div className="log-tools">
        <input
          ref={search}
          className="log-search"
          placeholder={u.feed.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' || rows.length === 0) return
            e.preventDefault()
            win.focusRow(0)
          }}
          aria-label={u.feed.searchLabel}
        />
        <span className="seg" role="radiogroup" aria-label={u.feed.kind}>
          {filters(u).map((f) => (
            <button key={f.value} className={`seg-btn ${filter === f.value ? 'is-on' : ''}`} role="radio" aria-checked={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </span>
      </div>
      {rows.length === 0 && <div className="side-empty">{log.length === 0 ? u.feed.noLog : u.feed.noMatch}</div>}
      <div className="rows-gap" style={{ height: win.before }} />
      <div ref={win.ref} className="log-rows">
        {rows.slice(win.start, win.end).map((l, k) => (
          <FeedRow
            key={l.id}
            l={l}
            u={u}
            open={openId === l.id}
            gone={!hamsters[l.hid]}
            copied={copied === l.id}
            debug={named ? `log-${win.start + k}` : undefined}
            onToggle={toggle}
            onFocus={focus}
            onCopy={copy}
          />
        ))}
      </div>
      <div className="rows-gap" style={{ height: win.after }} />
    </div>
  )
})
