// "멀티 에이전트" on the session bar: a toggle and, next to it, which harness. Nothing here types into
// the terminal — the choice lands in the account's CLAUDE.md (electron/delegation.ts) and Claude
// reads it at the start of its next session. So unlike everything else on the bar, these two stay
// live while a prompt is waiting, and the note under the menu says when the change takes effect.
//
// Every word is read from the dictionary at render time (`useUi`), so a language change applies to
// the open menu; the preset rows are `delegation.presets[id]`, keyed by the ids in DELEGATION_PRESETS.

import { useEffect, useId, useState } from 'react'
import { DELEGATION_MODELS, DELEGATION_PRESETS, EFFORT_LEVELS, type DelegationConfig, type DelegationEffort, type DelegationModel, type DelegationState } from '@shared/events'
import { modelSkin } from '../desk/skins'
import { useUi, type UiStrings } from '../i18n'
import { IconCheck, IconChevron } from '../widgets/icons'
import { Popover } from '../widgets/Popover'
import { MODEL_CHOICES } from './models'

/** the effort seg's rows: the CLI's own default first, then the levels the session bar offers */
const EFFORTS: readonly DelegationEffort[] = ['inherit', ...EFFORT_LEVELS]

/** the model seg's label: the two relative choices are worded, the four fixed ones wear the family name the model menu shows */
function modelName(m: DelegationModel, d: UiStrings['delegation']): string {
  if (m === 'inherit') return d.modelInherit
  if (m === 'lower') return d.modelLower
  return modelSkin(MODEL_CHOICES.find((c) => c.alias === m)?.id ?? m).label
}

export function DelegationControl({ profileId }: { profileId: string }) {
  const u = useUi()
  const failId = useId()
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
  const d = u.delegation
  const preset = d.presets[c.preset]
  const custom = draft ?? c.custom
  const writeFailed = acc?.state === 'error' ? d.writeFailed(acc.file, acc.error ?? '') : null

  return (
    <>
      {/* In a narrow column the words go and the box stays (session.css), so the name is on the
          button itself as well. A failed write puts a red dot on it: the menu that explains it is
          disabled while the switch is off, and the tooltip alone was easy to never see. */}
      <button
        className={`pill sb-btn sb-deleg ${c.on ? 'on' : ''}`}
        role="switch"
        aria-checked={c.on}
        aria-label={d.label}
        aria-describedby={writeFailed ? failId : undefined}
        data-debug-click="bar-delegate"
        title={writeFailed ? `${d.tip}\n${writeFailed}` : d.tip}
        onClick={() => save({ on: !c.on })}
      >
        <span className="sb-deleg-mark" aria-hidden="true">
          {c.on && <IconCheck size={11} />}
        </span>
        <span className="sb-deleg-text">{d.label}</span>
        {writeFailed && (
          <>
            <span className="sb-deleg-warn" aria-hidden="true" />
            <span id={failId} className="sr-only">
              {writeFailed}
            </span>
          </>
        )}
      </button>
      <Popover
        className="pill sb-btn sb-model"
        label={
          <>
            <span className="sb-model-name">{preset.label}</span>
            <IconChevron dir="down" size={12} className="sb-caret" />
          </>
        }
        title={d.modeTip}
        ariaLabel={d.modeLabel}
        // wide enough that every preset's label and hint share one line: `When needed` with `in parallel
        // only when the parts are independent` is the longest English pair, `계획 → 분담 → 검토` with
        // `나눠 맡긴 뒤 검토 에이전트가 확인` the longest Korean one; at 400 the English hints wrapped
        // under the labels, at 332 the Korean ones did
        width={440}
        disabled={!c.on}
        debugClick="bar-delegate-preset"
      >
        {() => (
          <div className="pop-body">
            <div className="pop-head">{d.modeLabel}</div>
            <div className="sb-model-list" role="menu" aria-label={d.mode}>
              {DELEGATION_PRESETS.map((p) => {
                const on = p.id === c.preset
                const row = d.presets[p.id]
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
                    <span className="pop-label">{row.label}</span>
                    <span className="dim">{row.hint}</span>
                  </button>
                )
              })}
            </div>
            {c.preset === 'custom' && (
              <textarea
                className="sb-deleg-custom"
                value={custom}
                placeholder={d.customPlaceholder}
                aria-label={d.customLabel}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  if (draft !== null && draft !== c.custom) save({ custom: draft })
                  setDraft(null)
                }}
                onKeyDown={(e) => e.stopPropagation()}
              />
            )}
            {/* what the sub-agents run with — the Agent tool's `model` and `effort` options, which the
                block spells out. Six buttons and a label do not share one 440px line in every
                language, so each row stacks its label over the seg (`.sb-deleg-row`, session.css). */}
            <div className="sb-deleg-row">
              <span>{d.model}</span>
              <span className="seg" role="radiogroup" aria-label={d.model}>
                {DELEGATION_MODELS.map((m) => (
                  <button
                    key={m}
                    className={`seg-btn ${c.model === m ? 'is-on' : ''}`}
                    role="radio"
                    aria-checked={c.model === m}
                    data-debug-click={`bar-delegate-model-${m}`}
                    onClick={() => save({ model: m })}
                  >
                    {modelName(m, d)}
                  </button>
                ))}
              </span>
            </div>
            <div className="sb-deleg-row">
              <span>{d.effort}</span>
              <span className="seg" role="radiogroup" aria-label={d.effort}>
                {EFFORTS.map((e) => (
                  <button
                    key={e}
                    className={`seg-btn ${c.effort === e ? 'is-on' : ''}`}
                    role="radio"
                    aria-checked={c.effort === e}
                    data-debug-click={`bar-delegate-effort-${e}`}
                    onClick={() => save({ effort: e })}
                  >
                    {e === 'inherit' ? d.effortInherit : e}
                  </button>
                ))}
              </span>
            </div>
            <p className="pop-note">{d.note}</p>
            {writeFailed && acc && (
              <p className="pop-note warn-line" title={acc.file}>
                {writeFailed}
              </p>
            )}
          </div>
        )}
      </Popover>
    </>
  )
}
