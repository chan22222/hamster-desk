import { useEffect, useState } from 'react'
import { Popover } from './Popover'

type ImplEffort = 'xhigh' | 'max' | 'ultracode'
interface HarnessState {
  on: boolean
  config: { implEffort: ImplEffort }
  foreignAgent: string | null
}

/**
 * One switch: design stays on the user's model and effort; implementation goes to the newest Opus
 * at the chosen strength. Applies to claude sessions started after switching.
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

  const setEffort = async (implEffort: ImplEffort): Promise<void> => {
    if (!window.desk) return
    const config = { ...st.config, implEffort }
    setSt({ ...st, config })
    if (st.on) setSt(await window.desk.harness.enable(config)) // rewrite the agent files
    else await window.desk.harness.saveConfig(config)
  }

  return (
    <Popover
      className={`pill ${st.on ? 'on' : ''}`}
      title="설계는 내 모델, 구현은 Opus 최신. 새 claude 세션부터 적용"
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
          <p>새로 시작하는 claude 세션부터 적용됩니다.</p>
          <label className="pop-field">
            구현 강도
            <select value={st.config.implEffort} onChange={(e) => void setEffort(e.target.value as ImplEffort)}>
              <option value="xhigh">xhigh</option>
              <option value="max">max</option>
              <option value="ultracode">ultracode (max · 병렬)</option>
            </select>
          </label>
          {!st.on && st.foreignAgent && <p className="warn-line">settings.json 에 이미 agent=&quot;{st.foreignAgent}&quot; 가 있어요. 켜는 동안 잠시 교체하고, 끄면 되돌립니다.</p>}
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
