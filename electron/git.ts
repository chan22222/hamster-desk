// git, read-only. Stub: the real implementation lands with the git work — plan §3.8. Owner: C.
// Whatever fills this in may only ever run commands that read (no add/commit/checkout/stash).

import type { GitDiff, GitInfo } from '../shared/events'

export async function gitInfo(_cwd: string): Promise<GitInfo> {
  return { repo: false, branch: null, changed: 0, ahead: 0, behind: 0, at: Date.now(), error: null }
}

export async function gitDiff(_cwd: string, _file: string): Promise<GitDiff> {
  return { text: '', truncated: false, untracked: false, error: null }
}
