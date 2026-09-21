// `electron/transcripts.ts` reads real Claude Code transcripts, so the fixtures here are the shapes
// that actually turned up on disk while the feature was designed (plan §0, row 3): a file whose
// *first* line is a `last-prompt` marker, a file that re-appends `ai-title` every time the title is
// revised, and a file that never got a typed prompt at all.
//
// The module imports nothing from `electron`, which is what lets this run under plain tsx.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listTranscripts } from '../../electron/transcripts'
import { projectSlug } from '../../electron/watcher/paths'

const CWD = 'C:\\Users\\tester\\proj'

/** A throwaway `~/.claude` whose `projects/<slug>` folder holds the fixtures of one test. */
function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'hd-transcripts-'))
  mkdirSync(join(home, 'projects', projectSlug(CWD)), { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = home
  return home
}

function writeFixture(home: string, sessionId: string, records: unknown[]): void {
  const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
  writeFileSync(join(home, 'projects', projectSlug(CWD), `${sessionId}.jsonl`), lines, 'utf8')
}

/** the one record shape that makes a transcript listable: a typed prompt from a human */
function userRecord(text: string, at: string, branch = 'main'): unknown {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    timestamp: at,
    cwd: CWD,
    gitBranch: branch,
    version: '2.1.278',
    sessionId: 'x',
  }
}

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const ID_C = '33333333-3333-4333-8333-333333333333'
const ID_D = '44444444-4444-4444-8444-444444444444'

test('a transcript whose first line is a last-prompt marker still lists, and the marker becomes the subtitle', async () => {
  const home = makeHome()
  writeFixture(home, ID_A, [
    { type: 'last-prompt', lastPrompt: '첫 줄부터 마지막 프롬프트', leafUuid: 'a', sessionId: ID_A },
    { type: 'mode', mode: 'normal', sessionId: ID_A },
    userRecord('터미널 검색을 붙여 줘', '2026-09-20T01:00:00.000Z', 'feature/search'),
    { type: 'assistant', message: { role: 'assistant', content: [] }, timestamp: '2026-09-20T01:00:09.000Z' },
  ])

  const list = await listTranscripts(CWD, new Set())
  assert.equal(list.length, 1)
  const [e] = list
  assert.equal(e.sessionId, ID_A)
  // no title record at all, so the first prompt is the title
  assert.equal(e.title, '터미널 검색을 붙여 줘')
  assert.equal(e.subtitle, '첫 줄부터 마지막 프롬프트')
  assert.equal(e.branch, 'feature/search')
  assert.equal(e.startedAt, Date.parse('2026-09-20T01:00:00.000Z'))
  assert.equal(e.lastAt, Date.parse('2026-09-20T01:00:09.000Z'))
  assert.equal(e.live, false)
})

test('the last ai-title wins, and a live session is flagged rather than hidden', async () => {
  const home = makeHome()
  writeFixture(home, ID_B, [
    userRecord('처음 물어본 것', '2026-09-20T02:00:00.000Z'),
    { type: 'ai-title', aiTitle: '처음 붙은 제목', sessionId: ID_B },
    { type: 'ai-title', aiTitle: '고쳐 붙은 제목', sessionId: ID_B },
    { type: 'ai-title', aiTitle: '마지막 제목', sessionId: ID_B },
    { type: 'last-prompt', lastPrompt: '마지막으로 물어본 것', sessionId: ID_B },
  ])

  const list = await listTranscripts(CWD, new Set([ID_B]))
  assert.equal(list.length, 1)
  assert.equal(list[0].title, '마지막 제목')
  assert.equal(list[0].subtitle, '마지막으로 물어본 것')
  assert.equal(list[0].live, true)
})

test('a transcript with no typed prompt is left out of the list', async () => {
  const home = makeHome()
  // opened, told itself a few things, never asked anything: nothing to resume
  writeFixture(home, ID_C, [
    { type: 'mode', mode: 'normal', sessionId: ID_C },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: the CLI wrote this' }, timestamp: '2026-09-20T03:00:00.000Z' },
    {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      timestamp: '2026-09-20T03:00:01.000Z',
    },
    { type: 'ai-title', aiTitle: '제목만 있는 파일', sessionId: ID_C },
  ])

  assert.deepEqual(await listTranscripts(CWD, new Set()), [])
})

