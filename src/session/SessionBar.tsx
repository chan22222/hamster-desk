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
//
// The bar is one line whatever the column's width, so it gives things up as the column narrows
// (session.css, `@container panes`): the effort segments fold into a dropdown like the model's,
// then `멀티 에이전트` keeps only its box, then `/compact` · `/clear` · `지난 대화` go into one `⋯`.
// Both forms of each are always in the DOM and the stylesheet shows one; whatever still does not
// fit scrolls sideways (src/widgets/hscroll.ts).
//
// A terminal with no claude in it gets the same 32px line with the way in: `▶ claude`, the past
// conversations of its folder, `--continue` — all typed into *this* terminal, like the studio's
// welcome card. It also keeps the terminal from jumping 32px whenever claude starts or exits.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_PROFILE_ID, EFFORT_LEVELS, type EffortLevel } from '@shared/events'
import { modelSkin } from '../desk/skins'
import { useUi } from '../i18n'
import { runInTerminal, useDesk, type SessionState, type Workspace } from '../store'
import { IconCheck, IconChevron, IconMore, IconPlay } from '../widgets/icons'
import { Popover } from '../widgets/Popover'
import { tabbables } from '../widgets/focus'
import { useHScroll } from '../widgets/hscroll'
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
  className = '',
  onClick,
}: {
  name: string
  label: ReactNode
  title: string
  alert?: boolean
  disabled?: boolean
  className?: string
  onClick: () => void
}) {
  return (
    <button className={`pill sb-btn ${className} ${alert ? 'alert' : ''}`} data-debug-click={name} title={title} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  )
}

