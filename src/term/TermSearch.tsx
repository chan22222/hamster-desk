// The find box that floats over a terminal pane — plan §3.9. Owner: B.
//
// It owns no search state of its own: `TerminalPane` holds the query and drives the add-on, because
// the add-on belongs to the xterm instance and the overlay is just its face. That also means the
// box can be opened from outside the terminal (Ctrl+F while the sidebar has focus, the debug hook)
// without the two ever disagreeing about what is being searched for.

import { useEffect, useRef } from 'react'
import { useUi } from '../i18n'
import { IconChevron, IconClose, IconSearch } from '../widgets/icons'
import './term.css'

export interface TermSearchProps {
  q: string
  caseSensitive: boolean
  /** 1-based position of the current match, or 0 when there is none */
  index: number
  total: number
  /** bumped every time something asks for the box again, so the input re-takes the caret */
  focusKey: number
  onQuery(q: string): void
  onCase(on: boolean): void
  onNext(): void
  onPrev(): void
  onClose(): void
}

export function TermSearch({ q, caseSensitive, index, total, focusKey, onQuery, onCase, onNext, onPrev, onClose }: TermSearchProps) {
  const u = useUi()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [focusKey])

  const count = q ? (total > 0 ? `${index}/${total}` : '0/0') : ''

  return (
    <div className="term-search" role="search">
      <span className="ts-ico">
        <IconSearch size={13} />
      </span>
      <input
        ref={inputRef}
        className="ts-input"
        placeholder={u.search.placeholder}
        aria-label={u.search.placeholder}
        value={q}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span className={`ts-count ${q && total === 0 ? 'is-none' : ''}`}>{count}</span>
      <button className="ts-btn" title={u.search.prevTip} aria-label={u.search.prev} disabled={!q} onClick={onPrev}>
        <IconChevron dir="up" size={13} />
      </button>
      <button className="ts-btn" title={u.search.nextTip} aria-label={u.search.next} disabled={!q} onClick={onNext}>
        <IconChevron dir="down" size={13} />
      </button>
      <button
        className={`ts-btn ts-case ${caseSensitive ? 'is-on' : ''}`}
        title={u.search.caseSensitive}
        aria-label={u.search.caseSensitive}
        aria-pressed={caseSensitive}
        onClick={() => onCase(!caseSensitive)}
      >
        Aa
      </button>
      <button className="ts-btn" data-debug-click="term-search-close" title={u.search.closeTip} aria-label={u.search.close} onClick={onClose}>
        <IconClose size={12} />
      </button>
    </div>
  )
}
