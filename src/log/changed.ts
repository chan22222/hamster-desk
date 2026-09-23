// The files a session changed, one row per file, out of its list of edits (at most 500, newest
// last). Pure, so the unit test can have it too; the sidebar works it out once per new edit, for
// the count on its "changed files" section and the list inside it alike.

import { ui } from '../i18n'
import type { EditEntry } from '../store'

export interface FileAgg {
  file: string
  name: string
  dir: string
  count: number
  added: number
  removed: number
  who: Set<string>
  last: EditEntry
}

function split(p: string): { name: string; dir: string } {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? { name: p.slice(i + 1), dir: p.slice(0, i) } : { name: p, dir: '' }
}

/**
 * Who made an edit. The main hamster is named in the current language (`mainName`): the name an
 * entry carries was worded when its session began, and the language may have changed since.
 */
export const whoOf = (e: EditEntry, mainName: string): string => (e.who === 'main' ? mainName : e.whoName)

/** One row per file the session touched, newest first. */
export function changedFiles(edits: readonly EditEntry[], mainName = ui().common.mainHamster): FileAgg[] {
  const m = new Map<string, FileAgg>()
  for (const e of edits) {
    let a = m.get(e.file)
    if (!a) {
      const { name, dir } = split(e.file)
      a = { file: e.file, name, dir, count: 0, added: 0, removed: 0, who: new Set(), last: e }
      m.set(e.file, a)
    }
    a.count++
    a.added += e.added
    a.removed += e.removed
    a.who.add(whoOf(e, mainName))
    a.last = e
  }
  return [...m.values()].sort((x, y) => y.last.ts - x.last.ts)
}
