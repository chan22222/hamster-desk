// The `지난 대화` popover: every conversation Claude Code has had in this folder, newest first,
// and one click to carry one on in a new terminal — plan §3.4. Owner: B.
//
// The rows come straight from the transcript files (electron/transcripts.ts); nothing here talks to
// `~/.claude/history.jsonl`, which docs/architecture.md ("읽기만 한다") promises never to read.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TranscriptEntry } from '@shared/events'
import { useUi } from '../i18n'
import { useDesk } from '../store'
import { relTime } from '../sidebar/recent'
import { termLog } from '../term/search'
import { IconBranch, IconSearch } from '../widgets/icons'
import { listStep } from '../widgets/focus'
import './session.css'

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

/**
 * `profileId`: each account keeps its own conversations, and a resumed one has to open under the
 * same account. `run`, when given, types the command into a terminal of the caller's choosing (the
 * studio's welcome card: the idle shell under it) instead of opening a new tab for it.
 */
export function TranscriptList({ cwd, profileId, onPick, run }: { cwd: string; profileId: string; onPick: () => void; run?: (cmd: string) => void }) {
  // every word comes from the dictionary at render time, so a language change applies to the open list
  const u = useUi()
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
      .list(cwd, profileId)
      .then((r) => {
        if (alive) setRows(r)
      })
      .catch(() => {
        if (alive) setRows([])
      })
    return () => {
      alive = false
    }
  }, [cwd, profileId])

  // `Popover` opens under its trigger and never flips upward, and this trigger sits in the middle of
  // the window with the studio above it. So the list takes exactly the height that is left, and the
  // `--continue` row under it stays on screen. Measured a frame late: the panel is positioned by the
  // popover's own layout effect, which runs after this one. (A resize closes the popover, so there
  // is nothing to follow.)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
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

  /** ↑ ↓ Home End between the rows; ↑ off the first one goes back to the search box */
  const onRowKey = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const list = listRef.current
    if (!list) return
    const all = [...list.querySelectorAll<HTMLButtonElement>('.tl-row:not(:disabled)')]
    const j = listStep(e.key, all.indexOf(e.currentTarget), all.length)
    if (j === null) return
    e.preventDefault()
    if (j < 0) searchRef.current?.focus()
    else all[j].focus()
  }

  /** Carry a conversation on: in the caller's terminal, or in a new one that types the command itself. */
  const resume = (e: TranscriptEntry): void => {
    if (e.live) return
    termLog(`[history] resume ${e.sessionId}`)
    const cmd = `claude --resume ${e.sessionId}`
    if (run) run(cmd)
    else addWorkspace(cwd, e.title, cmd, profileId)
    onPick()
  }

  const continueLast = (): void => {
    if (run) run('claude --continue')
    else addWorkspace(cwd, u.tabs.continueTab, 'claude --continue', profileId)
    onPick()
  }
  const where = run ? u.history.inThisTerminal : u.history.inNewTerminal

  return (
    <div className="pop-body tl">
      {rows && rows.length > 2 && (
        <div className="side-search tl-search">
          <IconSearch size={14} />
          {/* Enter carries on the first match, ↓ goes down into the list */}
          <input
            ref={searchRef}
            className="side-filter"
            placeholder={u.history.search}
            value={filter}
            onChange={(ev) => setFilter(ev.target.value)}
            aria-label={u.history.search}
            onKeyDown={(ev) => {
              const first = (shown ?? []).find((r) => !r.live)
              if (ev.key === 'Enter' && first) {
                ev.preventDefault()
                resume(first)
              } else if (ev.key === 'ArrowDown') {
                ev.preventDefault()
                listRef.current?.querySelector<HTMLButtonElement>('.tl-row:not(:disabled)')?.focus()
              }
            }}
          />
        </div>
      )}
      <div ref={listRef} className="tl-list" style={room === null ? undefined : { maxHeight: room }}>
        {rows === null && <p className="pop-note">{u.common.loading}</p>}
        {rows !== null && rows.length === 0 && <p className="pop-note">{u.history.empty}</p>}
        {rows !== null && rows.length > 0 && shown && shown.length === 0 && <p className="pop-note">{u.common.noResults}</p>}
        {(shown ?? []).map((e, i) => (
          <button
            key={e.sessionId}
            className={`tl-row ${e.live ? 'is-live' : ''}`}
            data-debug-click={`history-${i}`}
            disabled={e.live}
            title={e.live ? u.history.live : u.history.rowTip(e.title, e.path, where)}
            onClick={() => resume(e)}
            onKeyDown={onRowKey}
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
              {e.live && <span className="tl-live">{u.history.running}</span>}
            </span>
          </button>
        ))}
      </div>
      <button className="pop-ghost" data-debug-click="history-continue" onClick={continueLast} title="claude --continue">
        {u.history.continueLast}
      </button>
    </div>
  )
}
