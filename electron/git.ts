// git, read-only. Every command here reads: `rev-parse`, `status`, `diff`. Nothing writes — no
// add, commit, checkout, stash or config — because this runs on the user's own working tree
// while they are in the middle of something, and an app that watches must not also touch.
//
// Plain node on purpose (no `electron` import): main.ts registers the IPC handlers, and keeping
// this module dependency-free is what lets the unit test run it under `tsx`.
//
// `--no-optional-locks` + `GIT_OPTIONAL_LOCKS=0` are the reason a poll every ten seconds is safe:
// without them `git status` refreshes the index and takes `index.lock`, which can collide with a
// real git command the user is running in the terminal a few pixels away.
//
// Reading is not always *only* reading: a repository's own .git/config can name programs for git to
// run — an fsmonitor hook on every `status`, an external diff or a textconv filter on `diff`. The
// poll starts the moment a tab opens in a folder, before anyone has looked at what that folder is
// (an unpacked archive, a clone of a stranger's repo), so those are switched off on the command line,
// where the repository's config cannot switch them back on.

import { execFile } from 'node:child_process'
import { cleanEnv, findOnPath } from './env'
import type { GitDiff, GitInfo } from '../shared/events'

/** a big repo on a cold cache is slow; past this the chip is simply not worth a stalled UI */
const TIMEOUT_MS = 5000
const MAX_BUFFER = 2 * 1024 * 1024
/** a diff longer than this is not read in a sidebar anyway */
const DIFF_MAX = 20_000

const WIN = process.platform === 'win32'
/** resolved once: PATH does not change under us, and `git` alone would go through the shell */
const gitBin = findOnPath(WIN ? 'git.exe' : 'git') ?? 'git'

interface Run {
  ok: boolean
  out: string
  err: string
  timedOut: boolean
}

/**
 * Before every command. `core.fsmonitor=` (empty) is off in every git: new ones read it as a boolean
 * false, old ones as no hook path at all — `false` would be a program named "false" to the latter.
 */
const SAFE = ['--no-optional-locks', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=']
/** `diff` never hands the text to a program the repository names */
const DIFF = ['diff', '--no-ext-diff', '--no-textconv']

function run(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      gitBin,
      [...SAFE, ...args],
      { cwd, env: { ...cleanEnv(), GIT_OPTIONAL_LOCKS: '0' }, windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const e = err as (Error & { killed?: boolean; code?: number | string }) | null
        resolve({
          ok: !e,
          out: typeof stdout === 'string' ? stdout : '',
          err: e ? (stderr || '').trim() || e.message : '',
          timedOut: !!e?.killed,
        })
      },
    )
  })
}

const EMPTY: Omit<GitInfo, 'at'> = { repo: false, branch: null, changed: 0, ahead: 0, behind: 0, error: null }

/**
 * Read `git status --porcelain=v1 --branch`.
 *
 * The first line is the branch header — `## main...origin/main [ahead 1, behind 2]`, or
 * `## HEAD (no branch)` on a detached head, or `## No commits yet on main` in a fresh repo.
 * Every other line is one changed path, which is exactly the number the tab chip shows.
 */
export function parseStatus(out: string): { branch: string | null; changed: number; ahead: number; behind: number } {
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  let changed = 0
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line) continue
    if (line.startsWith('## ')) {
      const head = line.slice(3)
      const track = /\[([^\]]*)\]\s*$/.exec(head)
      if (track) {
        const a = /ahead (\d+)/.exec(track[1])
        const b = /behind (\d+)/.exec(track[1])
        if (a) ahead = Number(a[1])
        if (b) behind = Number(b[1])
      }
      const name = head.replace(/\s*\[[^\]]*\]\s*$/, '').split('...')[0].trim()
      branch = name.includes('(no branch)') ? null : name.replace(/^No commits yet on /, '').trim() || null
      continue
    }
    changed++
  }
  return { branch, changed, ahead, behind }
}

/** capture runs are blind: the tagged line is how a screenshot's `⎇ master · 1` can be checked */
function log(line: string): void {
  if (process.env.HAMSTER_CAPTURE) console.log(line)
}

/** Branch, how many paths are dirty and how far from the upstream — one snapshot, read-only. */
export async function gitInfo(cwd: string): Promise<GitInfo> {
  const at = Date.now()
  if (!cwd) return { ...EMPTY, at }
  const t0 = Date.now()
  const inside = await run(['rev-parse', '--is-inside-work-tree'], cwd)
  // not a repo, no git on PATH, folder gone: all the same answer — there is nothing to show
  if (!inside.ok || inside.out.trim() !== 'true') return { ...EMPTY, at: Date.now(), error: inside.timedOut ? 'timeout' : null }

  const status = await run(['status', '--porcelain=v1', '--branch'], cwd)
  if (!status.ok) return { ...EMPTY, repo: true, at: Date.now(), error: status.timedOut ? 'timeout' : status.err || 'status failed' }
  const parsed = parseStatus(status.out)

  let branch = parsed.branch
  // a detached head has no branch name; the short sha is what the terminal prompt would show
  if (!branch || branch === 'HEAD') {
    const head = await run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    const name = head.ok ? head.out.trim() : ''
    if (name && name !== 'HEAD') branch = name
    else {
      const sha = await run(['rev-parse', '--short', 'HEAD'], cwd)
      branch = sha.ok && sha.out.trim() ? sha.out.trim() : branch
    }
  }
  log(`[git] info ${branch ?? '-'} changed=${parsed.changed} (${Date.now() - t0}ms)`)
  return { repo: true, branch, changed: parsed.changed, ahead: parsed.ahead, behind: parsed.behind, at: Date.now(), error: null }
}

/**
 * The working-tree diff of one file, falling back to the staged one — a file the user (or claude)
 * has already `git add`ed still has a diff worth reading, it just is not in `git diff` any more.
 * A file git has never seen has no diff at all, which the caller says in words rather than
 * showing an empty box.
 */
export async function gitDiff(cwd: string, file: string): Promise<GitDiff> {
  const empty: GitDiff = { text: '', truncated: false, untracked: false, error: null }
  if (!cwd || !file) return empty

  const work = await run([...DIFF, '--', file], cwd)
  if (!work.ok) return { ...empty, error: work.timedOut ? 'timeout' : work.err || 'diff failed' }
  let text = work.out
  if (!text.trim()) {
    const staged = await run([...DIFF, '--cached', '--', file], cwd)
    if (staged.ok) text = staged.out
  }
  if (!text.trim()) {
    const st = await run(['status', '--porcelain', '--', file], cwd)
    if (st.ok && st.out.trimStart().startsWith('??')) return { ...empty, untracked: true }
    return empty
  }
  const truncated = text.length > DIFF_MAX
  log(`[git] diff ${file} ${text.length}${truncated ? ' (cut)' : ''}`)
  return { text: truncated ? text.slice(0, DIFF_MAX) : text, truncated, untracked: false, error: null }
}
