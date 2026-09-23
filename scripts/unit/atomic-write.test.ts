// Replacing a file of the user's (electron/atomic-write.ts): all or nothing, the old one kept when
// asked, and a symlink left a symlink — the file it points at is what changes.
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { linkTarget, writeFileAtomic } from '../../electron/atomic-write'

const ROOT = mkdtempSync(join(tmpdir(), 'hd-atomic-'))
after(() => rmSync(ROOT, { recursive: true, force: true }))

/** A file symlink; null where this machine does not let a test make one (Windows without Developer Mode). */
function trySymlink(target: string, path: string): string | null {
  try {
    symlinkSync(target, path, 'file')
    return path
  } catch {
    return null
  }
}

test('writes, makes the folder, leaves no temp file', () => {
  const file = join(ROOT, 'a', 'b', 'settings.json')
  writeFileAtomic(file, 'one')
  assert.equal(readFileSync(file, 'utf8'), 'one')
  writeFileAtomic(file, 'two')
  assert.equal(readFileSync(file, 'utf8'), 'two')
  assert.deepEqual(readdirSync(join(ROOT, 'a', 'b')), ['settings.json'])
})

test('`backup` keeps the file as it was just before', () => {
  const file = join(ROOT, 'backup.json')
  writeFileAtomic(file, 'first', { backup: true })
  assert.deepEqual(readdirSync(ROOT).filter((f) => f.startsWith('backup')), ['backup.json'], 'nothing to keep the first time')
  writeFileAtomic(file, 'second', { backup: true })
  assert.equal(readFileSync(`${file}.hamster-bak`, 'utf8'), 'first')
  writeFileAtomic(file, 'third', { backup: true })
  assert.equal(readFileSync(`${file}.hamster-bak`, 'utf8'), 'second')
})

test('a symlink stays a symlink; the file it points at is replaced', (t) => {
  const dots = join(ROOT, 'dotfiles')
  mkdirSync(dots, { recursive: true })
  const real = join(dots, 'CLAUDE.md')
  writeFileSync(real, 'mine', 'utf8')
  const link = trySymlink(real, join(ROOT, 'CLAUDE.md'))
  if (!link) return t.skip('no symlinks here')
  assert.equal(linkTarget(link), real)
  writeFileAtomic(link, 'mine + block', { backup: true })
  assert.ok(lstatSync(link).isSymbolicLink(), 'still a link')
  assert.equal(readFileSync(real, 'utf8'), 'mine + block')
  assert.equal(readFileSync(`${real}.hamster-bak`, 'utf8'), 'mine', 'kept next to the real file')
})

test('a write that cannot happen throws and leaves the old file', () => {
  const dir = join(ROOT, 'locked')
  mkdirSync(join(dir, 'settings.json'), { recursive: true }) // a folder where the file should be: the rename fails
  assert.throws(() => writeFileAtomic(join(dir, 'settings.json'), 'x'))
  assert.deepEqual(readdirSync(dir), ['settings.json'], 'no temp file left behind')
})
