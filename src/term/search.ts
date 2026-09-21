// The xterm search add-on, behind one factory so there is exactly one place that imports it.
// The version is pinned (`@xterm/addon-search@0.16.0`, no peer range) because 0.17 needs an
// xterm 6.1 beta; if it turns out not to work against xterm 6.0 at runtime, this factory is what
// the self-written fallback replaces — plan §3.9, R2. Owner: B.

import { SearchAddon } from '@xterm/addon-search'

export function createSearchAddon(): SearchAddon {
  return new SearchAddon()
}
