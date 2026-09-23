// What a push to main that did not raise the version leaves behind (scripts/release.ts, `--ci`).
//
// Such a push releases nothing: the tag of the version in package.json is already there. That is
// right for a typo in the docs, but it used to end in one quiet line on a green run whatever the
// push held — and installed apps kept saying "up to date", since they compare version numbers
// only. 0.1.18 went out twice that way: the release was built from 4bc5bc3, and the next commit,
// "0.1.18: 화면 전체 언어 설정…", never left the repository, though CHANGELOG listed it under
// 0.1.18 (docs/design-notes.md › 버전을 올리지 않은 릴리스 커밋). So now:
//   - a pushed commit whose subject names a version (CONTRIBUTING.md › 커밋) while the version was
//     not raised is an error — it meant to be a release and is not one;
//   - app changes waiting for the next version are listed on the run, as a warning.
// Pure, so that scripts/unit/release-guard.test.ts can run it without git.

export interface Commit {
  sha: string
  subject: string
}

/** `0.1.18: …` (or `v0.1.18: …`) → `0.1.18`: the subject of a commit that raises the version */
export function versionOfSubject(subject: string): string | null {
  const m = /^v?(\d+\.\d+\.\d+)\s*:/.exec(subject.trim())
  return m ? m[1] : null
}

/**
 * The pushed commits that call themselves a release while package.json still holds a version
 * that is out already — except the release commit itself (full SHAs), which a re-run of the
 * workflow can see.
 */
export function releaseCommitsWithoutBump(pushed: Commit[], releasedSha: string | null): (Commit & { version: string })[] {
  const out: (Commit & { version: string })[] = []
  for (const c of pushed) {
    const version = versionOfSubject(c.subject)
    if (version && c.sha !== releasedSha) out.push({ ...c, version })
  }
  return out
}

/**
 * What reaches an installed app: the code and what it is built with. Docs, tests, the release
 * tooling (scripts/) and the workflow do not.
 */
export const APP_PATHS = ['src', 'electron', 'shared', 'build', 'package.json', 'package-lock.json', 'electron.vite.config.ts', 'tsconfig.json']

/** `::error title=…::…` — a line GitHub Actions turns into an annotation on the run */
export function annotation(kind: 'error' | 'warning' | 'notice', title: string, message: string): string {
  const data = (s: string): string => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  const prop = (s: string): string => data(s).replace(/:/g, '%3A').replace(/,/g, '%2C')
  return `::${kind} title=${prop(title)}::${data(message)}`
}

/** The error for release commits that did not raise the version, in the words the run shows */
export function bumpMissingMessage(commits: (Commit & { version: string })[], version: string): string {
  const lines = commits.map((c) =>
    c.version === version
      ? `- ${c.sha.slice(0, 7)} "${c.subject}" — v${version} 은 이미 다른 커밋에서 나갔습니다`
      : `- ${c.sha.slice(0, 7)} "${c.subject}" — 제목은 ${c.version} 인데 package.json 은 ${version} 입니다`,
  )
  return [
    '제목이 버전인 커밋이 package.json 의 version 을 올리지 않아서, 아무것도 릴리스되지 않았습니다:',
    ...lines,
    `version 을 올려(${nextPatch(version)} 등) CHANGELOG 절과 함께 커밋·푸시하세요. 설치된 앱은 버전 번호만 비교하므로, 그 전까지는 "최신" 이라고 합니다.`,
  ].join('\n')
}

/** The warning for app changes that wait for the next version (commits since the release tag) */
export function pendingMessage(tag: string, commits: Commit[]): string {
  const shown = commits.slice(0, 20).map((c) => `- ${c.sha.slice(0, 7)} ${c.subject}`)
  const more = commits.length > shown.length ? [`- … 그 밖에 ${commits.length - shown.length}개`] : []
  return [
    `${tag} 이후 앱 코드를 바꾼 커밋 ${commits.length}개가 아직 릴리스되지 않았습니다 — 설치된 앱은 계속 "최신" 이라고 합니다.`,
    ...shown,
    ...more,
    '내보내려면 package.json 의 version 을 올려 푸시하세요.',
  ].join('\n')
}

export function nextPatch(version: string): string {
  const [a, b, c] = version.split('.').map(Number)
  return [a, b, (c || 0) + 1].join('.')
}
