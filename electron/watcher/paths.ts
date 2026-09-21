import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

// `base` is another account's config folder (electron/profiles.ts); without it, the CLI's own.

export function sessionsDir(base?: string): string {
  return join(base || claudeDir(), 'sessions')
}

export function projectsDir(base?: string): string {
  return join(base || claudeDir(), 'projects')
}

/** Claude Code names the per-project folder by replacing every non-alphanumeric char of the cwd with '-'. */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/** Locate `<projects>/<slug>/<sessionId>.jsonl`; falls back to scanning every project folder. */
export function findTranscript(sessionId: string, cwd?: string, base?: string): string | null {
  const root = projectsDir(base)
  if (cwd) {
    const direct = join(root, projectSlug(cwd), `${sessionId}.jsonl`)
    if (existsSync(direct)) return direct
  }
  let dirs: string[] = []
  try {
    dirs = readdirSync(root)
  } catch {
    return null
  }
  for (const d of dirs) {
    const p = join(root, d, `${sessionId}.jsonl`)
    if (existsSync(p)) return p
  }
  return null
}

const AGENT_RE = /^([0-9a-f-]{36})[\\/]subagents[\\/](?:.*[\\/])?agent-([A-Za-z0-9_-]+)\.(jsonl|meta\.json)$/

/** Classify a path relative to a project folder. */
export function classifyRelPath(rel: string):
  | { type: 'main'; sessionId: string }
  | { type: 'agent'; sessionId: string; agentId: string; part: 'jsonl' | 'meta' }
  | null {
  const m = rel.match(/^([0-9a-f-]{36})\.jsonl$/)
  if (m) return { type: 'main', sessionId: m[1] }
  const a = rel.match(AGENT_RE)
  if (a) return { type: 'agent', sessionId: a[1], agentId: a[2], part: a[3] === 'jsonl' ? 'jsonl' : 'meta' }
  return null
}
