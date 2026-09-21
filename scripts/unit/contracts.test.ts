import './dom-shim'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PREFS, adoptPrefs } from '../../src/store'

test('DEFAULT_PREFS carries the keys the new features read', () => {
  assert.deepEqual(DEFAULT_PREFS.notify, { permission: true, question: true, turnEnd: true, sound: false })
  assert.equal(DEFAULT_PREFS.termFont, 14)
  assert.equal(DEFAULT_PREFS.showFeedLog, true)
})

test('adoptPrefs fills a partial notify group from the defaults', () => {
  // a user who only ever turned the sound on must not lose the other three toggles
  const p = adoptPrefs({ v: 2, notify: { sound: true } })
  assert.deepEqual(p.notify, { permission: true, question: true, turnEnd: true, sound: true })
})

test('adoptPrefs gives a settings file written before notify existed the whole group', () => {
  const p = adoptPrefs({ v: 2, theme: 'dark' })
  assert.deepEqual(p.notify, DEFAULT_PREFS.notify)
  // a copy, not the defaults themselves: toggling one pref must not rewrite DEFAULT_PREFS
  assert.notEqual(p.notify, DEFAULT_PREFS.notify)
  assert.equal(p.theme, 'dark')
  assert.equal(p.termFont, 14)
})
