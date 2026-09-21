// The in-app fallback for when the OS refuses to show a toast (plan §3.1).
//
// This component is also what *installs* the notifier: App.tsx is frozen and already renders a
// `<Banner/>`, so importing `./notifier` here is how the store subscription gets set up — no extra
// slot, no edit to App.tsx.

import { useSyncExternalStore } from 'react'
import './notify.css'
import { bannerSnapshot, dismissBanner, openNotifyTarget, subscribeBanner } from './notifier'

export function Banner() {
  const item = useSyncExternalStore(subscribeBanner, bannerSnapshot, bannerSnapshot)
  if (!item) return null
  return (
    <div className="notify-banner" role="status" aria-live="polite">
      <button
        className="nb-main"
        data-debug-click="notify-banner"
        title={item.reason === 'unsupported' ? '이 PC 에서는 알림 창을 띄울 수 없어요' : '알림 창을 띄우지 못했어요'}
        onClick={() => {
          openNotifyTarget(item.tab, item.ptyId)
          dismissBanner()
        }}
      >
        <span className="nb-title">{item.title}</span>
        <span className="nb-body">{item.body}</span>
      </button>
      <button className="nb-x" aria-label="알림 닫기" title="닫기" onClick={dismissBanner}>
        ×
      </button>
    </div>
  )
}
