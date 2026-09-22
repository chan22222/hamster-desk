import './dom-shim'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PREFS, adoptPrefs } from '../../src/store'

test('DEFAULT_PREFS carries the keys the new features read', () => {
  assert.deepEqual(DEFAULT_PREFS.notify, { permission: true, question: true, turnEnd: true, sound: false })
  assert.equal(DEFAULT_PREFS.termFont, 14)
  assert.equal(DEFAULT_PREFS.showFeedLog, true)
  // the sidebar's dragged section heights: null = the automatic layout
  assert.deepEqual([DEFAULT_PREFS.sideChangedH, DEFAULT_PREFS.sideFeedH], [null, null])
  // the app starts on the empty start card: no terminal is opened that nobody asked for
  assert.equal(DEFAULT_PREFS.restoreTabs, false)
  // every summary is a Haiku call on the user's subscription: off until asked for
  assert.equal(DEFAULT_PREFS.bubbleSummary, false)
})

test('adoptPrefs: a file from before v3 takes the new summary default once; a later choice is kept', () => {
  // written while the default was on — the stored true is the old default, not a choice
  assert.equal(adoptPrefs({ v: 2, bubbleSummary: true, theme: 'dark' }).bubbleSummary, false)
  assert.equal(adoptPrefs({ bubbleSummary: true }).bubbleSummary, false)
  assert.equal(adoptPrefs({ v: 2, bubbleSummary: true, theme: 'dark' }).theme, 'dark', 'nothing else is touched')
  // switched on since: stays on
  assert.equal(adoptPrefs({ v: 3, bubbleSummary: true }).bubbleSummary, true)
  assert.equal(adoptPrefs({ v: 3, bubbleSummary: false }).bubbleSummary, false)
})

test('adoptPrefs keeps a dragged sidebar height and gives an older file the automatic layout', () => {
  assert.equal(adoptPrefs({ v: 2, sideChangedH: 240 }).sideChangedH, 240)
  assert.equal(adoptPrefs({ v: 2, sideChangedH: 240 }).sideFeedH, null)
  assert.equal(adoptPrefs({ v: 2 }).sideChangedH, null)
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
