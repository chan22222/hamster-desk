// Which language the UI speaks, and the strings in it. The effective language follows the `lang`
// preference, or — on 'auto' — Claude Code's own output language (`claudeLanguage`) and then the
// browser locale. The strings themselves live in shared/i18n/ (one file per language, `ko` is the
// shape the others are typed against); this module only picks one.
//
// Components read strings through `useUi()`, which renders them again when the language changes;
// plain functions (the notifier, the feed reducer) call `ui()` at the moment they need a string.

import { useSyncExternalStore } from 'react'
import { UI, type UiStrings } from '../shared/i18n'
import { CODES, LANG_OPTIONS, NAME, codeOfLanguage, codeOfLocale, isCode, type Code, type PrefLang } from '../shared/i18n/lang'

export type { Code, PrefLang, UiStrings }
export { CODES, codeOfLanguage, isCode }

/** the fixed phrases a hamster says (and the notifications that repeat them) */
export type Strings = UiStrings['bubble']

let pref: PrefLang = 'auto'
/** Claude Code's configured output language, e.g. "korean" (null when unset or unknown) */
let claudeLanguage: string | null = null

/** bumped whenever the effective language may have changed; what `useUi` subscribes to */
let version = 0
const listeners = new Set<() => void>()
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const snapshot = (): number => version

function browserCode(): Code {
  try {
    return codeOfLocale(navigator.language)
  } catch {
    return 'en'
  }
}

export function setLang(p: PrefLang, cl?: string | null): void {
  pref = p
  if (cl !== undefined) claudeLanguage = cl
  const code = langCode()
  // `lang` on <html>: line breaking and the fonts Chromium picks for CJK follow it
  if (typeof document !== 'undefined' && document.documentElement.lang !== code) document.documentElement.lang = code
  version++
  for (const l of listeners) l()
}

/** the language *name* passed to the summarizer */
export function langName(): string {
  if (pref !== 'auto') return NAME[pref]
  if (claudeLanguage) return claudeLanguage
  return NAME[browserCode()]
}

/** the effective language code, used to pick the strings */
export function langCode(): Code {
  if (pref !== 'auto') return pref
  // a Claude Code language we cannot place says nothing about the phrases — ask the browser instead
  return (claudeLanguage && codeOfLanguage(claudeLanguage)) || browserCode()
}

/** every fixed word of the UI, in the effective language */
export function ui(): UiStrings {
  return UI[langCode()]
}

/** `ui()` for components: the component renders again when the language changes */
export function useUi(): UiStrings {
  useSyncExternalStore(subscribe, snapshot, snapshot)
  return ui()
}

/** the language picker's rows, with `auto` worded in the current language */
export function langOptions(u: UiStrings = ui()): { value: PrefLang; label: string }[] {
  return LANG_OPTIONS.map((o) => (o.value === 'auto' ? { value: o.value, label: u.langAuto } : o))
}

/** fixed bubble phrases in the effective language */
export function t(): Strings {
  return ui().bubble
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** one `Intl.DateTimeFormat` per language and shape — making one costs more than formatting with it */
function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const code = langCode()
  const key = `${code} ${JSON.stringify(options)}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(code, options)
    formatters.set(key, f)
  }
  return f
}

/** the clock, `18:05` — 24-hour in every language: there is no room for `PM`, and 18:05 is not ambiguous anywhere */
const CLOCK: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }

/**
 * A day of the calendar in the UI language: `9월 12일`, `Sep 12`, `12. Sept.`, `12 сент.`; with
 * `time`, the clock after it in that language's own way (`Sep 12, 18:05`). The month is a word, not
 * a number, because `9/12` is the 12th of September to a Korean or an American reader and the 9th
 * of December to a German, a Spaniard or a Russian one. A day outside this year says its year.
 */
export function formatDate(ts: number, opts: { time?: boolean; now?: number } = {}): string {
  const d = new Date(ts)
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== new Date(opts.now ?? Date.now()).getFullYear()) options.year = 'numeric'
  return dateFormat(opts.time ? { ...options, ...CLOCK } : options).format(d)
}

/** just the clock of `ts`: `18:05` */
export function formatTime(ts: number): string {
  return dateFormat(CLOCK).format(new Date(ts))
}

/**
 * `130000 → '2분 10초'` / `'2m 10s'`, `45000 → '45초'` / `'45s'`, `3780000 → '1시간 3분'` / `'1h 3m'`.
 *
 * At most two units: "1시간 3분 20초" is a stopwatch reading, and what the toast and the notification
 * want is "about how long did that take". The one place a duration is worded, so both say the same.
 */
export function formatDuration(ms: number): string {
  const u = t().durationUnits
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}${u.second}`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) {
    const rest = total % 60
    return rest ? `${minutes}${u.minute} ${rest}${u.second}` : `${minutes}${u.minute}`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}${u.hour} ${rest}${u.minute}` : `${hours}${u.hour}`
}
