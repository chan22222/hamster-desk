// The in-app fallback for when the app's own notification window could not be made (plan §3.1).
//
// This component is also what *installs* the notifier: App.tsx is frozen and already renders a
// `<Banner/>`, so importing `./notifier` here is how the store subscription gets set up — no extra
// slot, no edit to App.tsx.

import { useSyncExternalStore } from 'react'
import './notify.css'
import { useUi } from '../i18n'
import { IconChevron, IconClose } from '../widgets/icons'
import { KIND_PATHS, kindOf, type NotifyKind } from './kind'
import { bannerSnapshot, dismissBanner, openNotifyTarget, subscribeBanner } from './notifier'

/** the kind's mark, in the icon set's frame — the popup card draws the same paths (src/toast/toast.ts) */
function KindIcon({ kind }: { kind: NotifyKind }) {
  return (
    <svg className="nb-kind" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {KIND_PATHS[kind].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

export function Banner() {
  const u = useUi()
  const item = useSyncExternalStore(subscribeBanner, bannerSnapshot, bannerSnapshot)
  if (!item) return null
  const kind = kindOf(item.tag)
  return (
    <div className={`notify-banner is-${kind}`} role="status" aria-live="polite">
      <button
        className="nb-main"
        data-debug-click="notify-banner"
        title={item.reason === 'unsupported' ? u.toast.unsupported : u.toast.failed}
        onClick={() => {
          openNotifyTarget(item.tab, item.ptyId)
          dismissBanner()
        }}
      >
        <KindIcon kind={kind} />
        <span className="nb-title">{item.title}</span>
        <span className="nb-body">{item.body}</span>
        <IconChevron size={14} className="nb-go" />
      </button>
      <button className="nb-x" aria-label={u.toast.closeNotification} title={u.toast.close} onClick={dismissBanner}>
        <IconClose size={12} />
      </button>
    </div>
  )
}
