// src/term/paste.ts: what a paste or a file drop may put in front of the shell.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathsForPaste, sanitizePaste } from '../../src/term/paste'

test('a paste cannot end its own bracket and run what follows', () => {
  // the clipboard closes the bracketed paste early, then "types" a command and Enter
  const evil = 'look at this\x1b[201~calc.exe\r'
  const clean = sanitizePaste(evil)
  assert.equal(clean, 'look at thiscalc.exe\r')
  assert.ok(!clean.includes('\x1b'))
  assert.equal(sanitizePaste('\x1b[200~inner\x1b[201~'), 'inner')
})

test('every control goes but tab and the line breaks, as Windows Terminal filters a paste', () => {
  assert.equal(sanitizePaste('a\tb\r\nc\nd'), 'a\tb\r\nc\nd')
  assert.equal(sanitizePaste('x\x00\x07\x08\x1b[31my\x7f\x9bz'), 'x[31myz')
  // letters well past the control ranges are left alone, astral ones included
  assert.equal(sanitizePaste('한글 · émoji 🐹 ǅ'), '한글 · émoji 🐹 ǅ')
})

test('dropped files are typed as their paths, quoted when they hold a space', () => {
  assert.equal(pathsForPaste(['C:\\shots\\a.png']), 'C:\\shots\\a.png')
  assert.equal(pathsForPaste(['C:\\my shots\\a b.png', 'D:\\x.txt']), '"C:\\my shots\\a b.png" D:\\x.txt')
  // a file with no path behind it (dragged out of a browser) gives nothing to type
  assert.equal(pathsForPaste(['', '']), '')
})
