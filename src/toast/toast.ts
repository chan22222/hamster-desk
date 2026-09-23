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
import { uiStringsOf, type UiStrings } from '../../shared/i18n'
import { CLOSE_PATHS, GO_PATHS, KIND_PATHS, kindOf } from '../notify/kind'

declare global {
  interface Window {
    toast?: ToastBridge
  }
}

const bridge = window.toast
const stack = document.getElementById('stack')!

/** the page's few fixed words, in the language each state names — this window reads no preferences of its own */
type Words = UiStrings['toast']

const SVG = 'http://www.w3.org/2000/svg'

/** One icon in the app's icon frame (src/widgets/icons.tsx), built by hand: there is no React here. */
function icon(paths: readonly string[], size: number, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  const attrs: Record<string, string> = {
    class: className,
    width: String(size),
    height: String(size),
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v)
  for (const d of paths) {
    const p = document.createElementNS(SVG, 'path')
    p.setAttribute('d', d)
    svg.append(p)
  }
  return svg
}

function card(item: ToastItem, words: Words): HTMLElement {
  const kind = kindOf(item.tag)
  const el = document.createElement('div')
  // the kind is the colour of the stripe down the left edge and of the icon before the title
  el.className = `toast-card is-${kind}`
  el.dataset.id = String(item.id)
  el.dataset.tag = item.tag

  // the whole card is the button that goes to the tab; the chevron on its right edge says so
  const main = document.createElement('button')
  main.className = 'tc-main'
  main.type = 'button'
  main.title = words.goToTab
  const text = document.createElement('span')
  text.className = 'tc-text'
  const head = document.createElement('span')
  head.className = 'tc-head'
  const title = document.createElement('span')
  title.className = 'tc-title'
  title.textContent = item.title
  head.append(icon(KIND_PATHS[kind], 14, 'tc-kind'), title)
  const body = document.createElement('span')
  body.className = 'tc-body'
  body.textContent = item.body
  text.append(head, body)
  main.append(text, icon(GO_PATHS, 14, 'tc-go'))
  main.addEventListener('click', () => bridge?.click(item.id))

  const x = document.createElement('button')
  x.className = 'tc-x'
  x.type = 'button'
  x.setAttribute('aria-label', words.closeNotification)
  x.title = words.close
  x.append(icon(CLOSE_PATHS, 12, 'tc-x-ico'))
  x.addEventListener('click', (e) => {
    e.stopPropagation()
    bridge?.close(item.id)
  })

  el.append(main, x)
  return el
}

function render(s: ToastState): void {
  document.documentElement.dataset.theme = s.theme
  const words = uiStringsOf(s.lang).toast
  // `lang` on <html> for the fonts Chromium picks for CJK, as the main window does (src/i18n.ts)
  if (s.lang && document.documentElement.lang !== s.lang) document.documentElement.lang = s.lang
  if (document.title !== words.windowTitle) document.title = words.windowTitle
  // keep the nodes of the cards that are still there: a card that is being hovered must not be
  // rebuilt under the pointer when a neighbour expires
  const keep = new Map<string, HTMLElement>()
  for (const el of Array.from(stack.children) as HTMLElement[]) keep.set(el.dataset.id ?? '', el)
  const next = s.items.map((item) => keep.get(String(item.id)) ?? card(item, words))
  stack.replaceChildren(...next)
}

if (bridge) {
  bridge.onState(render)
  bridge.ready()
}
