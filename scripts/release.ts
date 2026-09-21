// `npm run release` — publish the version in package.json as a GitHub release, which is what an
// installed app updates itself from (electron/app-release.ts).
//
//   1. raise "version" in package.json, commit and push as usual
//   2. npm run release
//
// It builds the setup and lets electron-builder upload it to a *draft* release (setup, .blockmap
// and latest.yml — the file electron-updater reads), then publishes the draft in one step, so no
// installed app ever sees a release that is only half there. Publishing is what creates the tag
// v<version>, on the commit `main` points at — which is why the checks below insist that this
// checkout is clean and is exactly origin/main.
//
// Needs the GitHub CLI, logged in (`gh auth login`): its token is what uploads. `--check` runs
// the checks and stops before anything is built or uploaded.

import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const REPO = 'chan22222/hamster-desk'
const checkOnly = process.argv.includes('--check')

const out = (file: string, args: string[]): string => execFileSync(file, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim()
const git = (...args: string[]): string => out('git', args)
const tryOut = (file: string, args: string[]): string | null => {
  try {
    return out(file, args)
  } catch {
    return null
  }
}
function fail(message: string): never {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
const tag = `v${version}`

const token = tryOut('gh', ['auth', 'token'])
if (!token) fail('GitHub CLI 가 없거나 로그인되어 있지 않습니다: gh auth login')

if (git('status', '--porcelain')) fail('커밋하지 않은 변경이 있습니다. 릴리스는 main 에 올라간 그대로여야 합니다.')
git('fetch', 'origin', 'main', '--tags')
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) fail('HEAD 가 origin/main 과 다릅니다. 먼저 푸시(또는 pull) 하세요.')

// a published release with this tag (a draft left by a failed run is fine: it gets reused)
const existing = tryOut('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'isDraft', '--jq', '.isDraft'])
if (existing === 'false' || git('tag', '--list', tag)) fail(`${tag} 은 이미 릴리스되었습니다. package.json 의 version 을 올리고 커밋·푸시한 뒤 다시 실행하세요.`)

// The release notes: this version's section of CHANGELOG.md, which is written whenever the version
// is raised. The commit subjects since the last release only when there is no such section.
const previous = tryOut('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'])
const LF = String.fromCharCode(10)
function changelogSection(): string | null {
  let lines: string[]
  try {
    lines = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8').split(/\r?\n/)
  } catch {
    return null
  }
  // a heading like "## 0.1.1 — 2026-09-21": the first word after the hashes is the version
  const start = lines.findIndex((l) => l.startsWith('## ') && l.slice(3).trim().split(' ')[0] === version)
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('## '))
  return (end < 0 ? rest : rest.slice(0, end)).join(LF).trim() || null
}
const subjects = git('log', '--no-merges', '--format=- %s', previous ? `${previous}..HEAD` : '-20')
const notes = (changelogSection() ?? [previous ? `${previous} 이후 바뀐 것` : '첫 릴리스', '', subjects].join(LF)) + LF

console.log(`${tag}  (${git('rev-parse', '--short', 'HEAD')})  이전 릴리스: ${previous ?? '없음'}\n\n${notes}`)
if (checkOnly) {
  console.log('✔ 확인만 했습니다(--check). 빌드·업로드는 하지 않았습니다.')
  process.exit(0)
}

const run = (command: string): void => {
  console.log(`\n> ${command}`)
  execSync(command, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, GH_TOKEN: token } })
}
run('npx electron-vite build')
run('npx electron-builder --win nsis --publish always')

const notesFile = join(mkdtempSync(join(tmpdir(), 'hd-release-')), 'notes.md')
writeFileSync(notesFile, notes, 'utf8')
out('gh', ['release', 'edit', tag, '--repo', REPO, '--draft=false', '--latest', '--title', `Hamster Desk ${version}`, '--notes-file', notesFile])
console.log(`\n✔ https://github.com/${REPO}/releases/tag/${tag}`)
