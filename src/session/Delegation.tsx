// "멀티 에이전트" on the session bar: a toggle and, next to it, which harness. Nothing here types into
// the terminal — the choice lands in the account's CLAUDE.md (electron/delegation.ts) and Claude
// reads it at the start of its next session. So unlike everything else on the bar, these two stay
// live while a prompt is waiting, and the note under the menu says when the change takes effect.

import { useEffect, useState } from 'react'
import { DELEGATION_CAPS, DELEGATION_PRESETS, type DelegationConfig, type DelegationState } from '@shared/events'
import { IconCheck, IconChevron } from '../widgets/icons'
import { Popover } from '../widgets/Popover'

const TIP = '멀티 에이전트: 작업을 서브에이전트에게 나눠 맡기라는 지시를 이 계정의 CLAUDE.md 에 넣어 둬요.\n다음에 여는 claude 부터 적용돼요.'
const NOTE = '이 계정의 CLAUDE.md 에 표시된 블록으로 들어가요 (끄면 블록만 사라져요). 다음에 여는 claude 부터 적용돼요.'

export function DelegationControl({ profileId }: { profileId: string }) {
  const [state, setState] = useState<DelegationState | null>(null)
  // the custom text is typed here and saved when the box loses focus — every keystroke would
  // otherwise rewrite the file
  const [draft, setDraft] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void window.desk?.delegation.get().then((s) => alive && setState(s))
    return () => {
      alive = false
    }
  }, [])

  if (!state) return null
  const c = state.config
  const acc = state.accounts[profileId]
  const save = (patch: Partial<DelegationConfig>): void => {
    void window.desk?.delegation.set({ ...c, ...patch }).then(setState)
  }
  const preset = DELEGATION_PRESETS.find((p) => p.id === c.preset) ?? DELEGATION_PRESETS[0]
  const custom = draft ?? c.custom

  return (
    <>
      <button
        className={`pill sb-btn sb-deleg ${c.on ? 'on' : ''}`}
        role="switch"
        aria-checked={c.on}
        data-debug-click="bar-delegate"
        title={acc?.state === 'error' ? `${TIP}\n${acc.file} 에 쓰지 못했어요: ${acc.error}` : TIP}
        onClick={() => save({ on: !c.on })}
      >
        <span className="sb-deleg-mark" aria-hidden="true">
          {c.on && <IconCheck size={11} />}
        </span>
        멀티 에이전트
      </button>
      <Popover
        className="pill sb-btn sb-model"
        label={
          <>
            {preset.label}
            <IconChevron dir="down" size={12} className="sb-caret" />
          </>
        }
        title="어떤 방식으로 나눠 맡길지"
        ariaLabel="멀티 에이전트 방식"
        // wide enough that every preset's label and hint share one line (`계획 → 분담 → 검토` with
        // `나눠 맡긴 뒤 검토 에이전트가 확인` is the longest pair); at 332 the hints wrapped under the labels
        width={400}
        disabled={!c.on}
        debugClick="bar-delegate-preset"
      >
        {() => (
          <div className="pop-body">
            <div className="pop-head">멀티 에이전트 방식</div>
            <div className="sb-model-list" role="group" aria-label="방식">
              {DELEGATION_PRESETS.map((p) => {
                const on = p.id === c.preset
                return (
                  <button
                    key={p.id}
                    className={`pop-check ${on ? 'is-on' : ''}`}
                    role="menuitemradio"
                    aria-checked={on}
                    data-debug-click={`bar-delegate-${p.id}`}
                    onClick={() => save({ preset: p.id })}
                  >
                    <span className="pop-tick">{on && <IconCheck size={14} />}</span>
                    <span className="pop-label">{p.label}</span>
                    <span className="dim">{p.hint}</span>
                  </button>
                )
              })}
            </div>
            {c.preset === 'custom' && (
              <textarea
                className="sb-deleg-custom"
                value={custom}
                placeholder="예: 부분이 셋 이상이면 서브에이전트로 나눠서 병렬로 하고, 끝나면 합쳐서 보고해"
                aria-label="직접 쓴 지시문"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  if (draft !== null && draft !== c.custom) save({ custom: draft })
                  setDraft(null)
                }}
                onKeyDown={(e) => e.stopPropagation()}
              />
            )}
            <div className="pop-field">
              <span>동시 에이전트</span>
              <span className="seg" role="radiogroup" aria-label="동시에 띄우는 서브에이전트 수">
                {DELEGATION_CAPS.map((n) => (
                  <button key={n} className={`seg-btn ${c.cap === n ? 'is-on' : ''}`} role="radio" aria-checked={c.cap === n} onClick={() => save({ cap: n })}>
                    {n === 0 ? '제한 없음' : n}
                  </button>
                ))}
              </span>
            </div>
            <p className="pop-note">{NOTE}</p>
            {acc?.state === 'error' && (
              <p className="pop-note warn-line" title={acc.file}>
                {acc.file} 에 쓰지 못했어요: {acc.error}
              </p>
            )}
          </div>
        )}
      </Popover>
    </>
  )
}
