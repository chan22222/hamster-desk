import { execFile } from 'node:child_process'
import { claudeInvocation, findClaude } from './env'
import type { VersionInfo } from '../shared/events'

const REGISTRY = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest'
const TTL = 60 * 60 * 1000

let cache: VersionInfo | null = null
let inflight: Promise<VersionInfo> | null = null

/** The claude executable as resolved along the cleaned PATH; 'claude' when nothing was found. */
export function claudeBinary(): string {
  return findClaude()?.path ?? 'claude'
}

export function currentVersion(): Promise<string | null> {
  const bin = findClaude() ?? { path: 'claude', viaCmd: false }
  const inv = claudeInvocation(bin, ['--version'])
  return new Promise((resolve) => {
    execFile(
      inv.file,
      inv.args,
      { windowsHide: true, windowsVerbatimArguments: inv.verbatim, timeout: 15000 },
      (err, stdout) => {
        if (err) return resolve(null)
        const m = String(stdout).match(/(\d+\.\d+\.\d+)/)
        resolve(m ? m[1] : null)
      },
    )
  })
}

async function latestVersion(): Promise<string> {
  const res = await fetch(REGISTRY, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`registry ${res.status}`)
  const j = (await res.json()) as { version?: string }
  if (!j.version) throw new Error('registry: no version')
  return j.version
}

/** Compare dotted versions; >0 when a is newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

export function checkVersion(force = false): Promise<VersionInfo> {
  if (!force && cache && Date.now() - cache.checkedAt < TTL) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = (async () => {
    const [current, latest] = await Promise.all([
      currentVersion(),
      latestVersion().catch((e: Error) => {
        return { error: e.message }
      }),
    ])
    const info: VersionInfo =
      typeof latest === 'string'
        ? { current, latest, checkedAt: Date.now(), error: null }
        : { current, latest: cache?.latest ?? null, checkedAt: Date.now(), error: latest.error }
    cache = info
    return info
  })().finally(() => {
    inflight = null
  })
  return inflight
}
