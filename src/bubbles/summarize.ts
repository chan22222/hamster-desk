// Bubble summaries. A hamster says the raw sentence right away; a moment later the main process
// (which runs the summarizer) may hand back a 40-character version that fits the bubble.
// Nothing here blocks the UI: a failure simply leaves the raw text in place.
import { langName, ui } from '../i18n'
import type { BubbleStats } from '@shared/events'

export interface BubbleAvailability {
  available: boolean
  reason: string | null
  disabledUntil: number | null
  /** what the summaries have cost so far (main keeps the running total on disk) */
  stats: BubbleStats
}

const NO_STATS: BubbleStats = { calls: 0, inputTokens: 0, outputTokens: 0, costUSD: 0, since: 0 }

export interface SummaryRequest {
  /** one lane per hamster: `${sessionId}:${hid}` */
  lane: string
  kind: 'said' | 'assigned'
  /** the full sentence to shorten */
  raw: string
  /** the bubble's timestamp; handed back so a stale answer can be dropped */
  ts: number
  enabled: boolean
}

const DEBOUNCE_MS = 600
const STATE_TTL_MS = 30_000
/** no bridge, no summarizer — worded when asked, so the `⋯` menu says it in the current language */
const noBridge = (): BubbleAvailability => ({ available: false, reason: ui().common.desktopOnly, disabledUntil: null, stats: NO_STATS })

let cached: { state: BubbleAvailability; at: number } | null = null
let inflight: Promise<BubbleAvailability> | null = null

/** Whether the summarizer can run right now (cached; the ⋯ menu shows `reason` when it cannot). */
export async function bubbleAvailability(force = false): Promise<BubbleAvailability> {
  const now = Date.now()
  if (!force && cached && now - cached.at < STATE_TTL_MS) return cached.state
  const api = window.desk?.bubble
  // not cached: nothing about it can change, and the wording follows the language
  if (!api) return noBridge()
  if (!inflight) {
    inflight = api
      .state()
      .then((state) => state)
      .catch((err: unknown) => ({ available: false, reason: String(err), disabledUntil: null, stats: NO_STATS }))
      .then((state) => {
        cached = { state, at: Date.now() }
        inflight = null
        return state
      })
  }
  return inflight
}

/** Zero the usage counter and refresh the cached state, so the menu redraws with 0. */
export async function resetBubbleStats(): Promise<BubbleAvailability> {
  const api = window.desk?.bubble
  if (!api) return noBridge()
  const state = await api.resetStats()
  cached = { state, at: Date.now() }
  return state
}

function usable(s: BubbleAvailability): boolean {
  return s.available && !(s.disabledUntil !== null && s.disabledUntil > Date.now())
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Trailing debounce per hamster: only the sentence still on screen after 600 ms is summarized. */
export function requestSummary(req: SummaryRequest, onText: (ts: number, text: string) => void): void {
  if (!req.enabled || !window.desk?.bubble || !req.raw.trim()) return
  const prev = timers.get(req.lane)
  if (prev) clearTimeout(prev)
  timers.set(
    req.lane,
    setTimeout(() => {
      timers.delete(req.lane)
      void run(req, onText)
    }, DEBOUNCE_MS),
  )
}

/** Drop a pending request (the bubble was dismissed or replaced by a fixed phrase). */
export function cancelSummary(lane: string): void {
  const prev = timers.get(lane)
  if (prev) {
    clearTimeout(prev)
    timers.delete(lane)
  }
}

async function run(req: SummaryRequest, onText: (ts: number, text: string) => void): Promise<void> {
  const api = window.desk?.bubble
  if (!api) return
  if (!usable(await bubbleAvailability())) return
  try {
    const res = await api.summarize({
      key: `${req.lane}:${req.ts}`,
      lane: req.lane,
      kind: req.kind,
      text: req.raw,
      lang: langName(),
      maxChars: 40,
    })
    const text = res?.text?.trim()
    if (text) onText(req.ts, text)
    else if (res?.error) cached = null // the summarizer may have just been disabled; re-read next time
  } catch {
    cached = null
  }
}
