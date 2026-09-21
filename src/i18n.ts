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
type Code = Exclude<PrefLang, 'auto'>

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
  if (m) return Object.hasOwn(NAME, m[1]) ? (m[1] as Code) : null
  // "한국어 (Korean)", "Korean / 한국어"
  for (const part of s.split(/[\s()[\]{}<>,;:/|·・]+/)) {
    const c = CODE_OF_NAME[part]
    if (c) return c
  }
  return null
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
  /** OS notification titles; `tab` is the terminal tab the notification points at */
  notifyPermission(tab: string): string
  notifyQuestion(tab: string): string
  notifyTurnEnd(tab: string): string
  /** notification bodies, for when there is nothing more specific to say */
  notifyWaitingBody: string
  notifyTurnBody: string
  /** the one line a finished turn comes to: '파일 3 · +120 −40 · 2분 10초' */
  turnSummary(files: number, added: number, removed: number, dur: string): string
  /** what `formatDuration` puts after each number */
  durationUnits: { hour: string; minute: string; second: string }
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
  notifyPermission: (tab) => `허락해 주세요 · ${tab}`,
  notifyQuestion: (tab) => `질문 있어요 · ${tab}`,
  notifyTurnEnd: (tab) => `턴 완료 · ${tab}`,
  notifyWaitingBody: '터미널에서 답을 기다리고 있어요.',
  notifyTurnBody: '작업이 끝났어요.',
  turnSummary: (files, added, removed, dur) => `파일 ${files} · +${added} −${removed} · ${dur}`,
  durationUnits: { hour: '시간', minute: '분', second: '초' },
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
  notifyPermission: (tab) => `Need your OK · ${tab}`,
  notifyQuestion: (tab) => `I have a question · ${tab}`,
  notifyTurnEnd: (tab) => `Turn done · ${tab}`,
  notifyWaitingBody: 'Waiting for your answer in the terminal.',
  notifyTurnBody: 'The work is done.',
  turnSummary: (files, added, removed, dur) => `${files} file${files === 1 ? '' : 's'} · +${added} −${removed} · ${dur}`,
  durationUnits: { hour: 'h', minute: 'm', second: 's' },
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
  // a Claude Code language we cannot place says nothing about the phrases — ask the browser instead
  return (claudeLanguage && codeOfLanguage(claudeLanguage)) || browserCode()
}

/** fixed phrases in the effective language */
export function t(): Strings {
  return langCode().startsWith('ko') ? ko : en
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
