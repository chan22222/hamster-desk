import { useEffect, useState } from 'react'
import { useDesk } from '../store'
import { LANG_OPTIONS, type PrefLang } from '../i18n'
import { bubbleAvailability, type BubbleAvailability } from '../bubbles/summarize'
import { Popover } from './Popover'
import { VersionSection } from './Version'

function CheckRow({ on, label, hint, disabled, onClick }: { on: boolean; label: string; hint?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button className={`pop-check ${on ? 'is-on' : ''}`} role="menuitemcheckbox" aria-checked={on} disabled={disabled} onClick={onClick}>
      <span className="pop-tick">{on ? '✓' : ''}</span>
      <span className="pop-label">{label}</span>
      {hint && <span className="dim">{hint}</span>}
    </button>
  )
}

function Body({ onUpdate }: { onUpdate: () => void }) {
  const prefs = useDesk((s) => s.prefs)
  const setPrefs = useDesk((s) => s.setPrefs)
  const [bubble, setBubble] = useState<BubbleAvailability | null>(null)

  useEffect(() => {
    void bubbleAvailability(true).then(setBubble)
  }, [])

  return (
    <div className="pop-body">
      <CheckRow on={prefs.showSidebar} label="사이드바" hint="Ctrl+B" onClick={() => setPrefs({ showSidebar: !prefs.showSidebar })} />
      <CheckRow on={!prefs.folded} label="책상 펼치기" onClick={() => setPrefs({ folded: !prefs.folded })} />
      <CheckRow on={prefs.showLog} label="바뀐 파일 패널" onClick={() => setPrefs({ showLog: !prefs.showLog })} />
      <CheckRow on={prefs.onTop} label="항상 위" onClick={() => setPrefs({ onTop: !prefs.onTop })} />

      <div className="pop-sep" />
      <div className="pop-head">말풍선</div>
      <CheckRow
        on={prefs.bubbleSummary}
        label="요약해서 말하기"
        disabled={bubble ? !bubble.available : false}
        onClick={() => setPrefs({ bubbleSummary: !prefs.bubbleSummary })}
      />
      {bubble && !bubble.available && <p className="pop-note">{bubble.reason ?? '지금은 요약할 수 없어요.'}</p>}
      <label className="pop-field">
        언어
        <select value={prefs.lang} onChange={(e) => setPrefs({ lang: e.target.value as PrefLang })}>
          {LANG_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <div className="pop-sep" />
      <div className="pop-head">Claude Code</div>
      <VersionSection onUpdate={onUpdate} />
    </div>
  )
}

/** The quiet corner of the top bar: view toggles, bubble settings and the CLI version. */
export function MoreMenu({ onUpdate }: { onUpdate: () => void }) {
  return (
    <Popover className="icon-btn" label="⋯" ariaLabel="설정" title="설정" width={244}>
      {() => <Body onUpdate={onUpdate} />}
    </Popover>
  )
}
