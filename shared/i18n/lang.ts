// Which language the app speaks: the `lang` preference, and how a free-text Claude Code language
// ("한국어", "korean", "ko-KR") maps to one of ours. Shared by the renderer (src/i18n.ts) and main
// (electron/lang.ts); free of DOM and electron so scripts/unit can drive it with tsx.

export type PrefLang = 'auto' | 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'de' | 'fr' | 'pt' | 'ru'
/** a language with strings of its own */
export type Code = Exclude<PrefLang, 'auto'>

export const CODES: readonly Code[] = ['ko', 'en', 'ja', 'zh', 'es', 'de', 'fr', 'pt', 'ru']

export function isCode(v: unknown): v is Code {
  return typeof v === 'string' && (CODES as readonly string[]).includes(v)
}

/** the picker's rows: every language in its own name (`auto` is worded by the UI language) */
export const LANG_OPTIONS: { value: PrefLang; label: string }[] = [
  { value: 'auto', label: '' },
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
]

/** language *names*, which is what the summarizer prompt wants */
export const NAME: Record<Code, string> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
  pt: 'Portuguese',
  ru: 'Russian',
}

/**
 * What `language` in ~/.claude/settings.json may hold, lower-cased. It is free text, and people
 * write it in the language itself — "한국어", not "korean" — so the native names matter more than
 * the English ones. Locale codes ("ko", "ko-KR") are handled by `codeOfLanguage`, not listed here.
 */
const CODE_OF_NAME: Record<string, Code> = {
  korean: 'ko', english: 'en', japanese: 'ja', chinese: 'zh', spanish: 'es',
  german: 'de', french: 'fr', portuguese: 'pt', russian: 'ru',
  '한국어': 'ko', '한글': 'ko', '한국말': 'ko',
  '日本語': 'ja', 'にほんご': 'ja',
  '中文': 'zh', '简体中文': 'zh', '繁體中文': 'zh', '繁体中文': 'zh', '汉语': 'zh', '漢語': 'zh', '普通话': 'zh',
  'español': 'es', espanol: 'es', castellano: 'es',
  deutsch: 'de',
  'français': 'fr', francais: 'fr',
  'português': 'pt', portugues: 'pt',
  'русский': 'ru',
}

/**
 * The language code behind whatever the user typed as their Claude Code language, or null when it
 * is not one we know. Never guesses from the first two letters: "한국어".slice(0, 2) is "한국", which
 * is how a Korean user ended up with English bubbles.
 */
export function codeOfLanguage(name: string): Code | null {
  const s = name.normalize('NFC').trim().toLowerCase()
  if (!s) return null
  const hit = CODE_OF_NAME[s]
  if (hit) return hit
  // a locale code: "ko", "ko-KR", "ko_KR", "zh-Hans-CN"
  const m = /^([a-z]{2})(?:[-_][a-z0-9]{2,8})*$/.exec(s)
  if (m) return isCode(m[1]) ? m[1] : null
  // "한국어 (Korean)", "Korean / 한국어"
  for (const part of s.split(/[\s()[\]{}<>,;:/|·・]+/)) {
    const c = CODE_OF_NAME[part]
    if (c) return c
  }
  return null
}

/** `"ko-KR"` → `'ko'`; anything we have no strings for → `'en'` */
export function codeOfLocale(locale: string | null | undefined): Code {
  const two = (locale || '').slice(0, 2).toLowerCase()
  return isCode(two) ? two : 'en'
}
