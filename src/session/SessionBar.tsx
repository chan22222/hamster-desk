// The strip above the terminal: model, effort, context, /compact, /clear, past conversations.
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
import { EFFORT_LEVELS, type EffortLevel } from '@shared/events'
import { modelSkin } from '../desk/skins'
import { runInTerminal, useDesk, type SessionState, type Workspace } from '../store'
import { Popover } from '../widgets/Popover'
import { termLog } from '../term/search'
import { ContextMeter, contextPct } from './ContextMeter'
import { TranscriptList } from './TranscriptList'
import './session.css'

const WAITING = '프롬프트에 답한 뒤 쓸 수 있어요.'
const NEXT_TURN = '지금은 작업 중이라 다음 턴부터 적용돼요.'
const NO_STATUS = '사용량 연동 시 컨텍스트가 보여요.'
/** `/effort` is not per-session: the CLI answers "saved as your default for new sessions", so say so */
const EFFORT_TIP = '노력 수준 (/effort)\nClaude Code 가 새 세션의 기본값으로도 저장해요.'

/** The aliases `/model` takes. `default` is what the CLI itself calls "whatever the account picks". */
const MODELS: { alias: string; label: string }[] = [
  { alias: 'default', label: '기본값' },
  { alias: 'opus', label: 'Opus' },
  { alias: 'sonnet', label: 'Sonnet' },
  { alias: 'haiku', label: 'Haiku' },
]

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
  const ptyWaiting = useDesk((s) => s.ptyWaiting)
  const setSessionEffort = useDesk((s) => s.setSessionEffort)

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
    // capture runs only: HAMSTER_PTY_LOG records what the shell prints, not what it was sent, so
    // the exact bytes are said here (JSON keeps the \u0015 visible). The Enter is `runInTerminal`'s.
    termLog(`[bar] send ${JSON.stringify(text)} pty=${ptyId}`)
    runInTerminal(ptyId, text)
  }

  const pct = contextPct(session)
  const model = modelSkin(session.model).label || '모델'
  const effort = session.effort

  return (
    <div className={`session-bar ${waiting ? 'is-waiting' : ''}`} title={waiting ? WAITING : pct === null ? NO_STATUS : undefined}>
      <Popover
        className="pill sb-btn sb-model"
        label={model}
        title={busy ? NEXT_TURN : `모델: ${session.model ?? '알 수 없음'}\n클릭: /model 로 바꾸기`}
        ariaLabel="모델 바꾸기"
        width={196}
        disabled={off}
        debugClick="bar-model"
      >
        {(close) => (
          <div className="pop-body">
            <div className="pop-head">모델 바꾸기</div>
            {MODELS.map((m) => (
              <button
                key={m.alias}
                className="pop-item"
                data-debug-click={`bar-model-${m.alias}`}
                onClick={() => {
                  run(`/model ${m.alias}`)
                  close()
                }}
              >
                <span className="pop-item-text">
                  <span className="pop-item-name">{m.label}</span>
                  <span className="pop-item-sub dim">/model {m.alias}</span>
                </span>
              </button>
            ))}
            <p className="pop-note">터미널에 명령을 대신 쳐 주는 것뿐이라, 실제로 바뀌었는지는 아래 터미널이 알려 줘요.</p>
          </div>
        )}
      </Popover>

      <span className="sb-sep" />

      <span className="seg sb-effort" role="radiogroup" aria-label="노력 수준" title={busy ? NEXT_TURN : EFFORT_TIP}>
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

      {waiting && <span className="sb-note">{WAITING}</span>}

      <span className="sb-gap" />

      <ContextMeter session={session} />
      {pct !== null && pct >= 90 && <span className="sb-hint">압축 권장</span>}

      <BarButton
        name="bar-compact"
        label="/compact"
        title={pct !== null && pct >= 70 ? `컨텍스트가 ${Math.round(pct)}% 찼어요. 대화를 압축합니다.` : '대화를 압축해 컨텍스트를 비웁니다.'}
        alert={pct !== null && pct >= 70}
        disabled={off}
        onClick={() => run('/compact')}
      />

      <Popover className="pill sb-btn" label="/clear" title="대화를 지우고 새로 시작합니다" ariaLabel="대화 지우기" width={236} disabled={off} debugClick="bar-clear">
        {(close) => (
          <div className="pop-body">
            <p>지금까지의 대화를 지우고 새로 시작해요. 되돌릴 수 없지만, 지난 대화는 파일로 남아 있어 다시 열 수 있어요.</p>
            <button
              className="pop-primary"
              data-debug-click="bar-clear-yes"
              onClick={() => {
                close()
                run('/clear')
              }}
            >
              대화 지우기
            </button>
          </div>
        )}
      </Popover>

      <Popover className="pill sb-btn" label="지난 대화" title="이 폴더에서 나눈 지난 대화 열기" ariaLabel="지난 대화" width={320} debugClick="bar-history">
        {(close) => <TranscriptList cwd={ws.cwd} onPick={close} />}
      </Popover>
    </div>
  )
}
