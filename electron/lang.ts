import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { UI, type UiStrings } from '../shared/i18n'
import { codeOfLanguage, codeOfLocale, isCode, type Code } from '../shared/i18n/lang'
import { loadUi } from './ui-store'
import { claudeDir } from './watcher/paths'

/**
 * The language main speaks — the same choice the renderer makes (src/i18n.ts), read from the same
 * place: the `lang` preference in ui.json, or on `auto` Claude Code's own language and then the
 * system locale. Read at each call rather than told by the renderer, so what main writes before the
 * window is up (the CLAUDE.md block, an account's fallback name) already comes out in the right
 * language and is not rewritten a second later.
 *
 * Free of any `electron` import (no `app.getLocale()`), so scripts/unit can drive the modules that
 * use it with tsx; those set HAMSTER_LANG so the wording they assert on does not depend on the
 * machine's locale.
 */

/** `language` from ~/.claude/settings.json, verbatim (e.g. "한국어"); null when unset */
export function claudeLanguage(): string | null {
  try {
    const j = JSON.parse(readFileSync(join(claudeDir(), 'settings.json'), 'utf8')) as { language?: unknown }
    return typeof j.language === 'string' && j.language ? j.language : null
  } catch {
    return null
  }
}

function systemLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return 'en'
  }
}

// ui.json is read from disk on every loadUi() while no write is pending; a second is long enough
// to spare the hot paths (every accounts list, every project scan) and short enough that a change
// in the ⋯ menu reaches main before anyone notices
let cached: { code: Code; at: number } | null = null
const CACHE_MS = 1000

export function mainLangCode(): Code {
  const forced = process.env.HAMSTER_LANG
  if (isCode(forced)) return forced
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.code
  const pref = (loadUi().prefs as { lang?: unknown } | undefined)?.lang
  let code: Code
  if (isCode(pref)) code = pref
  else {
    const cl = claudeLanguage()
    code = (cl && codeOfLanguage(cl)) || codeOfLocale(systemLocale())
  }
  cached = { code, at: now }
  return code
}

/** every fixed word, in main's language */
export function tr(): UiStrings {
  return UI[mainLangCode()]
}
