// The pure part of the app's own notification window (electron/toast-window.ts): which cards are
// up, how long each one stays, and where the window sits. Nothing here touches Electron, so
// scripts/unit/toast-stack.test.ts can run it under plain node; the host injects `now`.

import type { NotifyRequest } from '../shared/events'

/** a rectangle in Electron's logical (DIP) coordinates — the same shape as electron's `Rectangle` */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type ToastTag = NotifyRequest['tag']

/** how many cards are on screen at once; an older one is dropped for a newer one beyond this */
export const TOAST_MAX = 3
/** the card, in DIP */
export const TOAST_WIDTH = 360
export const CARD_HEIGHT = 96
/** the space between two stacked cards */
export const CARD_GAP = 8
/** the cards' distance from the edge of the work area */
export const EDGE_MARGIN = 16
/**
 * Transparent room around the cards, inside the window, for their shadow. It equals the edge
 * margin, so the window itself sits flush in the corner of the work area — a transparent window
 * still takes the clicks that land on it, and this keeps that ring as small as the shadow allows.
 */
export const SHADOW_PAD = 16

/**
 * How long a card stays. A question or a permission request is worth waiting for — the terminal
 * is blocked until it is answered — so those stay about twice as long as "the turn is done".
 */
export const TTL_MS: Record<ToastTag, number> = { permission: 15_000, question: 15_000, turn: 8_000 }

export const ttlFor = (tag: ToastTag): number => TTL_MS[tag] ?? TTL_MS.turn

export interface ToastItem {
  id: number
  title: string
  body: string
  tag: ToastTag
  /** the tab to open when the card is clicked */
  tab: string
}

interface Entry extends ToastItem {
  /** when the card goes away on its own, unless the stack is paused */
  deadline: number
}

/**
 * The cards on screen, oldest first. The page draws them top to bottom, so the newest card is the
 * bottom one — nearest the corner the eye already goes to, where Windows puts its own newest
 * toast — and the window, anchored at the bottom, grows upward: a card the user is about to
 * click never moves because another one arrived.
 *
 * `pause` freezes every deadline while the pointer is over the window (one timer for the whole
 * stack, so the stack never reshuffles under the pointer); `resume` gives the time back.
 */
export class ToastStack {
  private entries: Entry[] = []
  private pausedAt: number | null = null
  private seq = 0

  constructor(private readonly max = TOAST_MAX) {}

  items(): ToastItem[] {
    return this.entries.map(({ deadline: _d, ...item }) => item)
  }

  get size(): number {
    return this.entries.length
  }

  paused(): boolean {
    return this.pausedAt !== null
  }

  /** Add a card; beyond `max` the oldest ones make room. */
  push(req: Omit<ToastItem, 'id'>, now: number): { item: ToastItem; dropped: ToastItem[] } {
    // while paused the clock stands at `pausedAt`: dating the deadline from there means the card
    // gets its whole time once the pointer leaves, not that plus however long the pause has run
    const from = this.pausedAt ?? now
    const entry: Entry = { ...req, id: ++this.seq, deadline: from + ttlFor(req.tag) }
    this.entries.push(entry)
    const dropped: ToastItem[] = []
    while (this.entries.length > this.max) dropped.push(strip(this.entries.shift()!))
    return { item: strip(entry), dropped }
  }

  remove(id: number): ToastItem | null {
    const i = this.entries.findIndex((e) => e.id === id)
    if (i < 0) return null
    return strip(this.entries.splice(i, 1)[0])
  }

  clear(): ToastItem[] {
    const gone = this.items()
    this.entries = []
    return gone
  }

  pause(now: number): void {
    if (this.pausedAt === null) this.pausedAt = now
  }

  resume(now: number): void {
    if (this.pausedAt === null) return
    const span = Math.max(0, now - this.pausedAt)
    for (const e of this.entries) e.deadline += span
    this.pausedAt = null
  }

  /** The cards whose time is up, taken out of the stack; none while paused. */
  expire(now: number): ToastItem[] {
    if (this.pausedAt !== null) return []
    const gone = this.entries.filter((e) => e.deadline <= now).map(strip)
    if (gone.length) this.entries = this.entries.filter((e) => e.deadline > now)
    return gone
  }

  /** When the host should call `expire` next; null while the stack is empty or paused. */
  nextDeadline(): number | null {
    if (this.pausedAt !== null || this.entries.length === 0) return null
    return Math.min(...this.entries.map((e) => e.deadline))
  }
}

function strip({ deadline: _d, ...item }: Entry): ToastItem {
  return item
}

/**
 * Where the window goes for `count` cards: the bottom-right corner of `workArea` (above the
 * taskbar, `EDGE_MARGIN` from both edges), tall enough for the cards plus the shadow ring.
 * `avoid` is a window that already owns that corner — the mini window — and the stack moves up
 * to sit just above it rather than on top of it. Everything is in DIP: Electron scales for us.
 */
export function toastBounds(count: number, workArea: Rect, avoid?: Rect | null): Rect {
  const n = Math.max(1, Math.min(TOAST_MAX, count))
  const width = TOAST_WIDTH + 2 * SHADOW_PAD
  const height = n * CARD_HEIGHT + (n - 1) * CARD_GAP + 2 * SHADOW_PAD
  const inset = EDGE_MARGIN - SHADOW_PAD
  const x = workArea.x + workArea.width - width - inset
  let y = workArea.y + workArea.height - height - inset
  if (avoid && overlaps({ x, y, width, height }, avoid)) y = avoid.y - CARD_GAP - height + SHADOW_PAD
  return { x, y: Math.max(workArea.y, y), width, height }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}
