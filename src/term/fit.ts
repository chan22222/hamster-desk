// When a terminal pane refits while it is being resized. Pure — the clock is passed in — so
// scripts/unit can hold it to the one promise the pane relies on: the last change of a burst always
// gets a refit after it, however the burst lines up with the throttle.

export interface Clock {
  now(): number
  later(fn: () => void, ms: number): unknown
  cancel(handle: unknown): void
}

const timers: Clock = {
  now: () => performance.now(),
  later: (fn, ms) => setTimeout(fn, ms),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/**
 * `poke` as often as you like; `run` happens at most once per `every` ms. There is no separate
 * trailing call because none is needed: a run measures the pane when it *runs*, so a poke that
 * lands while one is pending is answered by that run, which comes after it, and a poke with none
 * pending schedules its own.
 */
export function throttleTrailing(run: () => void, every: number, clock: Clock = timers): { poke(): void; cancel(): void } {
  let pending: unknown = null
  let last = -Infinity
  return {
    poke() {
      if (pending !== null) return
      pending = clock.later(
        () => {
          pending = null
          last = clock.now()
          run()
        },
        Math.max(0, every - (clock.now() - last)),
      )
    },
    cancel() {
      if (pending !== null) clock.cancel(pending)
      pending = null
    },
  }
}
