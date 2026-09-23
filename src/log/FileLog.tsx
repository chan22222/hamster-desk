import { memo, useCallback, useMemo, useState } from 'react'
import { useUi, type UiStrings } from '../i18n'
import type { EditEntry } from '../store'
import { DiffView } from '../git/DiffView'
import { whoOf, type FileAgg } from './changed'
import { debugRows, useRowWindow } from './window'
import './log.css'

function timeOf(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

/**
 * One file's row, and the last edit's preview under it once opened. It gets the aggregate's
 * numbers rather than the aggregate, which is new for every file with every edit: an edit renders
 * the row of the file it changed, not all of them.
 */
const FileRow = memo(function FileRow({
  file,
  name,
  dir,
  count,
  added,
  removed,
  who,
  last,
  open,
  diff,
  cwd,
  u,
  debug,
  onToggle,
  onDiff,
}: {
  file: string
  name: string
  dir: string
  count: number
  added: number
  removed: number
  /** everyone who edited it, joined */
  who: string
  last: EditEntry
  open: boolean
  /** showing the real `git diff` instead of just the edit preview */
  diff: boolean
  cwd: string
  u: UiStrings
  /** `file-<n>`, in a capture run only (see `debugRows`) */
  debug?: string
  onToggle: (file: string) => void
  onDiff: (file: string) => void
}) {
  return (
    <div className={`file-row ${open ? 'open' : ''}`}>
      <button className="file-main" data-debug-click={debug} onClick={() => onToggle(file)} title={u.files.rowTip(file, added, removed, count, who, timeOf(last.ts))}>
        <span className="file-top">
          <span className="file-name">{name}</span>
          <span className="file-meta">
            <span className="add">+{added}</span> <span className="rem">−{removed}</span>
          </span>
        </span>
        {dir && <span className="file-dir">{dir}</span>}
      </button>
      {open && (
        <div className="file-preview">
          <div className="pv-head">
            <span className="pv-label">
              {last.op === 'write' ? u.files.lastWrite : u.files.lastEdit} · {whoOf(last, u.common.mainHamster)} · {timeOf(last.ts)}
            </span>
            {/* the preview is what the tool reported; this is what the working tree holds */}
            <button
              className={`pv-diff ${diff ? 'is-on' : ''}`}
              data-debug-click={debug && `${debug}-diff`}
              aria-pressed={diff}
              title={u.files.diffTip}
              onClick={() => onDiff(file)}
            >
              git diff
            </button>
          </div>
          {diff && <DiffView cwd={cwd} file={file} edit={last.id} />}
          {last.preview?.old && <pre className="pv-old">{last.preview.old}</pre>}
          {last.preview && <pre className="pv-new">{last.preview.new}</pre>}
        </div>
      )}
    </div>
  )
})

/**
 * The "changed files" list. It used to be a 300px panel on the right; it now lives inside the
 * sidebar, so a row is two narrow lines — name + `+N −N`, then the folder — and the last diff
 * unfolds underneath it.
 *
 * `files` is `changedFiles` of the session in front (null: there is none), worked out by the
 * sidebar, which shows how many there are; `cwd` is that session's folder, for `git diff`.
 */
export const FileLog = memo(function FileLog({ files, cwd }: { files: FileAgg[] | null; cwd: string }) {
  const u = useUi()
  const [open, setOpen] = useState<string | null>(null)
  /** which open file is showing its real `git diff` instead of just the edit preview */
  const [diff, setDiff] = useState<string | null>(null)
  const keys = useMemo(() => (files ?? []).map((f) => f.file), [files])
  const win = useRowWindow(keys)
  const toggle = useCallback((file: string) => setOpen((o) => (o === file ? null : file)), [])
  const toggleDiff = useCallback((file: string) => setDiff((d) => (d === file ? null : file)), [])

  if (!files) return <div className="side-empty">{u.files.noSession}</div>
  if (files.length === 0) return <div className="side-empty">{u.files.noFiles}</div>

  const named = debugRows()
  return (
    <>
      <div className="rows-gap" style={{ height: win.before }} />
      <div ref={win.ref} className="file-rows">
        {files.slice(win.start, win.end).map((f, k) => (
          <FileRow
            key={f.file}
            file={f.file}
            name={f.name}
            dir={f.dir}
            count={f.count}
            added={f.added}
            removed={f.removed}
            who={[...f.who].join(', ')}
            last={f.last}
            open={open === f.file}
            diff={diff === f.file}
            cwd={cwd}
            u={u}
            debug={named ? `file-${win.start + k}` : undefined}
            onToggle={toggle}
            onDiff={toggleDiff}
          />
        ))}
      </div>
      <div className="rows-gap" style={{ height: win.after }} />
    </>
  )
})
