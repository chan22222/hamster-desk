import { useMemo, useState } from 'react'
import type { EditEntry, SessionState } from '../store'

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
  const [open, setOpen] = useState<string | null>(null)
  const files = useMemo(() => changedFiles(session), [session])

  if (!session) return <div className="side-empty">아직 세션이 없어요.</div>
  if (files.length === 0) return <div className="side-empty">아직 수정한 파일이 없습니다.</div>

  return (
    <>
      {files.map((f) => (
        <div key={f.file} className={`file-row ${open === f.file ? 'open' : ''}`}>
          <button
            className="file-main"
            onClick={() => setOpen(open === f.file ? null : f.file)}
            title={`${f.file}\n+${f.added} −${f.removed} · ${f.count}회 · ${[...f.who].join(', ')} · ${timeOf(f.last.ts)}`}
          >
            <span className="file-top">
              <span className="file-name">{f.name}</span>
              <span className="file-meta">
                <span className="add">+{f.added}</span> <span className="rem">−{f.removed}</span>
              </span>
            </span>
            {f.dir && <span className="file-dir">{f.dir}</span>}
          </button>
          {open === f.file && f.last.preview && (
            <div className="file-preview">
              <div className="pv-label">
                {f.last.op === 'write' ? '마지막 Write' : '마지막 Edit'} · {f.last.whoName} · {timeOf(f.last.ts)}
              </div>
              {f.last.preview.old && <pre className="pv-old">{f.last.preview.old}</pre>}
              <pre className="pv-new">{f.last.preview.new}</pre>
            </div>
          )}
        </div>
      ))}
    </>
  )
}
