// The `지난 대화` popover: every conversation Claude Code has had in this folder, newest first,
// and one click to carry one on in a new terminal — plan §3.4. Owner: B.
//
// The rows come straight from the transcript files (electron/transcripts.ts); nothing here talks to
// `~/.claude/history.jsonl`, which the README promises never to read.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TranscriptEntry } from '@shared/events'
import { useDesk } from '../store'
import { relTime } from '../sidebar/recent'
import { termLog } from '../term/search'
import { IconBranch, IconSearch } from '../widgets/icons'
import './session.css'

const EMPTY = '이 폴더의 대화 기록이 없어요.'
const LIVE = '이미 실행 중인 대화예요.'

/** the tallest the list gets, and the least it is squeezed to */
const LIST_MAX = 320
const LIST_MIN = 80
/** what sits under the list inside the panel: the gap, the `--continue` row, the panel's padding and border, and a margin to the window edge */
const BELOW_LIST = 6 + 32 + 8 + 1 + 12

/**
 * The subtitle says nothing the title has not: a conversation that is one prompt long has that
 * prompt as both. A long prompt is cut twice (60 characters for the title, ending in `…`, and 120
 * for the subtitle), so a clipped title that the subtitle merely continues counts as the same —
 * in a row this narrow the two lines would read identically. A short title of its own ("fix")
 * above a subtitle that happens to start with it does not.
 */
function sameText(subtitle: string, title: string): boolean {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const t = norm(title)
  const s = norm(subtitle)
  if (s === t) return true
  return t.length > 1 && t.endsWith('…') && s.startsWith(t.slice(0, -1).trimEnd())
}

export function TranscriptList({ cwd, onPick }: { cwd: string; onPick: () => void }) {
  const addWorkspace = useDesk((s) => s.addWorkspace)
  const [rows, setRows] = useState<TranscriptEntry[] | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    if (!window.desk) {
      setRows([])
      return
    }
    void window.desk.transcripts
      .list(cwd)
      .then((r) => {
        if (alive) setRows(r)
      })
      .catch(() => {
        if (alive) setRows([])
      })
    return () => {
      alive = false
    }
  }, [cwd])

  // `Popover` opens under its trigger and never flips upward, and this trigger sits in the middle of
  // the window with the studio above it. So the list takes exactly the height that is left, and the
  // `--continue` row under it stays on screen. Measured a frame late: the panel is positioned by the
  // popover's own layout effect, which runs after this one. (A resize closes the popover, so there
  // is nothing to follow.)
  const listRef = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<number | null>(null)
  const loaded = rows !== null
  const searchable = (rows?.length ?? 0) > 2
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = listRef.current
      if (!el) return
      const left = Math.floor(window.innerHeight - el.getBoundingClientRect().top - BELOW_LIST)
      setRoom(Math.max(LIST_MIN, Math.min(LIST_MAX, left)))
    })
    return () => cancelAnimationFrame(id)
  }, [loaded, searchable])

  const q = filter.trim().toLowerCase()
  const shown = q && rows ? rows.filter((r) => r.title.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q)) : rows

  /** Carry a conversation on in a terminal of its own; the shell types the command itself. */
  const resume = (e: TranscriptEntry): void => {
    if (e.live) return
    termLog(`[history] resume ${e.sessionId}`)
    addWorkspace(cwd, e.title, `claude --resume ${e.sessionId}`)
    onPick()
  }

  const continueLast = (): void => {
    addWorkspace(cwd, '이어서', 'claude --continue')
    onPick()
  }

  return (
    <div className="pop-body tl">
      {rows && rows.length > 2 && (
        <div className="side-search tl-search">
          <IconSearch size={14} />
          <input className="side-filter" placeholder="지난 대화 검색" value={filter} onChange={(ev) => setFilter(ev.target.value)} aria-label="지난 대화 검색" />
        </div>
      )}
      <div ref={listRef} className="tl-list" style={room === null ? undefined : { maxHeight: room }}>
        {rows === null && <p className="pop-note">불러오는 중…</p>}
        {rows !== null && rows.length === 0 && <p className="pop-note">{EMPTY}</p>}
        {rows !== null && rows.length > 0 && shown && shown.length === 0 && <p className="pop-note">검색 결과가 없어요.</p>}
        {(shown ?? []).map((e, i) => (
          <button
            key={e.sessionId}
            className={`tl-row ${e.live ? 'is-live' : ''}`}
            data-debug-click={`history-${i}`}
            disabled={e.live}
            title={e.live ? LIVE : `${e.title}\n${e.path}\n클릭: 새 터미널에서 이어서`}
            onClick={() => resume(e)}
          >
            <span className="tl-title">{e.title}</span>
            {/* a conversation that is one prompt long has that prompt as both; saying it twice is noise */}
            {e.subtitle && !sameText(e.subtitle, e.title) && <span className="tl-sub">{e.subtitle}</span>}
            <span className="tl-meta">
              <span>{relTime(e.lastAt)}</span>
              {e.branch && (
                <span className="tl-branch">
                  <IconBranch size={11} />
                  {e.branch}
                </span>
              )}
              {e.live && <span className="tl-live">실행 중</span>}
            </span>
          </button>
        ))}
      </div>
      <button className="pop-ghost" data-debug-click="history-continue" onClick={continueLast} title="claude --continue">
        이 폴더의 마지막 대화 이어서 (--continue)
      </button>
    </div>
  )
}
