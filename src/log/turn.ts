// What one finished turn came to. Pure: no store, no React, no clock of its own — the store hands
// it the session it already has and the `turn_end` that just arrived, so the unit test can too.
//
// Deliberately structural rather than `SessionState`: importing the store here would close the
// circle (the store calls `summarizeTurn`), and the three fields below are all this needs.

import type { TurnSummary } from '@shared/events'

/** the slice of a session a turn summary is made of */
export interface TurnSource {
  edits: readonly { ts: number; file: string; added: number; removed: number }[]
  /** when the turn's prompt arrived; null when the turn started before we were watching */
  turnStartedAt: number | null
  /** the last thing the main hamster said this turn, raw */
  lastSaid: string
}

/** the `turn_end` fields that matter here */
export interface TurnEnd {
  durationMs?: number
  ts: number
}

/** how much of the last sentence the card carries */
const SAID_MAX = 60

/**
 * `130000 → '2분 10초'`, `45000 → '45초'`, `3780000 → '1시간 3분'`.
 *
 * One unit below an hour, two above nothing: "1시간 3분 20초" is a stopwatch reading, and what the
 * card is for is "about how long did that take".
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}초`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) {
    const rest = total % 60
    return rest ? `${minutes}분 ${rest}초` : `${minutes}분`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`
}

/** Collapse whitespace and cut to `max`, the way the feed trims a sentence. */
function trim(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

/**
 * Everything that happened since the turn's prompt: how many distinct files were touched, the
 * line totals, how long it took and the last thing that was said.
 *
 * Only edits at or after `turnStartedAt` count — the session's `edits` list is the whole
 * conversation's, and a card that claimed forty files for a one-line fix would be worse than none.
 * `durationMs` comes off the event (the CLI measures the turn properly, including its own start-up)
 * and is only computed from the timestamps when the event does not carry it.
 */
export function summarizeTurn(session: TurnSource, e: TurnEnd): TurnSummary {
  const from = session.turnStartedAt
  const edits = from === null ? [] : session.edits.filter((x) => x.ts >= from)
  const files = new Set(edits.map((x) => x.file)).size
  let added = 0
  let removed = 0
  for (const x of edits) {
    added += x.added
    removed += x.removed
  }
  const durationMs = e.durationMs || (from === null ? 0 : Math.max(0, e.ts - from))
  return { files, added, removed, durationMs, said: trim(session.lastSaid, SAID_MAX), at: e.ts }
}
