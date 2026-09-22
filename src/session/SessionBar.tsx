// The strip above the terminal: model (a dropdown), effort, context, /compact, /clear, past
// conversations.
// Plan §3.5. Owner: B.
//
// Everything on this bar is a slash command typed into the TUI that is already running — there is
// no API behind it. Two consequences shape the code:
//
//   1. Every command is prefixed with \x15 (Ctrl+U, "clear the input line"), because the user may
//      have left half a sentence sitting at the prompt and `/compact` appended to it is neither.
//   2. While Claude Code is asking something of its own (a permission prompt, a question), the
//      input line does not belong to us at all. `ptyWaiting` is exactly that state, and the whole
//      bar goes disabled for as long as it lasts.

import type { ReactNode } from 'react'
import { DEFAULT_PROFILE_ID, EFFORT_LEVELS, type EffortLevel } from '@shared/events'
import { modelSkin } from '../desk/skins'
import { useUi } from '../i18n'
import { runInTerminal, useDesk, type SessionState, type Workspace } from '../store'
import { IconCheck, IconChevron } from '../widgets/icons'
import { Popover } from '../widgets/Popover'
import { termLog } from '../term/search'
import { ContextMeter, contextPct } from './ContextMeter'
import { DelegationControl } from './Delegation'
import { MODEL_CHOICES, modelAliasOf } from './models'
import { TranscriptList } from './TranscriptList'
import './session.css'

// Every word on the bar is read from the dictionary at render time (`useUi`), so a language change
// applies to the open bar. Two of them say something the CLI itself says:
//   - `session.effortTip`: `/effort` is not per-session — the CLI answers "saved as your default
//     for new sessions", so the tooltip says so;
//   - `session.savedDefault`: `/model` does the same ("Model set to … and saved as your default
//     for new sessions"), so the same line.

/** One plain button on the bar; `pill` keeps it the same shape as everything in the top bar. */
function BarButton({
  name,
  label,
  title,
  alert,
  disabled,
  onClick,
}: {
  name: string
  label: ReactNode
  title: string
  alert?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button className={`pill sb-btn ${alert ? 'alert' : ''}`} data-debug-click={name} title={title} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  )
}

