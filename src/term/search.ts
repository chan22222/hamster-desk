// The xterm search add-on, behind one factory so there is exactly one place that imports it.
// The version is pinned (`@xterm/addon-search@0.16.0`, no peer range) because 0.17 needs an
// xterm 6.1 beta; if it turns out not to work against xterm 6.0 at runtime, this factory is what
// the self-written fallback replaces — plan §3.9, R2. Owner: B.
//
// Verdict (R2, measured on xterm 6.0.0 + addon-search 0.16.0, see the report): it works. The add-on
// only calls public terminal API — `buffer.active`, `registerDecoration`, `registerMarker`,
// `select`, `scrollLines`, `onWriteParsed` — all of which xterm 6.0.0 still exports, and a real
// capture run showed both the highlight and the `n/m` count. No fallback is shipped.

import { SearchAddon } from '@xterm/addon-search'

export function createSearchAddon(): SearchAddon {
  return new SearchAddon()
}

/** what `TerminalPane` holds on to; named so nothing else has to import the add-on package */
export type TermSearcher = SearchAddon

/**
 * Match colours. `onDidChangeResults` only fires when decorations are on, so the count in the find
 * box depends on this object being passed with every call. The two `…OverviewRuler` fields are
 * required by the add-on's types, and they paint the thin strip down the right edge of the pane.
 */
const DECORATIONS = {
  matchBackground: '#3f7a5a',
  matchOverviewRuler: '#3f7a5a',
  activeMatchBackground: '#7fd4a3',
  activeMatchBorder: '#e3eade',
  activeMatchColorOverviewRuler: '#7fd4a3',
}

export function searchOptions(caseSensitive: boolean, incremental: boolean): Parameters<SearchAddon['findNext']>[1] {
  return { caseSensitive, incremental, decorations: DECORATIONS }
}

// ---- stdout tagging -----------------------------------------------------------------------
// A capture run has nobody watching the screen, and `electron/main.ts` forwards any renderer
// `console.log` that starts with `[` to stdout when HAMSTER_CAPTURE is set. A normal run should not
// be narrating itself into the user's dev tools, so the tagged lines are behind this flag, which is
// on exactly when the app was started with one of the debug knobs.

let verbose = false
let probed = false

export function probeTermVerbose(): void {
  if (probed) return
  probed = true
  void window.desk
    ?.info()
    .then((i) => {
      // `debugCapture` is sent by main but is not in the frozen `info()` type yet, hence the cast.
      // It is the flag that matters most: main only forwards `[`-tagged lines during a capture run,
      // and a run driven by HAMSTER_KEYS alone sets none of the others.
      const capture = (i as { debugCapture?: boolean }).debugCapture === true
      verbose = capture || i.debugEvents !== null || i.debugClicks.length > 0 || i.debugPrefs !== null || i.unfocused
    })
    .catch(() => undefined)
}

export function termLog(msg: string): void {
  if (verbose) console.log(msg)
}
