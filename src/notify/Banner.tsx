// The in-app fallback for when the app's own notification window could not be made (plan §3.1).
//
// This component is also what *installs* the notifier: App.tsx is frozen and already renders a
// `<Banner/>`, so importing `./notifier` here is how the store subscription gets set up — no extra
// slot, no edit to App.tsx.

import { useSyncExternalStore } from 'react'
import './notify.css'
import { useUi } from '../i18n'
import { bannerSnapshot, dismissBanner, openNotifyTarget, subscribeBanner } from './notifier'

export function Banner() {
  const u = useUi()
  const item = useSyncExternalStore(subscribeBanner, bannerSnapshot, bannerSnapshot)
  if (!item) return null
  return (
    <div className="notify-banner" role="status" aria-live="polite">
      <button
        className="nb-main"
        data-debug-click="notify-banner"
        title={item.reason === 'unsupported' ? u.toast.unsupported : u.toast.failed}
        onClick={() => {
          openNotifyTarget(item.tab, item.ptyId)
          dismissBanner()
        }}
      >
        <span className="nb-title">{item.title}</span>
        <span className="nb-body">{item.body}</span>
      </button>
      <button className="nb-x" aria-label={u.toast.closeNotification} title={u.toast.close} onClick={dismissBanner}>
        ×
      </button>
    </div>
  )
}
