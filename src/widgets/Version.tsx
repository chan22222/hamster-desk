import { useDesk } from '../store'
import { useUi } from '../i18n'
import { IconDownload, IconRefresh } from './icons'

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
  const u = useUi()
  const latest = useUpdateAvailable()
  if (!latest) return null
  return (
    <button className="pill alert" onClick={onUpdate} title={u.update.claudeUpdateTip(latest)}>
      <IconDownload size={14} />
      {u.update.claudeUpdate}
    </button>
  )
}

/** The "Claude Code" block inside the ⋯ menu. */
export function VersionSection({ onUpdate }: { onUpdate: () => void }) {
  const u = useUi()
  const v = useDesk((s) => s.version)
  const latest = useUpdateAvailable()
  const recheck = (): void => void window.desk?.version.check(true)
  return (
    <>
      <div className="pop-line">
        <span>v{v?.current ?? '?'}</span>
        {v?.error ? <span className="dim">{u.update.checkFailed}</span> : latest ? <span className="dim">{u.update.newVersion(latest)}</span> : v?.latest ? <span className="ok">{u.update.upToDate}</span> : null}
      </div>
      <div className="pop-row">
        <button className="pop-ghost" onClick={recheck}>
          <IconRefresh size={14} />
          {u.common.recheck}
        </button>
        {latest && (
          <button className="pop-primary" onClick={onUpdate}>
            {u.update.installClaude(latest)}
          </button>
        )}
      </div>
    </>
  )
}