/** The line itself: one row that scrolls sideways when it has to, with a fade at the end that hides something. */
function Bar({ className, title, children }: { className: string; title?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useHScroll(ref)
  return (
    <div ref={ref} className={className} title={title}>
      {children}
    </div>
  )
}

/** A menu's rows of exclusive choices (`role="menu"`, one Tab stop, ↑ ↓ between them — src/widgets/Popover.tsx). */
function ChoiceRow({ on, label, hint, debugClick, onPick }: { on: boolean; label: string; hint?: string; debugClick: string; onPick: () => void }) {
  return (
    <button className={`pop-check ${on ? 'is-on' : ''}`} role="menuitemradio" aria-checked={on} data-debug-click={debugClick} onClick={onPick}>
      <span className="pop-tick">{on && <IconCheck size={14} />}</span>
      <span className="pop-label">{label}</span>
      {hint && <span className="dim">{hint}</span>}
    </button>
  )
}

/**
 * `/compact` · `/clear` · `지난 대화` in one `⋯`, for a column too narrow to hold them side by side.
 * `/clear` still asks first and `지난 대화` is still the whole list: each turns the panel into what
 * its own button opens, and the panel widens to the list's 360px for the second.
 */
function BarMore({ ws, off, alert, compactTip, run }: { ws: Workspace; off: boolean; alert: boolean; compactTip: string; run: (cmd: string) => void }) {
  const u = useUi()
  const [view, setView] = useState<'menu' | 'clear' | 'history'>('menu')
  const body = useRef<HTMLDivElement>(null)
  // a view that replaces the menu takes the focus the menu row had
  useEffect(() => {
    const el = body.current
    if (el && view !== 'menu') tabbables(el)[0]?.focus()
  }, [view])
  return (
    <Popover
      className={`pill sb-btn sb-more ${alert ? 'alert' : ''}`}
      label={<IconMore size={14} />}
      title={u.session.more}
      ariaLabel={u.session.more}
      width={view === 'history' ? 360 : 236}
      debugClick="bar-more"
      onOpenChange={(open) => {
        if (!open) setView('menu')
      }}
    >
      {(close) => (
        <div ref={body}>
          {view === 'menu' && (
            <div className="pop-body">
              <div className="sb-model-list" role="menu" aria-label={u.session.more}>
                <button className="pop-item" role="menuitem" disabled={off} title={compactTip} data-debug-click="bar-more-compact" onClick={() => {
                  close()
                  run('/compact')
                }}>
                  /compact
                </button>
                <button className="pop-item" role="menuitem" disabled={off} title={u.session.clearTip} data-debug-click="bar-more-clear" onClick={() => setView('clear')}>
                  /clear
                </button>
                <button className="pop-item" role="menuitem" title={u.session.historyTip} data-debug-click="bar-more-history" onClick={() => setView('history')}>
                  <span className="pop-label">{u.session.history}</span>
                  <IconChevron dir="right" size={12} className="dim" />
                </button>
              </div>
            </div>
          )}
          {view === 'clear' && (
            <div className="pop-body">
              <p>{u.session.clearNote}</p>
              <button
                className="pop-primary"
                data-debug-click="bar-more-clear-yes"
                onClick={() => {
                  close()
                  run('/clear')
                }}
              >
                {u.session.clear}
              </button>
            </div>
          )}
          {view === 'history' && <TranscriptList cwd={ws.cwd} profileId={ws.profileId} onPick={close} />}
        </div>
      )}
    </Popover>
  )
}

/** The bar over a terminal with no claude in it: the ways to start one, typed into this terminal. */
function ShellBar({ ws }: { ws: Workspace }) {
  const u = useUi()
  const ptyId = ws.ptyId
  const run = (cmd: string): void => {
    if (ptyId !== null) runInTerminal(ptyId, cmd)
  }
  const off = ptyId === null
  return (
    <Bar className="session-bar is-shell">
      <button className="pill sb-btn sb-run" data-debug-click="bar-run-claude" disabled={off} title={u.session.runTip} aria-label={u.session.runTip} onClick={() => run('claude')}>
        <IconPlay size={12} />
        claude
      </button>
      <Popover className="pill sb-btn" label={u.session.history} title={u.session.historyHereTip} ariaLabel={u.session.history} width={360} disabled={off} debugClick="bar-shell-history">
        {(close) => <TranscriptList cwd={ws.cwd} profileId={ws.profileId} onPick={close} run={run} />}
      </Popover>
      <BarButton name="bar-continue" label={u.session.continueLabel} title={u.session.continueTip} disabled={off} onClick={() => run('claude --continue')} />
    </Bar>
  )
}

export function SessionBar({ ws, session }: { ws: Workspace | null; session: SessionState | null }) {
  const u = useUi()
  const ptyId = ws?.ptyId ?? null
  // this terminal's flag only: the whole map changes with every prompt anywhere
  const waiting = useDesk((s) => ptyId !== null && !!s.ptyWaiting[ptyId])
  const setSessionEffort = useDesk((s) => s.setSessionEffort)
  const setSessionModel = useDesk((s) => s.setSessionModel)

  // no terminal in front (the start card, a session of another terminal): nothing to act on
  if (!ws) return null
  // a terminal with no claude in it: the way in
  if (ptyId === null || !session) return <ShellBar ws={ws} />
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
  const setEffort = (lv: EffortLevel): void => {
    run(`/effort ${lv}`)
    setSessionEffort(session.info.sessionId, lv)
  }

  const pct = contextPct(session)
  const model = modelSkin(session.model).label || u.session.model
  const alias = modelAliasOf(session.model)
  const effort = session.effort
  const { waiting: waitingNote, nextTurn, noStatus, effortTip, savedDefault } = u.session
  const modelTip = `${u.session.modelTip(session.model ?? u.common.unknown)}\n${savedDefault}`
  const effortTitle = busy ? `${effortTip}\n${nextTurn}` : effortTip
  const full = pct !== null && pct >= 70
  const compactTip = full ? u.session.compactTipFull(Math.round(pct)) : u.session.compactTip

  return (
    <Bar className={`session-bar ${waiting ? 'is-waiting' : ''}`} title={waiting ? waitingNote : pct === null ? noStatus : undefined}>
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
            <div className="sb-model-list" role="menu" aria-label={u.session.model}>
              {MODEL_CHOICES.map((c) => (
                <ChoiceRow
                  key={c.alias}
                  on={c.alias === alias}
                  label={modelSkin(c.id).label}
                  hint={u.session.modelHints[c.alias]}
                  debugClick={`bar-model-${c.alias}`}
                  onPick={() => {
                    close()
                    run(`/model ${c.alias}`)
                    setSessionModel(session.info.sessionId, c.id)
                  }}
                />
              ))}
            </div>
            <p className="pop-note">{busy ? `${savedDefault} ${nextTurn}` : savedDefault}</p>
          </div>
        )}
      </Popover>

      <span className="sb-sep" />

      <span className="seg sb-effort" role="radiogroup" aria-label={u.session.effortLabel} title={effortTitle}>
        {EFFORT_LEVELS.map((lv: EffortLevel) => (
          <button
            key={lv}
            className={`seg-btn ${effort === lv ? 'is-on' : ''}`}
            role="radio"
            aria-checked={effort === lv}
            data-debug-click={`bar-effort-${lv}`}
            disabled={off}
            onClick={() => setEffort(lv)}
          >
            {lv}
          </button>
        ))}
      </span>
      {/* the same five, folded into a dropdown once the column is too narrow for the segments */}
      <Popover
        className="pill sb-btn sb-model sb-effort-dd"
        label={
          <>
            <span className="sb-model-name">{effort ?? u.session.effortLabel}</span>
            <IconChevron dir="down" size={12} className="sb-caret" />
          </>
        }
        title={effortTitle}
        ariaLabel={u.session.effortLabel}
        width={200}
        disabled={off}
        debugClick="bar-effort"
      >
        {(close) => (
          <div className="pop-body">
            <div className="pop-head">{u.session.effortHead}</div>
            <div className="sb-model-list" role="menu" aria-label={u.session.effortLabel}>
              {EFFORT_LEVELS.map((lv: EffortLevel) => (
                <ChoiceRow
                  key={lv}
                  on={effort === lv}
                  label={lv}
                  debugClick={`bar-effort-dd-${lv}`}
                  onPick={() => {
                    close()
                    setEffort(lv)
                  }}
                />
              ))}
            </div>
            <p className="pop-note">{busy ? `${savedDefault} ${nextTurn}` : savedDefault}</p>
          </div>
        )}
      </Popover>

      <span className="sb-sep" />

      {/* not a slash command: it edits the account's CLAUDE.md, so it stays live while a prompt waits */}
      <DelegationControl profileId={ws.profileId ?? DEFAULT_PROFILE_ID} />

      {waiting && <span className="sb-note">{waitingNote}</span>}

      <span className="sb-gap" />

      <ContextMeter session={session} />
      {pct !== null && pct >= 90 && <span className="sb-hint">{u.session.compactHint}</span>}

      <BarButton name="bar-compact" className="sb-cmd" label="/compact" title={compactTip} alert={full} disabled={off} onClick={() => run('/compact')} />

      <Popover className="pill sb-btn sb-cmd" label="/clear" title={u.session.clearTip} ariaLabel={u.session.clearLabel} width={236} disabled={off} debugClick="bar-clear">
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
      <Popover className="pill sb-btn sb-cmd" label={u.session.history} title={u.session.historyTip} ariaLabel={u.session.history} width={360} debugClick="bar-history">
        {(close) => <TranscriptList cwd={ws.cwd} profileId={ws.profileId} onPick={close} />}
      </Popover>

      <BarMore ws={ws} off={off} alert={full} compactTip={compactTip} run={run} />
    </Bar>
  )
}