export function SessionBar({ ws, session }: { ws: Workspace | null; session: SessionState | null }) {
  const u = useUi()
  const ptyWaiting = useDesk((s) => s.ptyWaiting)
  const setSessionEffort = useDesk((s) => s.setSessionEffort)
  const setSessionModel = useDesk((s) => s.setSessionModel)

  // the bar belongs to a terminal that has a claude in it; every other tab shows nothing
  if (!ws || ws.ptyId === null || !session) return null
  const ptyId = ws.ptyId
  const waiting = !!ptyWaiting[ptyId]
  const busy = session.info.status === 'busy'
  const mine = session.info.mine
  const off = waiting || !mine

  /** Clear whatever is on the input line, then type the command and run it. */
  const run = (cmd: string): void => {
    const text = `\x15${cmd}`
    // capture runs only: the exact bytes, said here as well as in HAMSTER_PTY_LOG's `>> ` lines
    // (JSON keeps the \u0015 visible). The Enter is `runInTerminal`'s, and arrives as its own chunk.
    termLog(`[bar] send ${JSON.stringify(text)} pty=${ptyId}`)
    runInTerminal(ptyId, text)
  }

  const pct = contextPct(session)
  const model = modelSkin(session.model).label || u.session.model
  const alias = modelAliasOf(session.model)
  const effort = session.effort
  const { waiting: waitingNote, nextTurn, noStatus, effortTip, savedDefault } = u.session
  const modelTip = `${u.session.modelTip(session.model ?? u.common.unknown)}\n${savedDefault}`

  return (
    <div className={`session-bar ${waiting ? 'is-waiting' : ''}`} title={waiting ? waitingNote : pct === null ? noStatus : undefined}>
      {/* `/model <alias>` does more than change this session: Claude Code writes the choice back as
          the user's saved default model, exactly as `/effort` does. Until 0.1.13 that kept the model
          off the bar; now the tooltip and the menu's last line say it, and the effort segment set the
          precedent. Only the four family aliases are offered — src/session/models.ts says why. */}
      <Popover
        className="pill sb-btn sb-model"
        label={
          <>
            <span className="sb-model-name">{model}</span>
            <IconChevron dir="down" size={12} className="sb-caret" />
          </>
        }
        title={busy ? `${modelTip}\n${nextTurn}` : modelTip}
        ariaLabel={u.session.changeModel}
        width={236}
        disabled={off}
        debugClick="bar-model"
      >
        {(close) => (
          <div className="pop-body">
            <div className="pop-head">{u.session.modelHead}</div>
            <div className="sb-model-list" role="group" aria-label={u.session.model}>
              {MODEL_CHOICES.map((c) => {
                const on = c.alias === alias
                return (
                  <button
                    key={c.alias}
                    className={`pop-check ${on ? 'is-on' : ''}`}
                    role="menuitemradio"
                    aria-checked={on}
                    data-debug-click={`bar-model-${c.alias}`}
                    onClick={() => {
                      close()
                      run(`/model ${c.alias}`)
                      setSessionModel(session.info.sessionId, c.id)
                    }}
                  >
                    <span className="pop-tick">{on && <IconCheck size={14} />}</span>
                    <span className="pop-label">{modelSkin(c.id).label}</span>
                    <span className="dim">{u.session.modelHints[c.alias]}</span>
                  </button>
                )
              })}
            </div>
            <p className="pop-note">{busy ? `${savedDefault} ${nextTurn}` : savedDefault}</p>
          </div>
        )}
      </Popover>

      <span className="sb-sep" />

      <span className="seg sb-effort" role="radiogroup" aria-label={u.session.effortLabel} title={busy ? `${effortTip}\n${nextTurn}` : effortTip}>
        {EFFORT_LEVELS.map((lv: EffortLevel) => (
          <button
            key={lv}
            className={`seg-btn ${effort === lv ? 'is-on' : ''}`}
            role="radio"
            aria-checked={effort === lv}
            data-debug-click={`bar-effort-${lv}`}
            disabled={off}
            onClick={() => {
              run(`/effort ${lv}`)
              setSessionEffort(session.info.sessionId, lv)
            }}
          >
            {lv}
          </button>
        ))}
      </span>

      <span className="sb-sep" />

      {/* not a slash command: it edits the account's CLAUDE.md, so it stays live while a prompt waits */}
      <DelegationControl profileId={ws.profileId ?? DEFAULT_PROFILE_ID} />

      {waiting && <span className="sb-note">{waitingNote}</span>}

      <span className="sb-gap" />

      <ContextMeter session={session} />
      {pct !== null && pct >= 90 && <span className="sb-hint">{u.session.compactHint}</span>}

      <BarButton
        name="bar-compact"
        label="/compact"
        title={pct !== null && pct >= 70 ? u.session.compactTipFull(Math.round(pct)) : u.session.compactTip}
        alert={pct !== null && pct >= 70}
        disabled={off}
        onClick={() => run('/compact')}
      />

      <Popover className="pill sb-btn" label="/clear" title={u.session.clearTip} ariaLabel={u.session.clearLabel} width={236} disabled={off} debugClick="bar-clear">
        {(close) => (
          <div className="pop-body">
            <p>{u.session.clearNote}</p>
            <button
              className="pop-primary"
              data-debug-click="bar-clear-yes"
              onClick={() => {
                close()
                run('/clear')
              }}
            >
              {u.session.clear}
            </button>
          </div>
        )}
      </Popover>

      {/* 360 rather than 320: the `--continue` row at the bottom of the list has to hold its English wording on one line */}
      <Popover className="pill sb-btn" label={u.session.history} title={u.session.historyTip} ariaLabel={u.session.history} width={360} debugClick="bar-history">
        {(close) => <TranscriptList cwd={ws.cwd} profileId={ws.profileId} onPick={close} />}
      </Popover>
    </div>
  )
}
