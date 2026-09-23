// The real `git diff` of one changed file, under its row in the sidebar. The edit preview above
// it is what Claude Code *said* it wrote; this is what the working tree actually holds, which is
// the difference between "it edited this" and "this is what is still uncommitted".
//
// `edit` is the file's last edit: a new one reads the diff again. The last few diffs read are kept
// (./diff-cache.ts), so a row scrolled out of the list and back shows its diff at once.

import { useEffect, useState } from 'react'
import type { GitDiff } from '@shared/events'
import { useUi } from '../i18n'
import { classifyDiffLine } from './diff'
import { diffCache, diffKey, isFresh } from './diff-cache'
import './git.css'

export function DiffView({ cwd, file, edit }: { cwd: string; file: string; edit: string }) {
  const u = useUi()
  const key = diffKey(cwd, file, edit)
  const [diff, setDiff] = useState<GitDiff | null>(() => diffCache.get(key)?.diff ?? null)

  useEffect(() => {
    const bridge = window.desk
    if (!bridge) return
    const hit = diffCache.get(key)
    if (hit && isFresh(hit, Date.now())) {
      setDiff(hit.diff)
      return
    }
    let alive = true
    // What is on screen stays while git is asked: an older read of this edit, or the diff of the
    // edit before (a new edit came in while it was open). "Loading" is only for having nothing.
    if (hit) setDiff(hit.diff)
    void bridge.git
      .diff(cwd, file)
      .then((d) => {
        diffCache.set(key, d, Date.now())
        if (alive) setDiff(d)
      })
      .catch((err: unknown) => {
        if (alive) setDiff({ text: '', truncated: false, untracked: false, error: String(err) })
      })
    return () => {
      alive = false
    }
  }, [cwd, file, key])

  if (!window.desk) return <div className="dv-note">{u.files.desktopOnly}</div>
  if (!diff) return <div className="dv-note">{u.files.diffLoading}</div>
  if (diff.error) return <div className="dv-note warn-line">{u.files.diffFailed(diff.error)}</div>
  if (diff.untracked) return <div className="dv-note">{u.files.untracked}</div>
  if (!diff.text.trim()) return <div className="dv-note">{u.files.noDiff}</div>

  return (
    <div className="diff-view">
      <pre>
        {diff.text.split('\n').map((line, i) => (
          <div key={i} className={`dl-${classifyDiffLine(line)}`}>
            {line || ' '}
          </div>
        ))}
      </pre>
      {diff.truncated && <div className="dv-note">{u.files.truncated}</div>}
    </div>
  )
}
