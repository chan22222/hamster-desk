import { useEffect, useState } from 'react'
import { Popover } from './Popover'

type ImplEffort = 'xhigh' | 'max' | 'ultracode'
type HarnessScope = 'app' | 'global'
interface HarnessState {
  on: boolean
  config: { implEffort: ImplEffort; scope: HarnessScope; on: boolean }
  foreignAgent: string | null
}

/**
 * One switch: design stays on the user's model and effort; implementation goes to the newest Opus
 * at the chosen strength. By default only the terminals this app opens are affected — their shell
 * defines a `claude` wrapper that adds `--agent hd-architect`, so the next `claude` picks it up and
 * other terminals stay untouched. 'global' restores the old settings.json behaviour.
 */
export function HarnessPill() {
  const [st, setSt] = useState<HarnessState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (window.desk) void window.desk.harness.state().then(setSt)
  }, [])

  if (!st) return null

  const toggle = async (): Promise<void> => {
    if (!window.desk) return
    setBusy(true)
    try {
      setSt(st.on ? await window.desk.harness.disable() : await window.desk.harness.enable(st.config))
    } finally {
      setBusy(false)
    }
  }

  // While on, any config change is re-applied at once (agent files rewritten, scope re-claimed).
  const update = async (patch: { implEffort?: ImplEffort; scope?: HarnessScope }): Promise<void> => {
    if (!window.desk) return
    const config = { ...st.config, ...patch }
    setSt({ ...st, config })
    if (st.on) setSt(await window.desk.harness.enable(config))
    else setSt(await window.desk.harness.saveConfig(config))
  }

  return (
    <Popover
      className={`pill ${st.on ? 'on' : ''}`}
      title="설계는 내 모델, 구현은 Opus 최신. 이 앱에서 여는 claude 에만 적용"
      label={
        <>
          <span className={`pill-dot ${st.on ? 'is-on' : ''}`} />
          협업
        </>
      }
    >
      {(close) => (
        <div className="pop-body">
          <p>설계 담당은 지금 쓰는 모델·effort 그대로입니다.</p>
          <p>구현 담당은 최신 Opus 가 맡고, 코드 변경은 전부 그쪽으로 넘어갑니다.</p>
          <p>
            이 앱에서 여는 <code>claude</code> 에만 적용돼요. 다른 터미널의 claude 는 그대로. 켜고 끄면 다음 <code>claude</code> 실행부터.
          </p>
          <label className="pop-field">
            구현 강도
            <select value={st.config.implEffort} onChange={(e) => void update({ implEffort: e.target.value as ImplEffort })}>
              <option value="xhigh">xhigh</option>
              <option value="max">max</option>
              <option value="ultracode">ultracode (max · 병렬)</option>
            </select>
          </label>
          <div className="pop-scope" role="radiogroup" aria-label="적용 범위">
            <span className="pop-head">적용 범위</span>
            <label>
              <input type="radio" name="hd-scope" checked={st.config.scope !== 'global'} onChange={() => void update({ scope: 'app' })} />
              이 앱의 터미널만 <span className="dim">(기본)</span>
            </label>
            <label>
              <input type="radio" name="hd-scope" checked={st.config.scope === 'global'} onChange={() => void update({ scope: 'global' })} />
              모든 claude 세션 <span className="dim">(settings.json 의 agent 설정)</span>
            </label>
          </div>
          {st.config.scope === 'global' && !st.on && st.foreignAgent && (
            <p className="warn-line">settings.json 에 이미 agent=&quot;{st.foreignAgent}&quot; 가 있어요. 켜는 동안 잠시 교체하고, 끄면 되돌립니다.</p>
          )}
          <button
            className={st.on ? 'pop-ghost' : 'pop-primary'}
            disabled={busy}
            onClick={() => {
              void toggle()
              close()
            }}
          >
            {st.on ? '끄기' : '켜기'}
          </button>
        </div>
      )}
    </Popover>
  )
}
