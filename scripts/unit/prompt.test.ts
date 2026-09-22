// "This terminal is waiting for an answer" (electron/prompt.ts): the screen patterns — above all the
// multiple-choice question, which no pattern matched while its footer said "select" — and the gate
// that merges the screen with the transcript without saying anything twice or too late.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PromptDetector, QUESTION_FRESH_MS, WaitingGate, WAITING_TWICE_MS, stripTerminal, type WaitReason } from '../../electron/prompt'

const ESC = '\x1b'
/** how the TUI draws: every row positioned with a cursor move, words coloured, dim footers */
const at = (row: number, col: number): string => `${ESC}[${row};${col}H`
const dim = (s: string): string => `${ESC}[2m${s}${ESC}[22m`

function screen(rows: string[]): string {
  return rows.map((r, i) => `${at(10 + i, 1)}${ESC}[2K${r}`).join('')
}

/** AskUserQuestion, one question, as CLI 2.1.x draws it */
const ONE_QUESTION = screen([
  `${ESC}[1m어떤 방식으로 할까요?${ESC}[22m`,
  `${ESC}[38;5;153m❯${ESC}[39m 1. 트랜스크립트로 감지 (추천)`,
  '  2. 화면 문구만 고치기',
  '  3. Type something.',
  '',
  '  4. Chat about this',
  '',
  dim('Enter to select · ↑/↓ to navigate · Esc to cancel'),
])

function detect(...chunks: string[]): WaitReason[] {
  const got: WaitReason[] = []
  const d = new PromptDetector((r) => got.push(r))
  for (const c of chunks) d.feed(c)
  return got
}

test('the multiple-choice question is a question — the footer that says "select" included', () => {
  assert.deepEqual(detect(ONE_QUESTION), ['question'])
  // the TUI writes a frame in pieces; the words land in separate chunks
  const cut = Math.floor(ONE_QUESTION.length / 2)
  assert.deepEqual(detect(ONE_QUESTION.slice(0, cut), ONE_QUESTION.slice(cut)), ['question'])
})

test('several questions: the footer says Tab/Arrow keys instead', () => {
  const many = screen(['☐ 방식  ☐ 범위  ✔ Submit', '', '❯ 1. 빠르게', '  2. 꼼꼼하게', '  3. Chat about this', '', dim('Enter to select · Tab/Arrow keys to navigate · Esc to cancel')])
  assert.deepEqual(detect(many), ['question'])
})

test('prose that merely mentions the words is not a question', () => {
  assert.deepEqual(detect(screen(['그 화면에는 Chat about this 라는 선택지가 늘 붙는다.', '안내 줄의 Enter to select 는 나중에 바뀌었다.'])), [])
  assert.deepEqual(detect(screen(['● Enter to select · ↑/↓ to navigate'])), [])
  assert.deepEqual(detect(screen(['질문이 여러 개면 Tab/Arrow keys to navigate 라고 쓴다'])), [])
})

test('the old prompts still match as before', () => {
  assert.deepEqual(detect(screen(['Do you want to proceed?', '❯ 1. Yes', "  2. Yes, and don't ask again", '  3. No'])), ['permission'])
  assert.deepEqual(detect(screen(['Yes, I trust this folder'])), ['question'])
  assert.equal(stripTerminal(`${ESC}[31mEnter${ESC}[0m to  confirm`), 'Entertoconfirm')
})

test('private CSI sequences (ESC[>0q, ESC[<u) are stripped, so they cannot split a pattern', () => {
  assert.equal(stripTerminal(`Chat about this${ESC}[>0q${ESC}[>4m${ESC}[<u Enter to select`), 'ChataboutthisEntertoselect')
  // the tail of a real CLI 2.1.278 frame, as recorded from the app's own terminal
  assert.deepEqual(detect(`  4. Chat about this${ESC}[>4m${ESC}[2B${ESC}[2mEnter to select · ↑/↓ to navigate · Esc to cancel${ESC}[22m${ESC}[>0q`), ['question'])
})

// ---- the gate

function gate(start = 1_000_000) {
  const clock = { now: start }
  const said: { ptyId: number; reason: WaitReason; ts: number }[] = []
  const g = new WaitingGate((ptyId, reason, ts) => said.push({ ptyId, reason, ts }), () => clock.now)
  return { g, said, clock }
}

test('screen first, transcript a second later: one notification, not two', () => {
  const { g, said, clock } = gate()
  const shown = clock.now
  g.waiting(1, 'question')
  clock.now += 1500
  g.asked(1, shown)
  assert.equal(said.length, 1)
})

test('the transcript alone is enough when the screen pattern misses', () => {
  const { g, said, clock } = gate()
  const shown = clock.now
  clock.now += 2000
  g.asked(1, shown)
  assert.deepEqual(said, [{ ptyId: 1, reason: 'question', ts: clock.now }])
})

test('answered before the record arrived, or an old question from a catch-up: nothing', () => {
  const { g, said, clock } = gate()
  const shown = clock.now
  clock.now += 500
  g.answered(1) // Enter, half a second after it appeared
  clock.now += 1500
  g.asked(1, shown)
  assert.equal(said.length, 0)

  g.asked(2, clock.now - QUESTION_FRESH_MS - 1)
  assert.equal(said.length, 0)
})

test('a new prompt right after an answer is said again; one without an answer is not', () => {
  const { g, said, clock } = gate()
  g.waiting(1, 'permission')
  clock.now += 1000
  g.answered(1)
  clock.now += 1000
  g.waiting(1, 'permission') // the next tool's prompt
  assert.equal(said.length, 2)
  clock.now += 1000
  g.waiting(1, 'permission') // the same prompt redrawn
  assert.equal(said.length, 2)
  clock.now += WAITING_TWICE_MS
  g.waiting(1, 'permission')
  assert.equal(said.length, 3, 'long enough after, it is news again')
  // terminals are separate
  g.waiting(2, 'question')
  assert.equal(said.length, 4)
})
