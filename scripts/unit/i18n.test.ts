// Which language the fixed phrases come out in. The failure this guards against was silent and
// total: `language: "한국어"` in ~/.claude/settings.json is not the English word the table knew, so
// every bubble, toast and notification title of a Korean user fell through to English.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codeOfLanguage, formatDate, formatDuration, formatTime, langCode, langName, langOptions, setLang, t, ui } from '../../src/i18n'
import { CODES, UI } from '../../shared/i18n'

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

test('the whole UI follows the same choice as the bubbles', () => {
  setLang('ko', null)
  assert.equal(ui().settings.language, '언어')
  assert.equal(langOptions()[0].label, '자동')
  setLang('en', null)
  assert.equal(ui().settings.language, 'Language')
  assert.equal(langOptions()[0].label, 'Auto')
  assert.equal(langOptions().find((o) => o.value === 'ja')?.label, '日本語') // every other row is in its own language
  setLang('auto', 'Klingon')
  assert.equal(withBrowser('it-IT', () => ui().settings.language), 'Language') // no Italian strings: English, never a crash
})

/** every leaf string of a dictionary, with its dotted key */
function leaves(obj: unknown, path = ''): [string, string][] {
  if (typeof obj === 'string') return [[path, obj]]
  if (typeof obj === 'function') {
    // call with sample arguments: the *shape* of the output is what these tests look at
    const f = obj as (...a: unknown[]) => unknown
    const out = f('X', 'Y', 'Z', 'W', 'V', 'U')
    return typeof out === 'string' ? [[path, out]] : []
  }
  if (obj && typeof obj === 'object') return Object.entries(obj).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k))
  return []
}

/** every phrase of a dictionary that is a function, with its dotted key */
function phrases(obj: unknown, path = ''): [string, (...a: unknown[]) => unknown][] {
  if (typeof obj === 'function') return [[path, obj as (...a: unknown[]) => unknown]]
  if (obj && typeof obj === 'object') return Object.entries(obj).flatMap(([k, v]) => phrases(v, path ? `${path}.${k}` : k))
  return []
}

test('every translated phrase takes the arguments the Korean one takes, and prints them', () => {
  // tsc lets a translation declare fewer parameters than ko's signature (a shorter function is
  // assignable to a longer function type), and a phrase that drops one drops a number or a name
  // from the sentence without a word; one that takes it but never prints it is the same bug
  const marks = ['⟦a⟧', '⟦b⟧', '⟦c⟧', '⟦d⟧', '⟦e⟧', '⟦f⟧']
  const printed = (f: (...a: unknown[]) => unknown): string[] => {
    const out = f(...marks)
    return typeof out === 'string' ? marks.filter((m) => out.includes(m)) : []
  }
  const ko = new Map(phrases(UI.ko))
  for (const code of CODES) {
    for (const [k, f] of phrases(UI[code])) {
      const want = ko.get(k)
      assert.ok(want, `${code}: ${k} is not a phrase in ko`)
      assert.equal(f.length, want.length, `${code}: ${k} takes ${f.length} argument(s), ko takes ${want.length}`)
      assert.deepEqual(printed(f), printed(want), `${code}: ${k} does not print the same arguments as ko`)
    }
  }
})

test('a count of one is singular where the language has a plural', () => {
  assert.equal(UI.en.settings.summaryStats(1, '580', '550', '30', '$0.0007'), '1 summary · 580 tokens (in 550 · out 30) · ≈ $0.0007')
  assert.match(UI.en.settings.summaryStats(2, '1.2k', '1.1k', '60', '$0.0014'), /^2 summaries /)
  assert.match(UI.es.settings.summaryStats(1, '580', '550', '30', '$0'), /^1 resumen /)
  assert.match(UI.es.settings.summaryStats(3, '580', '550', '30', '$0'), /^3 resúmenes /)
  assert.match(UI.fr.settings.summaryStats(1, '580', '550', '30', '$0'), /^1 résumé /)
  assert.match(UI.fr.settings.summaryStats(3, '580', '550', '30', '$0'), /^3 résumés /)
  assert.match(UI.pt.settings.summaryStats(1, '580', '550', '30', '$0'), /^1 resumo /)
  assert.equal(UI.es.files.changed(1), '1 cambiado')
  assert.equal(UI.es.files.changed(4), '4 cambiados')
})

test('a date is worded in the UI language, with the month as a word', () => {
  const sep12 = new Date(2026, 8, 12, 18, 5).getTime()
  const now = new Date(2026, 8, 20, 9, 0).getTime()
  setLang('ko', null)
  assert.equal(formatDate(sep12, { now }), '9월 12일')
  assert.equal(formatDate(sep12, { now, time: true }), '9월 12일 18:05')
  assert.equal(formatTime(sep12), '18:05')
  setLang('en', null)
  assert.equal(formatDate(sep12, { now }), 'Sep 12')
  assert.equal(formatDate(sep12, { now, time: true }), 'Sep 12, 18:05')
  // the day before the month where that is the order people read — `9/12` was the 9th of December here
  setLang('de', null)
  assert.equal(formatDate(sep12, { now }), '12. Sept.')
  setLang('fr', null)
  assert.equal(formatDate(sep12, { now }), '12 sept.')
  setLang('ru', null)
  assert.equal(formatDate(sep12, { now }), '12 сент.')
  // 24-hour everywhere: the chips have no room for `PM`
  setLang('en', null)
  assert.equal(formatTime(new Date(2026, 8, 12, 0, 30).getTime()), '00:30')
  // another year says which
  assert.equal(formatDate(new Date(2025, 11, 30).getTime(), { now }), 'Dec 30, 2025')
})

test('every language has a word for everything, and the PowerShell lines have no apostrophe', () => {
  const ko = new Set(leaves(UI.ko).map(([k]) => k))
  for (const code of CODES) {
    const l = leaves(UI[code])
    assert.deepEqual(new Set(l.map(([k]) => k)), ko, `${code}: same keys as ko`)
    for (const [k, v] of l) {
      assert.ok(v.length > 0 || k === 'usage.remaining', `${code}: ${k} is empty`)
      // the self-update console script quotes these with single quotes (electron/app-update.ts), and
      // PowerShell reads the typographic ones (U+2018–U+201B) as single quotes too
      if (k.startsWith('main.upd')) assert.ok(!/['‘’‚‛]/.test(v), `${code}: ${k} holds an apostrophe`)
      // rich markup is flat, and every tag is closed
      const opens = (v.match(/<(b|code)>/g) ?? []).length
      const closes = (v.match(/<\/(b|code)>/g) ?? []).length
      assert.equal(opens, closes, `${code}: ${k} has an unclosed tag`)
    }
  }
})
