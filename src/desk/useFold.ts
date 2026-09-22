// The fold switch's clock as a React hook (fold.ts is the machine). App.tsx asks it, rather than
// `prefs.folded` directly, whether the studio should be on screen: the preference flips at once,
// but the studio stays up for the blast that plays it out, and comes up early for the build.
import { useEffect, useRef, useState } from 'react'
import { BLAST_S, PANE_S, foldAt, foldFlip, foldPlaying, foldRemaining, foldSettle, foldShown, type FoldFx } from './fold'

/** the OS asked for less motion: the studio folds and unfolds with a cut, as it always did */
export function reducedMotion(): boolean {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * `folded` is the preference; `silent` is true while the settings are still being read, so the
 * saved value arriving (or a capture run's forced prefs) is adopted with a cut rather than played
 * as if the user had just flipped the switch. Likewise the value on first mount: the app starting
 * with the studio up is not a construction site.
 */
export function useFold(folded: boolean, silent: boolean): { shown: boolean; fx: FoldFx; playing: boolean; collapsed: boolean } {
  const [fx, setFx] = useState<FoldFx>(() => foldAt(folded, performance.now()))
  /**
   * The pane's size, as a switch: true = zero. Flips to true over the blast's last half second
   * and stays so while closed; a build mounts the studio at zero and lets go a frame later, so
   * the `.is-story` transition (styles.css) grows it in rather than popping it up.
   */
  const [collapsed, setCollapsed] = useState(folded)
  const shut = useRef(collapsed)
  shut.current = collapsed
  const seen = useRef({ folded, silent })
  useEffect(() => {
    const was = seen.current
    seen.current = { folded, silent }
    if (folded === was.folded) return
    // a flip that lands in the same commit the settings finish loading is still the saved value
    if (silent || was.silent) {
      setFx(foldAt(folded, performance.now()))
      return
    }
    setFx((f) => foldFlip(f, folded, performance.now(), reducedMotion()))
  }, [folded, silent])
  // a playing phase settles by itself; a fresh flip replaces `fx` and so clears this timer
  useEffect(() => {
    const left = foldRemaining(fx, performance.now())
    if (left === null) return
    const timer = window.setTimeout(() => setFx((f) => (f === fx ? foldSettle(f, performance.now()) : f)), left)
    return () => window.clearTimeout(timer)
  }, [fx])
  useEffect(() => {
    if (fx.phase === 'closed') {
      setCollapsed(true)
      return
    }
    if (fx.phase === 'open') {
      setCollapsed(false)
      return
    }
    if (fx.phase === 'blast') {
      setCollapsed(false)
      const at = Math.max(0, fx.since + (BLAST_S - PANE_S) * 1000 - performance.now())
      const timer = window.setTimeout(() => setCollapsed(true), at)
      return () => window.clearTimeout(timer)
    }
    // build: a pane that is shut (closed, or the blast's last half second) opens once the browser
    // has laid the zero out — two frames, the first paints it — so the transition grows it in. An
    // unfold in the middle of a blast finds the pane open and leaves it so: no dip to zero and back.
    if (!shut.current) return
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setCollapsed(false))
    })
    return () => cancelAnimationFrame(raf)
  }, [fx])
  return { shown: foldShown(fx), fx, playing: foldPlaying(fx), collapsed }
}
