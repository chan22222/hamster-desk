// The app's own notification window: a small frameless, transparent, always-on-top window in the
// bottom-right corner of the primary display that shows up to three cards (title + body) in the
// app's own look, without ever taking focus from whatever the user is doing.
//
// Why a window of our own and not the Windows toast: Windows accepts a toast — Electron gets its
// `show` event — and then, under Do Not Disturb ("priority only", which Windows 11 turns on by
// itself for full-screen apps, duplicated displays and the like), files it in the notification
// centre without drawing a banner. Nothing tells the app, so the `failed`-keyed banner fallback
// never fired either, and the user saw the taskbar blink and nothing else. A window we draw
// ourselves is on screen whatever the OS settings say. electron/toast-stack.ts holds the pure
// part (which cards, how long, where); this file is the BrowserWindow around it.
//
// One window, resized to fit the cards, rather than one per card or one fixed at the largest
// size: a transparent window still takes every click that lands on it, so an invisible rectangle
// sitting over the corner would swallow clicks meant for the desktop or another app.

import { BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'node:path'
import type { NotifyRequest } from '../shared/events'
import { ToastStack, toastBounds, type Rect, type ToastItem } from './toast-stack'
import type { ToastState } from './toast-preload'

export type ToastTheme = ToastState['theme']

/** how often the pointer is checked against the window while cards are up */
const HOVER_POLL_MS = 250

export interface ToastHostOptions {
  /** the user clicked a card */
  onClick(item: ToastItem): void
  /** a window that owns the corner right now (the mini window), or null */
  avoid(): Rect | null
  /** tag lines on stdout in a capture run */
  log?(line: string): void
}

export class ToastHost {
  private win: BrowserWindow | null = null
  private pageReady = false
  private readonly stack = new ToastStack()
  private timer: ReturnType<typeof setTimeout> | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  /** what the renderer last said it is painted with; until it says, the OS palette (main.ts makes the host before `ready`) */
  private theme: ToastTheme | null = null
  private disposed = false

  constructor(private readonly opts: ToastHostOptions) {
    // one set of handlers for the process; each checks the sender is our page
    ipcMain.on('toast:ready', (e) => {
      if (!this.isOurs(e.sender)) return
      this.pageReady = true
      this.render()
    })
    ipcMain.on('toast:click', (e, id: number) => {
      if (!this.isOurs(e.sender)) return
      const item = this.stack.remove(Number(id))
      this.render()
      if (item) {
        this.opts.log?.(`[notify] popup click tag=${item.tag} tab=${item.tab}`)
        this.opts.onClick(item)
      }
    })
    ipcMain.on('toast:close', (e, id: number) => {
      if (!this.isOurs(e.sender)) return
      const item = this.stack.remove(Number(id))
      if (item) this.opts.log?.(`[notify] popup close tag=${item.tag}`)
      this.render()
    })
  }

  /** Put one card up. False when the window could not be made — the renderer shows its banner then. */
  show(req: NotifyRequest, theme?: ToastTheme): boolean {
    if (this.disposed) return false
    if (theme) this.theme = theme
    try {
      this.ensureWindow()
    } catch (err) {
      this.opts.log?.(`[notify] popup failed: ${String(err)}`)
      return false
    }
    const { dropped } = this.stack.push({ title: req.title, body: req.body, tag: req.tag, tab: req.tab }, Date.now())
    this.opts.log?.(`[notify] popup show tag=${req.tag} n=${this.stack.size}${dropped.length ? ` dropped=${dropped.length}` : ''}`)
    this.render()
    return true
  }

  /** Every card goes: the user is looking at the window now, which is what the cards asked for. */
  dismissAll(): void {
    if (this.stack.size === 0) return
    this.stack.clear()
    this.render()
  }

  /** The window, for a capture run to photograph; null while there is nothing to show. */
  window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  /** Close for good — the main window went away. */
  dispose(): void {
    this.disposed = true
    this.stack.clear()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.stopPoll()
    const w = this.win
    this.win = null
    if (w && !w.isDestroyed()) w.destroy()
  }

  private isOurs(sender: WebContents): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.webContents === sender
  }

  private ensureWindow(): void {
    if (this.win && !this.win.isDestroyed()) return
    this.pageReady = false
    const bounds = toastBounds(1, screen.getPrimaryDisplay().workArea, this.opts.avoid())
    const win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      // never takes focus: the user keeps typing wherever they were, and the main window's own
      // "in the background" test (document.hasFocus) is not disturbed by the popup either
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: 'Hamster Desk 알림',
      webPreferences: {
        preload: join(__dirname, '../preload/toast-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // the page only repaints on our messages, and it is never focused: do not let Chromium
        // decide it is in the background and hold a repaint back
        backgroundThrottling: false,
      },
    })
    // above the app's own "always on top" window and the mini window, which are plain topmost
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setMenuBarVisibility(false)
    win.on('closed', () => {
      if (this.win === win) {
        this.win = null
        this.pageReady = false
      }
    })
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl) void win.loadURL(`${devUrl}/toast/toast.html`)
    else void win.loadFile(join(__dirname, '../renderer/toast/toast.html'))
    this.win = win
  }

  /** Push the stack to the page, size the window to it, and (re)arm the expiry timer. */
  private render(): void {
    const win = this.window()
    if (!win) return
    if (this.stack.size === 0) {
      win.hide()
      this.stopPoll()
      this.arm()
      return
    }
    this.startPoll()
    // the window grows upward from its anchored bottom edge, so size it before the page draws the
    // new card — the cards already up stay exactly where they were
    win.setBounds(toastBounds(this.stack.size, screen.getPrimaryDisplay().workArea, this.opts.avoid()))
    if (this.pageReady) {
      const theme: ToastTheme = this.theme ?? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
      win.webContents.send('toast:state', { items: this.stack.items(), theme } satisfies ToastState)
      if (!win.isVisible()) {
        win.showInactive()
        const b = win.getBounds()
        this.opts.log?.(`[notify] popup window ${b.width}x${b.height} at ${b.x},${b.y} theme=${theme}`)
      }
    }
    this.arm()
  }

  /**
   * A hover pauses the clocks. It is read from the pointer's position against the window's bounds
   * rather than from the page's mouseenter/mouseleave: Chromium synthesises mouse events at the
   * last pointer position when a window it never activated is resized or photographed, and one
   * stray `mouseenter` without its `mouseleave` held the cards for ever in a capture run.
   */
  private checkHover(): void {
    const win = this.window()
    if (!win || this.stack.size === 0) {
      this.stopPoll()
      return
    }
    const p = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height
    if (inside === this.stack.paused()) return
    if (inside) this.stack.pause(Date.now())
    else this.stack.resume(Date.now())
    this.opts.log?.(`[notify] popup hover ${inside ? 'on' : 'off'}`)
    this.arm()
  }

  private startPoll(): void {
    if (this.poll) return
    this.poll = setInterval(() => this.checkHover(), HOVER_POLL_MS)
  }

  private stopPoll(): void {
    if (this.poll) clearInterval(this.poll)
    this.poll = null
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const at = this.stack.nextDeadline()
    if (at === null) return
    this.timer = setTimeout(() => {
      this.timer = null
      const gone = this.stack.expire(Date.now())
      for (const g of gone) this.opts.log?.(`[notify] popup expire tag=${g.tag}`)
      if (gone.length) this.render()
      else this.arm()
    }, Math.max(0, at - Date.now()))
  }
}
