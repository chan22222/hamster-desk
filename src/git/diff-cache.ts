// The last few `git diff`s read for the sidebar. The changed-files list only renders the rows in
// view (src/log/window.ts), so a row with its diff open that is scrolled away and back has been
// unmounted meanwhile, DiffView with it: without this it said "loading" and asked git again.
//
// Keyed by the file's last edit as well as the file: an edit is a new key, so a diff read before it
// is never shown as the diff after it. What changes the working tree between edits (a commit, a
// formatter run from a shell) has no edit to key on, so an entry is taken as it is only while it is
// young; an older one is shown while it is read again. Pure: no React, no bridge, no clock of its
// own, so the unit test can have it too.

import type { GitDiff } from '@shared/events'

/** how many diffs are kept; only one is open at a time, so a handful is plenty */
export const DIFF_CACHE_MAX = 8
/** how long a diff is shown without asking git again */
export const DIFF_FRESH_MS = 30_000

/** the file, the folder its `git diff` runs in, and the edit it was read after */
export const diffKey = (cwd: string, file: string, edit: string): string => `${cwd}\n${file}\n${edit}`

export interface CachedDiff {
  diff: GitDiff
  /** when it was read */
  at: number
}

/** A small least-recently-used cache: the entry used longest ago goes first. */
export class DiffCache {
  private readonly entries = new Map<string, CachedDiff>()
  private readonly max: number

  constructor(max = DIFF_CACHE_MAX) {
    this.max = max
  }

  get(key: string): CachedDiff | undefined {
    const hit = this.entries.get(key)
    if (hit) {
      // used again: to the young end of the line
      this.entries.delete(key)
      this.entries.set(key, hit)
    }
    return hit
  }

  /** What was read. A failed read is not kept: the next time the row opens, git is asked again. */
  set(key: string, diff: GitDiff, at: number): void {
    if (diff.error) return
    this.entries.delete(key)
    this.entries.set(key, { diff, at })
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string)
  }

  get size(): number {
    return this.entries.size
  }
}

/** young enough to show without asking git again */
export const isFresh = (hit: CachedDiff, now: number): boolean => now - hit.at < DIFF_FRESH_MS

/** the one DiffView reads and fills */
export const diffCache = new DiffCache()
