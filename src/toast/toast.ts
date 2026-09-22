// The notification window's page: draws the cards main sends (electron/toast-window.ts) and
// reports clicks and closes back (hover is main's: it watches the pointer against the window).
// Plain DOM, no React — three cards do not need a framework, and this page has to be up before
// the first card is a second old.
//
// It imports the app's stylesheet for the palette (both token sets, keyed off `data-theme` like
// the main window) and the font stack, so a card here is painted with exactly the app's colours.

import '../styles.css'
import './toast.css'
import type { ToastBridge, ToastState } from '../../electron/toast-preload'
import type { ToastItem } from '../../electron/toast-stack'

declare global {
  interface Window {
    toast?: ToastBridge
  }
}

const bridge = window.toast
const stack = document.getElementById('stack')!

/** what a card is about, for its colour: a request needs the user, a finished turn just tells */
const KIND: Record<ToastItem['tag'], string> = { permission: 'ask', question: 'ask', turn: 'done' }

function card(item: ToastItem): HTMLElement {
  const el = document.createElement('div')
  el.className = `toast-card is-${KIND[item.tag] ?? 'ask'}`
  el.dataset.id = String(item.id)
  el.dataset.tag = item.tag

  const main = document.createElement('button')
  main.className = 'tc-main'
  main.type = 'button'
  main.title = '누르면 그 탭으로 가요'
  const title = document.createElement('span')
  title.className = 'tc-title'
  title.textContent = item.title
  const body = document.createElement('span')
  body.className = 'tc-body'
  body.textContent = item.body
  main.append(title, body)
  main.addEventListener('click', () => bridge?.click(item.id))

  const x = document.createElement('button')
  x.className = 'tc-x'
  x.type = 'button'
  x.setAttribute('aria-label', '알림 닫기')
  x.title = '닫기'
  x.textContent = '×'
  x.addEventListener('click', (e) => {
    e.stopPropagation()
    bridge?.close(item.id)
  })

  el.append(main, x)
  return el
}

function render(s: ToastState): void {
  document.documentElement.dataset.theme = s.theme
  // keep the nodes of the cards that are still there: a card that is being hovered must not be
  // rebuilt under the pointer when a neighbour expires
  const keep = new Map<string, HTMLElement>()
  for (const el of Array.from(stack.children) as HTMLElement[]) keep.set(el.dataset.id ?? '', el)
  const next = s.items.map((item) => keep.get(String(item.id)) ?? card(item))
  stack.replaceChildren(...next)
}

if (bridge) {
  bridge.onState(render)
  bridge.ready()
}
