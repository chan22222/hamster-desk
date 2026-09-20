// Fixed bubble phrases. Two sets (ko / en); every other language falls back to en.
// The effective language follows the `lang` preference, or — on 'auto' — Claude Code's own
// output language (`claudeLanguage`) and then the browser locale.

export type PrefLang = 'auto' | 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'de' | 'fr' | 'pt' | 'ru'

export const LANG_OPTIONS: { value: PrefLang; label: string }[] = [
  { value: 'auto', label: '자동' },
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
const NAME: Record<Exclude<PrefLang, 'auto'>, string> = {
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
const CODE_OF_NAME: Record<string, string> = {
  korean: 'ko', english: 'en', japanese: 'ja', chinese: 'zh', spanish: 'es',
  german: 'de', french: 'fr', portuguese: 'pt', russian: 'ru',
}

export interface Strings {
  reportDone: string
  failed: string
  needPermission: string
  haveQuestion: string
  compacting: string
  reading(label: string): string
  searching(label: string): string
  running(label: string): string
  hiring(label: string): string
  browsing(label: string): string
  newlyWritten: string
  overwritten: string
}

const ko: Strings = {
  reportDone: '보고 완료, 퇴근!',
  failed: '어라, 실패했다…',
  needPermission: '허락해 주세요!',
  haveQuestion: '질문 있어요!',
  compacting: '기억 정리 중',
  reading: (l) => `${l} 읽는 중`,
  searching: (l) => `찾는 중: ${l}`,
  running: (l) => `실행: ${l}`,
  hiring: (l) => `햄스터 고용: ${l}`,
  browsing: (l) => `브라우저: ${l}`,
  newlyWritten: '새로 씀',
  overwritten: '덮어씀',
}

const en: Strings = {
  reportDone: 'All reported — heading home!',
  failed: 'Oops, that failed…',
  needPermission: 'Need your OK!',
  haveQuestion: 'I have a question!',
  compacting: 'Tidying up memory',
  reading: (l) => `Reading ${l}`,
  searching: (l) => `Searching: ${l}`,
  running: (l) => `Running: ${l}`,
  hiring: (l) => `Hiring: ${l}`,
  browsing: (l) => `Browsing: ${l}`,
  newlyWritten: 'new file',
  overwritten: 'overwritten',
}

let pref: PrefLang = 'auto'
/** Claude Code's configured output language, e.g. "korean" (null when unset or unknown) */
let claudeLanguage: string | null = null

function browserCode(): string {
  try {
    return (navigator.language || 'en').slice(0, 2).toLowerCase()
  } catch {
    return 'en'
  }
}

export function setLang(p: PrefLang, cl?: string | null): void {
  pref = p
  if (cl !== undefined) claudeLanguage = cl
}

/** the language *name* passed to the summarizer */
export function langName(): string {
  if (pref !== 'auto') return NAME[pref]
  if (claudeLanguage) return claudeLanguage
  const code = browserCode() as Exclude<PrefLang, 'auto'>
  return NAME[code] ?? 'English'
}

/** the effective language code, used to pick the fixed phrases */
export function langCode(): string {
  if (pref !== 'auto') return pref
  if (claudeLanguage) return CODE_OF_NAME[claudeLanguage.trim().toLowerCase()] ?? claudeLanguage.slice(0, 2).toLowerCase()
  return browserCode()
}

/** fixed phrases in the effective language */
export function t(): Strings {
  return langCode().startsWith('ko') ? ko : en
}
