// Notifications while the window is in the background, raised by the renderer
// (src/notify/notifier.ts, plan §3.1): the taskbar button blinks and a small window of the app's
// own shows the title and body (electron/toast-window.ts).
//
// This used to be a Windows toast. Windows takes the toast — Electron's `show` event fires, the
// app is filed under `Notifications\Settings` — and then, under Do Not Disturb ("priority only",
// which Windows 11 switches on by itself for a full-screen app or a duplicated display), puts it
// in the notification centre without a banner and without a word to the app. So the `failed`
// path to the in-app banner never ran, and the user saw the taskbar blink and nothing else. The
// popup window is on screen whatever the OS settings say; the banner stays as the fallback for
// the one case the popup cannot be created.

import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { NotifyRequest, NotifyResult } from '../shared/events'
import type { ToastHost } from './toast-window'

const capture = (): boolean => !!process.env.HAMSTER_CAPTURE

/**
 * debug/e2e: `HAMSTER_NOTIFY_FAIL=1` answers every request with `'failed'` without showing
 * anything, which is the only way to photograph the in-app banner. Inert in a packaged build,
 * like every other knob in §2.6.
 */
const forcedFailure = (): boolean => !app.isPackaged && process.env.HAMSTER_NOTIFY_FAIL === '1'

/** What a clicked notification does: the window comes to the front and the renderer opens its tab. */
export function openFromNotification(win: BrowserWindow | null, tab: string): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send('notify:click', tab)
  if (capture()) console.log(`[notify] click tab=${tab}`)
}

/**
 * Show one notification for `req` and report what happened. `'failed'` sends the renderer to its
 * in-app banner. The popup is always silent: the renderer owns the sound (`prefs.notify.sound`),
 * so one setting decides it for the popup and the banner alike.
 */
export function showNotification(req: NotifyRequest, win: BrowserWindow | null, popup: ToastHost): NotifyResult {
  // the taskbar button blinks whatever the popup ends up doing — it is the fallback that never fails
  try {
    if (win && !win.isDestroyed()) win.flashFrame(true)
  } catch {
    /* flashing is decoration; never let it take a notification down */
  }
  if (forcedFailure()) {
    if (capture()) console.log(`[notify] result=failed tag=${req.tag} (forced)`)
    return 'failed'
  }
  if (capture()) console.log(`[notify] show tag=${req.tag} tab=${req.tab}`)
  const result: NotifyResult = popup.show(req, req.theme) ? 'shown' : 'failed'
  if (capture()) console.log(`[notify] result=${result} tag=${req.tag}`)
  return result
}
