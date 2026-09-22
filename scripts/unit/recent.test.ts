// src/sidebar/recent.ts: the pure parts of the sidebar's folder logic. `explorerDir` is the one
// rule behind "the file browser follows the terminal in front" — it used to show the process's
// working directory (the app's install folder) whenever it came up before the first tab did.
import './dom-shim'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setLang } from '../../src/i18n'
import { baseName, cdCommand, dirKey, explorerDir, relTime } from '../../src/sidebar/recent'

test('explorerDir: the active tab first, then the folder the next terminal would open in, then home', () => {
  assert.equal(explorerDir('C:\\proj', 'C:\\last', 'C:\\Users\\me'), 'C:\\proj')
  assert.equal(explorerDir('', 'C:\\last', 'C:\\Users\\me'), 'C:\\last')
  assert.equal(explorerDir(null, '', 'C:\\Users\\me'), 'C:\\Users\\me')
  assert.equal(explorerDir(undefined, '', ''), '', 'nowhere to go: leave the browser where it is, never process.cwd()')
})

test('baseName and dirKey: the tab title and the identity of a folder', () => {
  assert.equal(baseName('C:\\Users\\me\\proj\\'), 'proj')
  assert.equal(baseName('/home/me/proj'), 'proj')
  assert.equal(baseName('C:\\'), 'C:')
  assert.equal(dirKey('C:\\Proj\\'), dirKey('c:\\proj'))
})

test('relTime: worded in the UI language, read at the moment it is asked', () => {
  const now = Date.now()
  setLang('ko')
  assert.equal(relTime(0), '')
  assert.equal(relTime(now - 10_000), '방금')
  assert.equal(relTime(now - 12 * 60_000), '12분 전')
  assert.equal(relTime(now - 3 * 3600_000), '3시간 전')
  assert.equal(relTime(now - 30 * 3600_000), '어제')
  setLang('en')
  assert.equal(relTime(now - 10_000), 'just now')
  assert.equal(relTime(now - 12 * 60_000), '12m ago')
  assert.equal(relTime(now - 3 * 3600_000), '3h ago')
  assert.equal(relTime(now - 30 * 3600_000), 'yesterday')
  setLang('auto')
})

test("cdCommand: single-quoted for either shell, a quote inside escaped the shell's own way", () => {
  assert.equal(cdCommand('C:\\my proj', true), "Set-Location -LiteralPath 'C:\\my proj'")
  assert.equal(cdCommand("C:\\it's [1]", true), "Set-Location -LiteralPath 'C:\\it''s [1]'")
  assert.equal(cdCommand('/home/me/my proj', false), "cd '/home/me/my proj'")
  assert.equal(cdCommand("/home/me/it's", false), "cd '/home/me/it'\\''s'")
})
