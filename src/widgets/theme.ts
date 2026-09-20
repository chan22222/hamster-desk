// Which palette the app is painted with. `prefs.theme` is what the user picked; this is what it
// resolves to right now, because `system` keeps following the OS while it stays picked.
//
// The resolved mode goes on `<html data-theme>`, which is what src/styles.css keys the dark token
// set off. Nothing else reads the media query.

import { useEffect, useState } from 'react'
import { useDesk, type ThemeMode } from '../store'

export type Painted = 'light' | 'dark'

const QUERY = '(prefers-color-scheme: dark)'

export function systemDark(): boolean {
  try {
    return window.matchMedia(QUERY).matches
  } catch {
    return false // no matchMedia (jsdom, very old webviews): light
  }
}

export function resolveTheme(mode: ThemeMode, dark: boolean): Painted {
  return mode === 'system' ? (dark ? 'dark' : 'light') : mode
}

/** The mode actually on screen, re-rendering when the preference or the OS setting changes. */
export function usePainted(): Painted {
  const mode = useDesk((s) => s.prefs.theme)
  const [dark, setDark] = useState(systemDark)
  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia(QUERY)
    } catch {
      return
    }
    const on = (e: MediaQueryListEvent): void => setDark(e.matches)
    setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return resolveTheme(mode, dark)
}
