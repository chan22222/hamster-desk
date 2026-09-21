// Which language the fixed phrases come out in. The failure this guards against was silent and
// total: `language: "한국어"` in ~/.claude/settings.json is not the English word the table knew, so
// every bubble, toast and notification title of a Korean user fell through to English.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codeOfLanguage, formatDuration, langCode, langName, setLang, t } from '../../src/i18n'

/** `navigator.language` for the duration of one call — Node has a global `navigator` of its own */
function withBrowser<T>(language: string, run: () => T): T {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { language }, configurable: true })
  try {
    return run()
  } finally {
    if (before) Object.defineProperty(globalThis, 'navigator', before)
    else delete (globalThis as { navigator?: unknown }).navigator
  }
}

test('a language written in itself maps to its code', () => {
  assert.equal(codeOfLanguage('한국어'), 'ko')
  assert.equal(codeOfLanguage('한글'), 'ko')
  assert.equal(codeOfLanguage('日本語'), 'ja')
  assert.equal(codeOfLanguage('中文'), 'zh')
  assert.equal(codeOfLanguage('简体中文'), 'zh')
  assert.equal(codeOfLanguage('繁體中文'), 'zh')
  assert.equal(codeOfLanguage('Español'), 'es')
  assert.equal(codeOfLanguage('Deutsch'), 'de')
  assert.equal(codeOfLanguage('Français'), 'fr')
  assert.equal(codeOfLanguage('Português'), 'pt')
  assert.equal(codeOfLanguage('Русский'), 'ru')
})

test('English names, locale codes and decorated names map too', () => {
  assert.equal(codeOfLanguage('korean'), 'ko')
  assert.equal(codeOfLanguage('  Korean '), 'ko')
  assert.equal(codeOfLanguage('ko'), 'ko')
  assert.equal(codeOfLanguage('ko-KR'), 'ko')
  assert.equal(codeOfLanguage('ko_KR'), 'ko')
  assert.equal(codeOfLanguage('zh-Hans-CN'), 'zh')
  assert.equal(codeOfLanguage('한국어 (Korean)'), 'ko')
  // decomposed jamo, which is what a macOS-made file holds
  assert.equal(codeOfLanguage('한국어'.normalize('NFD')), 'ko')
})

test('an unknown language is not guessed from its first two letters', () => {
  assert.equal(codeOfLanguage('Klingon'), null)
  assert.equal(codeOfLanguage('Kotava'), null) // would have been "ko"
  assert.equal(codeOfLanguage('it-IT'), null) // a real code, but not one with phrases of its own
  assert.equal(codeOfLanguage(''), null)
})

test('langCode follows the Claude Code language, then the browser', () => {
  setLang('auto', '한국어')
  assert.equal(withBrowser('en-US', langCode), 'ko')
  assert.equal(withBrowser('en-US', () => t().needPermission), '허락해 주세요!')

  setLang('auto', 'korean')
  assert.equal(withBrowser('en-US', langCode), 'ko')

  setLang('auto', 'Klingon')
  assert.equal(withBrowser('ko-KR', langCode), 'ko')
  assert.equal(withBrowser('en-US', langCode), 'en')
  assert.equal(withBrowser('en-US', () => t().needPermission), 'Need your OK!')

  setLang('auto', null)
  assert.equal(withBrowser('ko-KR', langCode), 'ko')

  // an explicit preference beats both
  setLang('en', '한국어')
  assert.equal(withBrowser('ko-KR', langCode), 'en')
})

test('the summarizer is handed the language as the user wrote it', () => {
  setLang('auto', '한국어')
  assert.equal(langName(), '한국어')
  setLang('ja', '한국어')
  assert.equal(langName(), 'Japanese')
})

test('formatDuration reads like a person saying it, in either language', () => {
  setLang('ko', null)
  assert.equal(formatDuration(130_000), '2분 10초')
  assert.equal(formatDuration(45_000), '45초')
  assert.equal(formatDuration(3_780_000), '1시간 3분')
  assert.equal(formatDuration(120_000), '2분')
  assert.equal(formatDuration(3_600_000), '1시간')
  assert.equal(formatDuration(0), '0초')

  setLang('en', null)
  assert.equal(formatDuration(130_000), '2m 10s')
  assert.equal(formatDuration(45_000), '45s')
  assert.equal(formatDuration(3_780_000), '1h 3m')
  assert.equal(formatDuration(120_000), '2m')
  assert.equal(formatDuration(3_600_000), '1h')

  assert.equal(t().turnSummary(1, 12, 3, formatDuration(130_000)), '1 file · +12 −3 · 2m 10s')
  setLang('ko', null)
  assert.equal(t().turnSummary(1, 12, 3, formatDuration(130_000)), '파일 1 · +12 −3 · 2분 10초')
})
