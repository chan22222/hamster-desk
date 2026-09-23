// Speech bubbles that land on top of each other. Every hamster's feed hangs over its own head by
// projection, so two hamsters that stand close on screen — the boss and the colleague in front of
// it, a row of desks seen from the side, the queue by the door — heap their bubbles into one
// unreadable pile. This moves the later ones aside, every frame: the feeds are taken nearest the
// viewer first (the lowest anchor on screen belongs to the head in front), and each one that
// overlaps a feed already placed is pushed the shortest way clear of it — up, left or right,
// whichever moves it least without leaving the canvas or climbing into the header. The studio
// gives a feed that had to move a short tail back to its hamster's head, so the bubble still says
// whose it is.
//
// Pure: boxes in, offsets out (scripts/unit/declutter.test.ts).

export interface FeedBox {
  id: string
  /** the anchor: the bottom centre of the feed, just over the hamster's head, px */
  x: number
  y: number
  /** the feed's size, px */
  w: number
  h: number
}

export interface Shift {
  dx: number
  dy: number
}

/** the clear space kept between two feeds, px */
export const GAP = 4
/** a feed that moved last frame keeps moving the same way unless another way is this much shorter — so a pile of near-equal choices does not flicker between them */
export const STICKY = 14
/** how many times one feed is pushed on before the rest is left to overlap (a pile deeper than this is rare) */
const PASSES = 6

type Rect = { l: number; r: number; t: number; b: number }

const direction = (s: Shift): number => (s.dy < 0 ? 0 : s.dx < 0 ? 1 : s.dx > 0 ? 2 : -1)

/**
 * `top` is the highest a feed may be pushed to (the studio's header band): past it the way out is
 * sideways, and up only if there is no room either side. `prev` is last frame's answer.
 */
export function declutter(feeds: readonly FeedBox[], width: number, prev?: ReadonlyMap<string, Shift>, top = 0, gap = GAP): Map<string, Shift> {
  const order = [...feeds].sort((a, b) => b.y - a.y || a.x - b.x || (a.id < b.id ? -1 : 1))
  const placed: Rect[] = []
  const out = new Map<string, Shift>()
  for (const f of order) {
    let dx = 0
    let dy = 0
    const was = prev?.get(f.id)
    const bias = was ? direction(was) : -1
    for (let pass = 0; pass < PASSES; pass++) {
      const l = f.x - f.w / 2 + dx
      const r = l + f.w
      const b = f.y + dy
      const t = b - f.h
      const hit = placed.find((p) => l < p.r + gap && r > p.l - gap && t < p.b + gap && b > p.t - gap)
      if (!hit) break
      // up first, so a tie goes that way — the way a chat log grows
      const up: Shift = { dx: 0, dy: hit.t - gap - b }
      const moves: Shift[] = hit.t - gap - f.h >= top ? [up] : []
      if (hit.l - gap - f.w >= 0) moves.push({ dx: hit.l - gap - r, dy: 0 })
      if (hit.r + gap + f.w <= width) moves.push({ dx: hit.r + gap - l, dy: 0 })
      if (!moves.length) moves.push(up)
      const cost = (m: Shift): number => Math.hypot(m.dx, m.dy) - (direction(m) === bias ? STICKY : 0)
      const best = moves.reduce((m, c) => (cost(c) < cost(m) ? c : m))
      dx += best.dx
      dy += best.dy
    }
    placed.push({ l: f.x - f.w / 2 + dx, r: f.x + f.w / 2 + dx, t: f.y + dy - f.h, b: f.y + dy })
    out.set(f.id, { dx, dy })
  }
  return out
}
