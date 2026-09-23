import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import type { DeskBridge } from '../electron/preload'

declare global {
  interface Window {
    desk?: DeskBridge
  }
}

// A file (or a link) dropped where the page does not take it would navigate the whole window to
// it — Chromium's default — and every tab would go with it. The terminal takes file drops for
// itself (src/Terminal.tsx) and a text box takes dragged text as it always has; anything else is
// refused, and the cursor says so while it hovers.
const textBox = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || ((t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !t.classList.contains('xterm-helper-textarea')))
const refused = (e: DragEvent): boolean => !e.defaultPrevented && (!!e.dataTransfer?.types.includes('Files') || !textBox(e.target))
document.addEventListener('dragover', (e) => {
  if (!refused(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
})
document.addEventListener('drop', (e) => {
  if (refused(e)) e.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
