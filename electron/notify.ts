// OS notifications. Stub: the real implementation (Notification + flashFrame + AUMID probing)
// lands with the window/notification work — see the plan, §3.1. Owner: A.

import type { BrowserWindow } from 'electron'
import type { NotifyRequest, NotifyResult } from '../shared/events'

/**
 * Show one OS notification for `req` and report what happened. `'unsupported'` means this
 * OS/build cannot show toasts at all, so the renderer falls back to the in-app banner.
 */
export async function showNotification(_req: NotifyRequest, _win: BrowserWindow | null): Promise<NotifyResult> {
  return 'unsupported'
}
