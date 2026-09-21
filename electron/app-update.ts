import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppUpdateInfo } from '../shared/events'

/**
 * Is there a newer Hamster Desk? The app has no releases: it is built from its repository, so
 * "newer" means `main` on GitHub has commits this build was not made from.
 *
 * The build stamps its own commit into the main bundle (`__BUILD_COMMIT__`, electron.vite.config.ts)
 * and one unauthenticated call — GET /compare/<that commit>...main — answers both questions at once:
 * how far behind, and what changed. The repository is public; the anonymous rate limit (60 an hour
 * per address) is far above one call per start plus one an hour.
 *
 * Deliberately free of any `electron` import, like ui-store.ts: the caller passes in where the app
 * runs from, so scripts/unit can drive it with tsx.
 */

declare const __BUILD_COMMIT__: string | undefined

export const REPO = 'chan22222/hamster-desk'
export const COMMITS_URL = `https://github.com/${REPO}/commits/main`
const TTL = 60 * 60 * 1000
/** a menu is not a changelog: the newest few say what the update is about */
const MAX_LISTED = 12

export function buildCommit(): string | null {
  return typeof __BUILD_COMMIT__ === 'string' && /^[0-9a-f]{40}$/.test(__BUILD_COMMIT__) ? __BUILD_COMMIT__ : null
}

/** What the compare API said, reduced to what the UI shows. Anything unexpected reads as "not behind". */
export function parseCompare(json: unknown): Pick<AppUpdateInfo, 'behind' | 'commits'> {
  const j = (json && typeof json === 'object' ? json : {}) as { ahead_by?: unknown; commits?: unknown }
  const behind = typeof j.ahead_by === 'number' && j.ahead_by > 0 ? Math.floor(j.ahead_by) : 0
  const commits: AppUpdateInfo['commits'] = []
  // the API lists oldest first
  for (const c of Array.isArray(j.commits) ? [...j.commits].reverse() : []) {
    const sha = (c as { sha?: unknown })?.sha
    const message = (c as { commit?: { message?: unknown } })?.commit?.message
    if (typeof sha !== 'string' || typeof message !== 'string') continue
    commits.push({ sha: sha.slice(0, 7), title: message.split('\n')[0].slice(0, 120) })
    if (commits.length === MAX_LISTED) break
  }
  return { behind, commits: behind ? commits : [] }
}

/**
 * The git checkout this app can rebuild itself from, or null. A packaged build sits in
 * <repo>/release/win-unpacked; a copy of that folder on its own has no repository above it.
 */
export function repoDirOf(execPath: string, appPath: string, packaged: boolean): string | null {
  const dir = packaged ? join(dirname(execPath), '..', '..') : appPath
  try {
    if (!existsSync(join(dir, '.git'))) return null
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown }
    return pkg.name === 'hamster-desk' ? dir : null
  } catch {
    return null
  }
}

let cache: AppUpdateInfo | null = null
let inflight: Promise<AppUpdateInfo> | null = null

export function checkAppUpdate(force: boolean, canSelfUpdate: boolean): Promise<AppUpdateInfo> {
  if (!force && cache && Date.now() - cache.checkedAt < TTL) return Promise.resolve(cache)
  if (inflight) return inflight
  const commit = buildCommit()
  const done = (rest: Pick<AppUpdateInfo, 'behind' | 'commits' | 'error'>): AppUpdateInfo =>
    (cache = { commit, canSelfUpdate, checkedAt: Date.now(), ...rest })
  if (!commit) return Promise.resolve(done({ behind: 0, commits: [], error: 'no build commit' }))
  inflight = (async () => {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/compare/${commit}...main`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'hamster-desk' },
        signal: AbortSignal.timeout(10000),
      })
      // 404: GitHub has never seen this commit — a build of local work that was not pushed
      if (res.status === 404) return done({ behind: 0, commits: [], error: 'unknown commit' })
      if (!res.ok) throw new Error(`github ${res.status}`)
      return done({ ...parseCompare(await res.json()), error: null })
    } catch (e) {
      // keep showing what the last good answer said; a flaky network is not "up to date"
      return done({ behind: cache?.behind ?? 0, commits: cache?.commits ?? [], error: (e as Error).message })
    }
  })().finally(() => {
    inflight = null
  })
  return inflight
}

// PowerShell 5.1 reads a .ps1 without a BOM in the ANSI code page, which garbles the Korean below
const BOM = String.fromCharCode(0xfeff)
export const UPDATE_SCRIPT = `${BOM}param([int]$AppPid, [string]$Repo, [string]$Exe)
$Host.UI.RawUI.WindowTitle = 'Hamster Desk 업데이트'
Write-Host 'Hamster Desk 가 닫히기를 기다리는 중...'
try { Wait-Process -Id $AppPid -Timeout 30 -ErrorAction Stop } catch {}
Set-Location -LiteralPath $Repo
$ok = $true
foreach ($step in 'git pull --ff-only', 'npm install --legacy-peer-deps', 'npm run build:dir') {
  Write-Host ''
  Write-Host "> $step" -ForegroundColor Cyan
  cmd /c $step
  if ($LASTEXITCODE -ne 0) { $ok = $false; break }
}
Write-Host ''
if ($ok) {
  Write-Host '업데이트 완료. 앱을 다시 엽니다.' -ForegroundColor Green
} else {
  Write-Host '업데이트에 실패했습니다. 위 오류를 확인하세요.' -ForegroundColor Red
  Read-Host 'Enter 를 누르면 앱을 다시 열고 이 창을 닫습니다'
}
try { Start-Process -FilePath $Exe } catch { Write-Host $_; Read-Host 'Enter' }
`

/**
 * Pull, install and rebuild in a console window of its own, then reopen the app. The build
 * rewrites the very folder the app runs from, so it cannot happen while the app is open: the
 * script waits for `pid` to go away first, and the caller quits right after this returns true.
 */
export function startSelfUpdate(opts: { repoDir: string; exe: string; pid: number; home: string }): boolean {
  if (process.platform !== 'win32') return false
  try {
    const script = join(opts.home, 'update.ps1')
    mkdirSync(opts.home, { recursive: true })
    writeFileSync(script, UPDATE_SCRIPT, 'utf8')
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-AppPid', String(opts.pid), '-Repo', opts.repoDir, '-Exe', opts.exe],
      { cwd: opts.repoDir, detached: true, stdio: 'ignore' }, // detached: its own console, and it outlives us
    )
    child.unref()
    return true
  } catch {
    return false
  }
}
