// ---- prompt detection on the terminal stream (heuristic; the transcript never records a permission prompt)
// The full-screen TUI positions every word with cursor moves, so after stripping escapes the spaces are gone.
// We therefore compare with all whitespace removed on both sides.
//
// Free of node-pty (unlike pty.ts, which re-exports this), so scripts/unit can feed it real screens.

const ESC = String.fromCharCode(27)
const ANSI = new RegExp(
  [
    // CSI; the parameter bytes are all of 0x30–0x3F — `ESC[>0q` / `ESC[>4m` (what CLI 2.1.x sends
    // around every prompt) have to go too, or they sit between the words a pattern looks for
    `${ESC}\\[[0-?]*[ -/]*[@-~]`,
    `${ESC}\\][^${ESC}\\u0007]*(?:\\u0007|${ESC}\\\\)`, // OSC ... BEL | ST
    `${ESC}[PX^_][^${ESC}]*${ESC}\\\\`, // DCS / SOS / PM / APC ... ST
    `${ESC}[@-Z\\\\-_]`, // 2-byte escapes
    `\\u009b[0-?]*[ -/]*[@-~]`, // 8-bit CSI
  ].join('|'),
  'g',
)

export function stripTerminal(s: string): string {
  return s.replace(ANSI, '').replace(/\s+/g, '')
}

const squash = (s: string): string => s.replace(/\s+/g, '')

export type WaitReason = 'permission' | 'question'
const RAW_PATTERNS: { text: string; reason: WaitReason }[] = [
  { text: 'Do you want to proceed', reason: 'permission' },
  { text: 'Do you want to make this edit', reason: 'permission' },
  { text: 'Do you want to create', reason: 'permission' },
  { text: 'Do you want to allow', reason: 'permission' },
  { text: 'Do you want to run', reason: 'permission' },
  { text: 'No, and tell Claude what to do differently', reason: 'permission' },
  { text: "Yes, and don't ask again", reason: 'permission' },
  { text: 'Allow once', reason: 'permission' },
  { text: 'Allow always', reason: 'permission' },
  { text: 'Yes, I trust this folder', reason: 'question' },
  { text: 'Enter to confirm·Esc to cancel', reason: 'question' },
  { text: 'Enter to confirm • Esc to cancel', reason: 'question' },
]
export const WAITING_PATTERNS = RAW_PATTERNS.map((p) => ({ ...p, text: squash(p.text).toLowerCase() }))

/**
 * Screens that have no fixed sentence of their own, matched on the squashed, lowercased text.
 *
 * AskUserQuestion (the multiple-choice question) lists its options, always ends them with
 * `N. Chat about this`, and right under that puts a footer built from key hints — `Enter to select ·
 * ↑/↓ to navigate · Esc to cancel`, or `Tab/Arrow keys to navigate` with several questions (CLI
 * 2.1.x). None of the older patterns ever matched it: the footer says "select", not "confirm". The
 * last option and the footer's first hint with nothing but a blank row between them are what no
 * sentence of prose looks like — which a footer phrase on its own could (this very comment).
 */
export const WAITING_SHAPES: { re: RegExp; reason: WaitReason }[] = [{ re: /chataboutthis.{0,6}(?:enter|return)toselect/, reason: 'question' }]

/** an AskUserQuestion record older than this is a transcript being caught up on, not a question on screen */
export const QUESTION_FRESH_MS = 60_000
/** the same prompt from the second witness, this soon after the first, is the same prompt */
export const WAITING_TWICE_MS = 10_000

/**
 * Decides when a terminal is waiting for an answer. Two witnesses report to it: the screen text
 * (PromptDetector, instant but only as good as its patterns) and the transcript — a multiple-choice
 * question (AskUserQuestion) reaches it as a tool call a second or two after it appears, while it is
 * still waiting. The transcript is the surer of the two: the screen's wording moves with the CLI
 * (the question footer once said "confirm", now "select", and for a while nothing matched it).
 */
export class WaitingGate {
  /** pty id → when a key that answers a prompt (Enter / Esc) last went into it */
  private readonly answeredAt = new Map<number, number>()
  /** pty id → when it was last said to be waiting */
  private readonly waitingAt = new Map<number, number>()

  constructor(
    private readonly emit: (ptyId: number, reason: WaitReason, ts: number) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** The screen shows a prompt. Said once, however many witnesses saw it. */
  waiting(ptyId: number, reason: WaitReason): void {
    const now = this.now()
    const last = this.waitingAt.get(ptyId)
    if (last !== undefined && now - last < WAITING_TWICE_MS && (this.answeredAt.get(ptyId) ?? 0) < last) return
    this.waitingAt.set(ptyId, now)
    this.emit(ptyId, reason, now)
  }

  /** The transcript recorded an AskUserQuestion at `at` (unix ms) for the session in this terminal. */
  asked(ptyId: number, at: number): void {
    if (this.now() - at > QUESTION_FRESH_MS) return
    // answered before its record arrived: nothing is waiting any more
    if ((this.answeredAt.get(ptyId) ?? 0) >= at) return
    this.waiting(ptyId, 'question')
  }

  /**
   * A key that answers a prompt went in. True when the terminal was waiting for one — the only case
   * in which there is anything to clear (main.ts sends `waiting_clear` only then).
   */
  answered(ptyId: number): boolean {
    const last = this.waitingAt.get(ptyId)
    const was = last !== undefined && (this.answeredAt.get(ptyId) ?? 0) < last
    this.answeredAt.set(ptyId, this.now())
    return was
  }

  forget(ptyId: number): void {
    this.answeredAt.delete(ptyId)
    this.waitingAt.delete(ptyId)
  }
}

export class PromptDetector {
  private buf = ''
  constructor(private readonly onWaiting: (reason: WaitReason) => void) {}
  feed(chunk: string): void {
    this.buf = (this.buf + stripTerminal(chunk).toLowerCase()).slice(-4000)
    for (const p of WAITING_PATTERNS) {
      if (this.buf.includes(p.text)) {
        this.buf = ''
        this.onWaiting(p.reason)
        return
      }
    }
    for (const p of WAITING_SHAPES) {
      if (p.re.test(this.buf)) {
        this.buf = ''
        this.onWaiting(p.reason)
        return
      }
    }
  }
}
