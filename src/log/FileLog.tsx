import { useMemo, useState } from 'react'
import { useUi } from '../i18n'
import type { EditEntry, SessionState } from '../store'
import { DiffView } from '../git/DiffView'
import './log.css'

interface FileAgg {
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

function timeOf(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

/** One row per file the session touched, newest first. */
export function changedFiles(session: SessionState | null): FileAgg[] {
  const m = new Map<string, FileAgg>()
  for (const e of session?.edits ?? []) {
    let a = m.get(e.file)
    if (!a) {
      const { name, dir } = split(e.file)
      a = { file: e.file, name, dir, count: 0, added: 0, removed: 0, who: new Set(), last: e }
      m.set(e.file, a)
    }
    a.count++
    a.added += e.added
    a.removed += e.removed
    a.who.add(e.whoName)
    a.last = e
  }
  return [...m.values()].sort((x, y) => y.last.ts - x.last.ts)
}

/**
 * The "changed files" list. It used to be a 300px panel on the right; it now lives inside the
 * sidebar, so a row is two narrow lines — name + `+N −N`, then the folder — and the last diff
 * unfolds underneath it.
 */
export function FileLog({ session }: { session: SessionState | null }) {
  const u = useUi()
  const [open, setOpen] = useState<string | null>(null)
  /** which open file is showing its real `git diff` instead of just the edit preview */
  const [diff, setDiff] = useState<string | null>(null)
  const files = useMemo(() => changedFiles(session), [session])

  if (!session) return <div className="side-empty">{u.files.noSession}</div>
  if (files.length === 0) return <div className="side-empty">{u.files.noFiles}</div>

  return (
    <>
      {files.map((f, i) => (
        <div key={f.file} className={`file-row ${open === f.file ? 'open' : ''}`}>
          <button
            className="file-main"
            data-debug-click={`file-${i}`}
            onClick={() => setOpen(open === f.file ? null : f.file)}
            title={u.files.rowTip(f.file, f.added, f.removed, f.count, [...f.who].join(', '), timeOf(f.last.ts))}
          >
            <span className="file-top">
              <span className="file-name">{f.name}</span>
              <span className="file-meta">
                <span className="add">+{f.added}</span> <span className="rem">−{f.removed}</span>
              </span>
            </span>
            {f.dir && <span className="file-dir">{f.dir}</span>}
          </button>
          {open === f.file && (
            <div className="file-preview">
              <div className="pv-head">
                <span className="pv-label">
                  {f.last.op === 'write' ? u.files.lastWrite : u.files.lastEdit} · {f.last.whoName} · {timeOf(f.last.ts)}
                </span>
                {/* the preview is what the tool reported; this is what the working tree holds */}
                <button
                  className={`pv-diff ${diff === f.file ? 'is-on' : ''}`}
                  data-debug-click={`file-${i}-diff`}
                  aria-pressed={diff === f.file}
                  title={u.files.diffTip}
                  onClick={() => setDiff(diff === f.file ? null : f.file)}
                >
                  git diff
                </button>
              </div>
              {diff === f.file && <DiffView cwd={session.info.cwd} file={f.file} />}
              {f.last.preview?.old && <pre className="pv-old">{f.last.preview.old}</pre>}
              {f.last.preview && <pre className="pv-new">{f.last.preview.new}</pre>}
            </div>
          )}
        </div>
      ))}
    </>
  )
}
