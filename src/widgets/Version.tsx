import { useDesk } from '../store'

function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0
  }
  return false
}

/** true when npm has a newer Claude Code than the installed one */
export function useUpdateAvailable(): string | null {
  const v = useDesk((s) => s.version)
  return v?.current && v.latest && newer(v.latest, v.current) ? v.latest : null
}

/** Only appears when there is something to install; runs `claude update` in a new terminal tab. */
export function UpdatePill({ onUpdate }: { onUpdate: () => void }) {
  const latest = useUpdateAvailable()
  if (!latest) return null
  return (
    <button className="pill alert" onClick={onUpdate} title={`claude update 를 새 터미널 탭에서 실행 (→ ${latest})`}>
      업데이트
    </button>
  )
}

/** The "Claude Code" block inside the ⋯ menu. */
export function VersionSection({ onUpdate }: { onUpdate: () => void }) {
  const v = useDesk((s) => s.version)
  const latest = useUpdateAvailable()
  const recheck = (): void => void window.desk?.version.check(true)
  return (
    <>
      <div className="pop-line">
        <span>v{v?.current ?? '?'}</span>
        {v?.error ? <span className="dim"> · 확인 실패</span> : latest ? <span className="dim"> · 새 버전 {latest}</span> : v?.latest ? <span className="ok"> · 최신</span> : null}
      </div>
      <div className="pop-row">
        <button className="pop-ghost" onClick={recheck}>
          다시 확인
        </button>
        {latest && (
          <button className="pop-primary" onClick={onUpdate}>
            업데이트 v{latest} 설치
          </button>
        )}
      </div>
    </>
  )
}
