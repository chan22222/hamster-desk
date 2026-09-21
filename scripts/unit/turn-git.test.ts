// Turn summaries and git parsing — the two places where a wrong answer is quiet. A turn card that
// counts the whole conversation's edits looks perfectly plausible, and so does a branch chip that
// reads `[ahead 1]` as a changed file.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeTurn, type TurnSource } from '../../src/log/turn'
import { parseStatus } from '../../electron/git'
import { classifyDiffLine } from '../../src/git/diff'

const TURN_AT = 1_000_000

/** three edits, the first one from the previous turn */
const session: TurnSource = {
  turnStartedAt: TURN_AT,
  lastSaid: '  README 를  정리했어요\n',
  edits: [
    { ts: TURN_AT - 5_000, file: 'C:/p/old.ts', added: 99, removed: 99 },
    { ts: TURN_AT + 1_000, file: 'C:/p/a.ts', added: 10, removed: 4 },
    { ts: TURN_AT + 2_000, file: 'C:/p/a.ts', added: 2, removed: 0 },
  ],
}

test('summarizeTurn counts only the edits that belong to this turn', () => {
  const s = summarizeTurn(session, { durationMs: 130_000, ts: TURN_AT + 130_000 })
  assert.equal(s.files, 1, 'the two edits after the prompt touched one file')
  assert.equal(s.added, 12)
  assert.equal(s.removed, 4)
  assert.equal(s.durationMs, 130_000)
  assert.equal(s.said, 'README 를 정리했어요')
  assert.equal(s.at, TURN_AT + 130_000)
})

test('summarizeTurn measures the turn itself when the event carries no duration', () => {
  const s = summarizeTurn(session, { ts: TURN_AT + 45_000 })
  assert.equal(s.durationMs, 45_000)
})

test('summarizeTurn claims nothing for a turn that started before we were watching', () => {
  const s = summarizeTurn({ ...session, turnStartedAt: null }, { ts: TURN_AT })
  assert.deepEqual([s.files, s.added, s.removed, s.durationMs], [0, 0, 0, 0])
})

test('parseStatus separates the branch header from the changed paths', () => {
  const out = ['## main...origin/main [ahead 1]', ' M src/store.ts', '?? work/new.png', 'A  shared/events.ts', ''].join('\n')
  assert.deepEqual(parseStatus(out), { branch: 'main', changed: 3, ahead: 1, behind: 0 })
})

test('parseStatus handles CRLF, both tracking numbers, a detached head and a fresh repo', () => {
  assert.deepEqual(parseStatus('## dev...origin/dev [ahead 2, behind 5]\r\n M a.ts\r\n'), { branch: 'dev', changed: 1, ahead: 2, behind: 5 })
  assert.deepEqual(parseStatus('## HEAD (no branch)\n M a.ts\n'), { branch: null, changed: 1, ahead: 0, behind: 0 })
  assert.deepEqual(parseStatus('## No commits yet on main\n?? a.ts\n'), { branch: 'main', changed: 1, ahead: 0, behind: 0 })
  assert.deepEqual(parseStatus('## main\n'), { branch: 'main', changed: 0, ahead: 0, behind: 0 })
})

test('classifyDiffLine tells the file header apart from the lines it is about', () => {
  assert.equal(classifyDiffLine('@@ -1,4 +1,6 @@ export function f()'), 'hunk')
  assert.equal(classifyDiffLine('--- a/src/store.ts'), 'meta')
  assert.equal(classifyDiffLine('+++ b/src/store.ts'), 'meta')
  assert.equal(classifyDiffLine('diff --git a/README.md b/README.md'), 'meta')
  assert.equal(classifyDiffLine('index 1a2b3c4..5d6e7f8 100644'), 'meta')
  assert.equal(classifyDiffLine('new file mode 100644'), 'meta')
  assert.equal(classifyDiffLine('\\ No newline at end of file'), 'meta')
  assert.equal(classifyDiffLine('+  const added = 1'), 'add')
  assert.equal(classifyDiffLine('-  const removed = 1'), 'del')
  assert.equal(classifyDiffLine('   untouched'), 'ctx')
  assert.equal(classifyDiffLine(''), 'ctx')
})
