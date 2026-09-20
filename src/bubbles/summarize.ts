// Bubble summaries. A hamster says the raw sentence right away; a moment later the main process
// (which runs the summarizer) may hand back a 40-character version that fits the bubble.
// Nothing here blocks the UI: a failure simply leaves the raw text in place.
import { langName } from '../i18n'

export interface BubbleAvailability {
  available: boolean
  reason: string | null
  disabledUntil: number | null
}

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
const NO_BRIDGE: BubbleAvailability = { available: false, reason: '데스크톱 앱에서만 쓸 수 있어요.', disabledUntil: null }

let cached: { state: BubbleAvailability; at: number } | null = null
let inflight: Promise<BubbleAvailability> | null = null

/** Whether the summarizer can run right now (cached; the ⋯ menu shows `reason` when it cannot). */
export async function bubbleAvailability(force = false): Promise<BubbleAvailability> {
  const now = Date.now()
  if (!force && cached && now - cached.at < STATE_TTL_MS) return cached.state
  const api = window.desk?.bubble
  if (!api) {
    cached = { state: NO_BRIDGE, at: now }
    return NO_BRIDGE
  }
  if (!inflight) {
    inflight = api
      .state()
      .then((state) => state)
      .catch((err: unknown) => ({ available: false, reason: String(err), disabledUntil: null }))
      .then((state) => {
        cached = { state, at: Date.now() }
        inflight = null
        return state
      })
  }
  return inflight
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
