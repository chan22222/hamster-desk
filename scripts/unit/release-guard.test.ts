// The release guard (scripts/release-guard.ts): a commit titled as a release that did not raise the
// version fails the run, app changes waiting for the next version are listed, and what goes to
// GitHub Actions is escaped the way its workflow commands want.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { annotation, bumpMissingMessage, nextPatch, pendingMessage, releaseCommitsWithoutBump, versionOfSubject } from '../release-guard'

const sha = (c: string): string => c.repeat(40)

test('a subject that names a version, and one that does not', () => {
  assert.equal(versionOfSubject('0.1.18: 화면 전체 언어 설정(9개 언어), 같은 로그인 계정 합치기'), '0.1.18')
  assert.equal(versionOfSubject('v0.1.19: 두 줄 탭'), '0.1.19')
  assert.equal(versionOfSubject('  10.2.3 : 공백이 있어도'), '10.2.3')
  assert.equal(versionOfSubject('알림: 턴 완료는 기본 꺼짐'), null)
  assert.equal(versionOfSubject('0.1.18 없이 쓴 제목'), null)
  assert.equal(versionOfSubject('책상: 0.1.18: 제목 가운데의 버전'), null)
  assert.equal(versionOfSubject('0.1: 두 자리 버전'), null)
})

test('the 0.1.18 that never shipped: a release commit after the released one is caught', () => {
  // v0.1.18 was built from 4bc5bc3; ae0d2f8 was titled 0.1.18 too and changed no version
  const pushed = [
    { sha: sha('a'), subject: '0.1.18: 화면 전체 언어 설정(9개 언어)' },
    { sha: sha('b'), subject: '감시기: 앱 밖 세션을 다시 묻지 않고' },
  ]
  const found = releaseCommitsWithoutBump(pushed, sha('4'))
  assert.deepEqual(found.map((c) => [c.sha, c.version]), [[sha('a'), '0.1.18']])
  assert.match(bumpMissingMessage(found, '0.1.18'), /v0\.1\.18 은 이미 다른 커밋에서 나갔습니다/)
  assert.match(bumpMissingMessage(found, '0.1.18'), /0\.1\.19/)
})

test('a title that names another version than package.json is caught with its own words', () => {
  const found = releaseCommitsWithoutBump([{ sha: sha('c'), subject: '0.1.20: 새 기능' }], sha('4'))
  assert.equal(found.length, 1)
  assert.match(bumpMissingMessage(found, '0.1.19'), /제목은 0\.1\.20 인데 package\.json 은 0\.1\.19 입니다/)
})

test('the release commit itself, seen again by a re-run, is not a missing bump', () => {
  assert.deepEqual(releaseCommitsWithoutBump([{ sha: sha('4'), subject: '0.1.18: 사이드바' }], sha('4')), [])
  assert.deepEqual(releaseCommitsWithoutBump([{ sha: sha('5'), subject: '문서: 오타' }], sha('4')), [])
  assert.deepEqual(releaseCommitsWithoutBump([], null), [])
})

test('waiting app changes: listed, at most twenty, with the count of the rest', () => {
  const commits = Array.from({ length: 23 }, (_, i) => ({ sha: `${i}`.padStart(40, 'f'), subject: `커밋 ${i}` }))
  const text = pendingMessage('v0.1.18', commits)
  assert.match(text, /^v0\.1\.18 이후 앱 코드를 바꾼 커밋 23개가 아직 릴리스되지 않았습니다/)
  assert.equal(text.split('\n').filter((l) => l.startsWith('- ffff')).length, 20)
  assert.match(text, /그 밖에 3개/)
})

test('annotations are escaped for GitHub Actions: % CR LF everywhere, : and , in the title', () => {
  assert.equal(annotation('warning', 'a: b, c', '100% 첫 줄\r\n둘째 줄'), '::warning title=a%3A b%2C c::100%25 첫 줄%0D%0A둘째 줄')
  assert.equal(annotation('error', '제목', 'x'), '::error title=제목::x')
})

test('the next patch version', () => {
  assert.equal(nextPatch('0.1.18'), '0.1.19')
  assert.equal(nextPatch('1.2.9'), '1.2.10')
})
