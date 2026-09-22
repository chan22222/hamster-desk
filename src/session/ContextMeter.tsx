// How much of the context window this session has used — plan §3.2. Owner: B.
//
// The number already arrives: the status-line script writes `contextUsedPct` into every snapshot
// and nothing has ever read it. It shows up twice, at two sizes: a bare percentage riding along in
// the tab label, and the full meter in the session bar. Both take their colour from the same
// `step()` the usage chips use, so 70 % and 90 % mean the same thing everywhere in the window.

import { useEffect, useState } from 'react'
import { t, useUi } from '../i18n'
import type { SessionState } from '../store'
import { Meter, step } from '../widgets/Usage'
import './session.css'

/** how long the meter says `정리 중…` after a compact boundary goes by */
const COMPACT_MS = 8000

/** The percentage this session has used, or null when the status line is not wired up. */
export function contextPct(session: SessionState | null): number | null {
  const v = session?.status?.contextUsedPct
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.max(0, Math.min(100, v))
}

/** `200000` → `200k`; the window size is a round number and the exact digits help nobody. */
function windowSize(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return ''
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n))
}

/**
 * True while a compaction is going on.
 *
 * `compact` is not kept in the store (that side of it belongs to another agent's file), but it does
 * reach the main hamster's feed as the one fixed phrase `t().compacting`, with a `born` stamp. That
 * row is the signal, and it is the only one the renderer gets.
 */
function useCompacting(session: SessionState | null): boolean {
  const feed = session?.hamsters.main?.feed
  const [until, setUntil] = useState(0)
  const [, tick] = useState(0)

  useEffect(() => {
    if (!feed) return
    const row = feed.find((f) => f.raw === t().compacting)
    if (!row) return
    setUntil((u) => (row.born + COMPACT_MS > u ? row.born + COMPACT_MS : u))
  }, [feed])

  useEffect(() => {
    const left = until - Date.now()
    if (left <= 0) return
    const id = setTimeout(() => tick((n) => n + 1), left + 50)
    return () => clearTimeout(id)
  }, [until])

  return until > Date.now()
}

/** The percentage that rides along in the tab label. External sessions get it too — it is read-only. */
export function TabContext({ session }: { session: SessionState | null }) {
  const u = useUi()
  const pct = contextPct(session)
  if (pct === null) return null
  const n = Math.round(pct)
  return (
    <span className={`tab-ctx ${step(pct)}`} title={u.session.contextUsed(n) + (pct >= 90 ? u.session.contextSoon : '')}>
      {n}%
    </span>
  )
}

/** The wider meter the session bar shows. Nothing is drawn when there is no snapshot to draw. */
export function ContextMeter({ session }: { session: SessionState | null }) {
  const u = useUi()
  const pct = contextPct(session)
  const compacting = useCompacting(session)
  if (pct === null) return null
  const n = Math.round(pct)
  const size = windowSize(session?.status?.contextSize)
  return (
    <span className="sb-ctx" title={u.session.contextUsed(n) + (size ? u.session.contextWindow(size) : '')}>
      <Meter pct={pct} />
      <span className={`sb-ctx-pct ${step(pct)}`}>{n}%</span>
      {size && <span className="sb-ctx-size">· {size}</span>}
      {compacting && <span className="sb-ctx-busy">{u.session.compacting}</span>}
    </span>
  )
}
