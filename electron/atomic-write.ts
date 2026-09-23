import { closeSync, copyFileSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, rmSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Replacing a file of the user's — an account's settings.json, its CLAUDE.md — without being able to
 * lose it. Pure node, like ui-store.ts (whose own writer this follows), so scripts/unit can drive it.
 *
 *  - the new text goes to a temp file next to it, is flushed to disk, and a rename swaps it in: a
 *    crash or a power cut leaves the old file or the new one, never half of one or a file of zeros;
 *  - `backup` keeps what was there as `<file>.hamster-bak` first — the file as it was just before
 *    this app last changed it;
 *  - a symlink stays a symlink: the file it points at is what gets replaced. A rename onto the link
 *    itself would have turned it into a plain file and cut it loose from wherever it points (a
 *    dotfiles repository, most often).
 *
 * Throws when it could not write; the temp file does not outlive a failure.
 */
export function writeFileAtomic(file: string, text: string, opts: { backup?: boolean } = {}): void {
  const target = linkTarget(file)
  mkdirSync(dirname(target), { recursive: true })
  const tmp = `${target}.hamster-tmp`
  try {
    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, text, null, 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    if (opts.backup) {
      try {
        copyFileSync(target, `${target}.hamster-bak`)
      } catch {
        /* nothing there yet */
      }
    }
    renameSync(tmp, target)
  } catch (e) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* left for the next write, which starts it over */
    }
    throw e
  }
}

/** Where a write to `file` has to land: the file a symlink points at, or `file` itself. */
export function linkTarget(file: string): string {
  try {
    return lstatSync(file).isSymbolicLink() ? realpathSync(file) : file
  } catch {
    return file // not there (yet), or a link to nowhere: written as a plain file
  }
}
