// The bridge of the notification window (electron/toast-window.ts ↔ src/toast/toast.ts). It is
// its own preload rather than a corner of electron/preload.ts because that one hands the page the
// whole app — pty, settings, accounts — and a window that only draws three cards has no business
// holding any of it.

import { contextBridge, ipcRenderer } from 'electron'
import type { ToastItem } from './toast-stack'

export interface ToastState {
  /** oldest first; the page draws them top to bottom */
  items: ToastItem[]
  /** the palette the app is painted with right now */
  theme: 'light' | 'dark'
}

export interface ToastBridge {
  /** the page is up and can take a state; main answers with the current one */
  ready(): void
  onState(cb: (s: ToastState) => void): void
  /** the user clicked a card: open what it is about */
  click(id: number): void
  /** the small × on a card */
  close(id: number): void
}

// no hover message: main reads the pointer against the window itself (electron/toast-window.ts)
const bridge: ToastBridge = {
  ready: () => ipcRenderer.send('toast:ready'),
  onState(cb) {
    ipcRenderer.on('toast:state', (_e, s: ToastState) => cb(s))
  },
  click: (id) => ipcRenderer.send('toast:click', id),
  close: (id) => ipcRenderer.send('toast:close', id),
}

contextBridge.exposeInMainWorld('toast', bridge)
