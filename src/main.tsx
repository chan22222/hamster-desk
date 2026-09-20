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

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
