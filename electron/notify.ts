// OS notifications: one Windows toast plus a blinking taskbar button, raised by the renderer
// (src/notify/notifier.ts) only while the window is in the background. Plan §3.1.
//
// Windows files a toast under an Application User Model ID. A packaged app gets one from its
// Start-menu shortcut; an app started from `node_modules/electron/electron.exe` has none of its
// own, and what the shell does with that varies by machine — hence the three variants below and
// the `HAMSTER_NOTIFY_PROBE` run in main.ts that tries each one and prints the result (R1).
// Whatever the toast does, `flashFrame` still works, and a `failed` result sends the renderer to
// its in-app banner, so the notification is never silently lost.

import { app, Notification } from 'electron'
import type { BrowserWindow } from 'electron'
import type { NotifyRequest, NotifyResult } from '../shared/events'

/** The id the portable build registers under (electron-builder `appId`); keep the two in step. */
export const PACKAGED_AUMID = 'kr.amag.hamsterdesk'

/** The three things an AUMID can be, in the order the probe tries them. */
export type AumidVariant = 'none' | 'app' | 'exec'

export const AUMID_VARIANTS: AumidVariant[] = ['none', 'app', 'exec']

/** What `variant` resolves to, or `null` for "leave the id alone". */
export function aumidFor(variant: AumidVariant): string | null {
  if (variant === 'app') return PACKAGED_AUMID
  if (variant === 'exec') return process.execPath
  return null
}

/**
 * The id this run uses: `HAMSTER_AUMID` first (a variant name or a literal id), then the packaged
 * app id, then the exe that started us. One place to change once the probe says which one works.
 */
export function appUserModelId(packaged: boolean): string {
  const env = process.env.HAMSTER_AUMID
  if (env) return aumidFor(env as AumidVariant) ?? env
  return packaged ? PACKAGED_AUMID : process.execPath
}

/**
 * How long to wait for the OS to say what it did with the toast. Electron emits `show` when it is
 * on screen and `failed` when Windows refused it; a machine that emits neither is treated as a
 * refusal, because the one thing the user must not get is silence.
 */
const SETTLE_MS = 2500

const capture = (): boolean => !!process.env.HAMSTER_CAPTURE

/**
 * debug/e2e: `HAMSTER_NOTIFY_FAIL=1` answers every request with `'failed'` without showing
 * anything, which is the only way to photograph the in-app banner on a PC whose toasts work.
 * Inert in a packaged build, like every other knob in §2.6.
 */
const forcedFailure = (): boolean => !app.isPackaged && process.env.HAMSTER_NOTIFY_FAIL === '1'

/**
 * Show one OS notification for `req` and report what happened. `'unsupported'` means this
 * OS/build cannot show toasts at all, so the renderer falls back to the in-app banner.
 *
 * The toast is always silent: the renderer owns the sound (`prefs.notify.sound`), so one setting
 * decides it for both the toast and the banner.
 */
export async function showNotification(req: NotifyRequest, win: BrowserWindow | null): Promise<NotifyResult> {
  // the taskbar button blinks whatever the toast ends up doing — it is the fallback that never fails
  try {
    if (win && !win.isDestroyed()) win.flashFrame(true)
  } catch {
    /* flashing is decoration; never let it take a notification down */
  }
  if (!Notification.isSupported()) {
    if (capture()) console.log(`[notify] unsupported tag=${req.tag}`)
    return 'unsupported'
  }
  if (forcedFailure()) {
    if (capture()) console.log(`[notify] result=failed tag=${req.tag} (forced)`)
    return 'failed'
  }
  if (capture()) console.log(`[notify] show tag=${req.tag} tab=${req.tab}`)

  let n: Notification
  try {
    n = new Notification({ title: req.title, body: req.body, silent: true })
  } catch {
    if (capture()) console.log(`[notify] result=failed tag=${req.tag}`)
    return 'failed'
  }

  n.on('click', () => {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('notify:click', req.tab)
    if (capture()) console.log(`[notify] click tag=${req.tag} tab=${req.tab}`)
  })

  const result = await new Promise<NotifyResult>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let done = false
    const settle = (r: NotifyResult): void => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve(r)
    }
    timer = setTimeout(() => settle('failed'), SETTLE_MS)
    n.on('show', () => settle('shown'))
    n.on('failed', () => settle('failed'))
    try {
      n.show()
    } catch {
      settle('failed')
    }
  })
  if (capture()) console.log(`[notify] result=${result} tag=${req.tag}`)
  return result
}
