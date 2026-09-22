// The real `git diff` of one changed file, under its row in the sidebar. The edit preview above
// it is what Claude Code *said* it wrote; this is what the working tree actually holds, which is
// the difference between "it edited this" and "this is what is still uncommitted".

import { useEffect, useState } from 'react'
import type { GitDiff } from '@shared/events'
import { useUi } from '../i18n'
import { classifyDiffLine } from './diff'
import './git.css'

export function DiffView({ cwd, file }: { cwd: string; file: string }) {
  const u = useUi()
  const [diff, setDiff] = useState<GitDiff | null>(null)

  useEffect(() => {
    const bridge = window.desk
    if (!bridge) return
    let alive = true
    setDiff(null)
    void bridge.git
      .diff(cwd, file)
      .then((d) => {
        if (alive) setDiff(d)
      })
      .catch((err: unknown) => {
        if (alive) setDiff({ text: '', truncated: false, untracked: false, error: String(err) })
      })
    return () => {
      alive = false
    }
  }, [cwd, file])

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