test('title priority: custom-title beats ai-title beats the first prompt', async () => {
  const home = makeHome()
  // 1. custom over ai
  writeFixture(home, ID_A, [
    userRecord('첫 프롬프트 A', '2026-09-20T04:00:00.000Z'),
    { type: 'ai-title', aiTitle: 'AI 가 지은 제목', sessionId: ID_A },
    { type: 'custom-title', customTitle: '사람이 지은 제목', sessionId: ID_A },
  ])
  // 2. ai over the first prompt
  writeFixture(home, ID_B, [userRecord('첫 프롬프트 B', '2026-09-20T05:00:00.000Z'), { type: 'ai-title', aiTitle: 'AI 제목 B', sessionId: ID_B }])
  // 3. the first prompt when there is no title record; `sessionId.slice(0, 8)` is the last resort
  //    below this one, and it only fires if a prompt somehow survives `promptOf` but clips to ''
  writeFixture(home, ID_C, [userRecord('첫 프롬프트 C', '2026-09-20T06:00:00.000Z')])
  // a prompt that is nothing but whitespace is no prompt at all
  writeFixture(home, ID_D, [userRecord(' \t ', '2026-09-20T07:00:00.000Z')])

  const list = await listTranscripts(CWD, new Set())
  const byId = new Map(list.map((e) => [e.sessionId, e]))
  assert.equal(byId.get(ID_A)?.title, '사람이 지은 제목')
  assert.equal(byId.get(ID_B)?.title, 'AI 제목 B')
  assert.equal(byId.get(ID_C)?.title, '첫 프롬프트 C')
  assert.equal(byId.has(ID_D), false)
  // newest first: these were written in order, so mtime puts the last one written on top
  assert.deepEqual([...list].sort((a, b) => b.lastAt - a.lastAt).map((e) => e.sessionId), [ID_C, ID_B, ID_A])
})

test('a long first prompt is clipped into a title, and the whole file is never needed', async () => {
  const home = makeHome()
  const long = '아주 긴 프롬프트를 적으면 제목은 60자에서 잘려야 한다. '.repeat(6)
  const filler = Array.from({ length: 400 }, (_, i) => ({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: `줄 ${i} ${'가'.repeat(300)}` }] },
    timestamp: '2026-09-20T08:00:05.000Z',
  }))
  writeFixture(home, ID_A, [userRecord(long, '2026-09-20T08:00:00.000Z'), ...filler, { type: 'last-prompt', lastPrompt: '끝', sessionId: ID_A }])

  const [e] = await listTranscripts(CWD, new Set())
  assert.equal(e.title.length, 60)
  assert.ok(e.title.endsWith('…'))
  assert.equal(e.subtitle, '끝')
  // the tail marker was still found even though the head cut off long before it
  assert.ok(e.size > 64 * 1024)
})

test('a session made of local slash commands only is left out, however many `user` records it has', async () => {
  const home = makeHome()
  // what `/login` then `/effort low` leave behind: `user` records, but nothing was ever asked
  writeFixture(home, ID_A, [
    { type: 'mode', mode: 'normal', sessionId: ID_A },
    { type: 'user', isMeta: true, message: { role: 'user', content: '<local-command-caveat>Caveat: generated by local commands</local-command-caveat>' }, timestamp: '2026-09-20T09:00:00.000Z' },
    userRecord('<command-name>/login</command-name>\n            <command-message>login</command-message>\n            <command-args></command-args>', '2026-09-20T09:00:01.000Z'),
    userRecord('<local-command-stdout>Login interrupted</local-command-stdout>', '2026-09-20T09:00:02.000Z'),
    userRecord('<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args>low</command-args>', '2026-09-20T09:00:03.000Z'),
  ])
  // the same opening, but then something real was typed: the commands are skipped, not the session
  writeFixture(home, ID_B, [
    userRecord('<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args>low</command-args>', '2026-09-20T09:10:00.000Z'),
    userRecord('<local-command-stdout>Set effort level to low</local-command-stdout>', '2026-09-20T09:10:01.000Z'),
    userRecord('이제 진짜 질문', '2026-09-20T09:10:05.000Z', 'feature/x'),
  ])

  const list = await listTranscripts(CWD, new Set())
  assert.deepEqual(list.map((e) => e.sessionId), [ID_B])
  assert.equal(list[0].title, '이제 진짜 질문')
  assert.equal(list[0].startedAt, Date.parse('2026-09-20T09:10:00.000Z'))
  assert.equal(list[0].branch, 'feature/x')
})

test('a first prompt too long for the head (a pasted image) still lists, by its last-prompt marker', async () => {
  const home = makeHome()
  const image = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: '[Image #1]' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(90_000) } }] },
    timestamp: '2026-09-20T10:00:01.000Z',
    gitBranch: 'main',
  }
  writeFixture(home, ID_C, [
    { type: 'system', subtype: 'info', timestamp: '2026-09-20T10:00:00.000Z', gitBranch: 'main', sessionId: ID_C },
    { type: 'last-prompt', lastPrompt: '[Image #1]', sessionId: ID_C },
    image,
    { type: 'assistant', message: { role: 'assistant', content: [] }, timestamp: '2026-09-20T10:00:09.000Z' },
    { type: 'last-prompt', lastPrompt: '이 화면이 왜 이렇게 보여?', sessionId: ID_C },
  ])

  const [e] = await listTranscripts(CWD, new Set())
  assert.equal(e.sessionId, ID_C)
  assert.equal(e.title, '이 화면이 왜 이렇게 보여?')
  // the prompt line itself never fit, so the session's first record says when and where it began
  assert.equal(e.startedAt, Date.parse('2026-09-20T10:00:00.000Z'))
  assert.equal(e.branch, 'main')
  assert.equal(e.lastAt, Date.parse('2026-09-20T10:00:09.000Z'))
})
