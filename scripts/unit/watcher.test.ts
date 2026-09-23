// The transcript watcher (electron/watcher/): the incremental reader under a racing poll, 1 MB chunks
// and a rewritten file; the `model` events that no longer repeat themselves; finding a transcript
// without a synchronous scan; an external session that is judged once instead of every scan; and a
// watcher stopped halfway through starting. Everything runs against throwaway folders — no
// PowerShell (the parent map is handed in), no Electron.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Tailer } from '../../electron/watcher/tail'
import { ModelFilter, ProjectWatcher } from '../../electron/watcher/project'
import { findTranscript, projectSlug, transcriptAt } from '../../electron/watcher/paths'
import { SessionWatcher } from '../../electron/watcher/sessions'
import { DeskWatcher } from '../../electron/watcher'
import type { DeskEvent, SessionInfo } from '../../shared/events'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'hd-watcher-'))
const SID = '11111111-1111-4111-8111-111111111111'
const CWD = 'C:\\Users\\tester\\proj'

/** `n` lines of about `width` bytes, each one telling which it is */
function lines(prefix: string, n: number, width = 100): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}:`.padEnd(width, 'x'))
}

test('a poll before open() reads nothing, and polls racing open() do not replay the file', async () => {
  const p = join(tmp(), 'a.jsonl')
  const all = lines('L', 3000)
  writeFileSync(p, all.join('\n') + '\n')
  const got: string[] = []
  const t = new Tailer(p, (l) => got.push(l), { tailBytes: 100_000 })

  await t.poll()
  assert.equal(got.length, 0, 'the offset is not placed yet: this would have read 300 KB from byte 0')

  await Promise.all([t.open(), t.poll(), t.poll()])
  assert.ok(got.length > 900 && got.length < 1000, `about 100 KB of lines, the cut one dropped (got ${got.length})`)
  assert.equal(new Set(got).size, got.length, 'no line twice')
  assert.deepEqual(got, all.slice(all.length - got.length), 'a whole-line suffix of the file')

  appendFileSync(p, 'after\n')
  await t.poll()
  assert.equal(got.at(-1), 'after')
  t.close()
})

test('lines split across 1 MB chunks come out whole, multi-byte text and a 2.5 MB line included', async () => {
  const p = join(tmp(), 'b.jsonl')
  const huge = `{"image":"${'한글'.repeat(420_000)}"}` // ≈ 2.5 MB of 3-byte characters: one line, three chunks
  const all = [...lines('가', 5000, 60), huge, ...lines('나', 20_000, 60)]
  writeFileSync(p, all.join('\r\n') + '\r\n')
  const got: string[] = []
  const t = new Tailer(p, (l) => got.push(l))
  await t.open()
  assert.equal(got.length, all.length)
  assert.equal(got[5000], huge, 'the long line survives the chunk borders (and its CR is gone)')
  assert.deepEqual(got, all)
  t.close()
})

test('a rewritten file is read again from its tail, not from byte 0', async () => {
  const p = join(tmp(), 'c.jsonl')
  writeFileSync(p, lines('A', 5000).join('\n') + '\n') // 500 KB
  const got: string[] = []
  const t = new Tailer(p, (l) => got.push(l), { tailBytes: 100_000 })
  await t.open()
  got.length = 0

  const b = lines('B', 3000) // 300 KB: shorter than where the reader was
  writeFileSync(p, b.join('\n') + '\n')
  await t.poll()
  assert.ok(got.length > 900 && got.length < 1000, `only the last 100 KB again (got ${got.length})`)
  assert.equal(got.at(-1), b.at(-1))
  assert.ok(!got.includes(b[0]), 'not the whole file from the start')
  t.close()
})

test('ModelFilter passes only what changes the hamster, repeats itself now and then, and forgets on request', () => {
  const f = new ModelFilter(100)
  const m = (model: string, effort: string | null, agentId: string | null = null) => ({ sessionId: 's', agentId, model, effort })
  assert.equal(f.pass(m('opus', 'high'), 0), true, 'the first one')
  assert.equal(f.pass(m('opus', 'high'), 1), false, 'the same again')
  assert.equal(f.pass(m('opus', null), 2), false, 'no effort keeps the last one, as the store does')
  assert.equal(f.pass(m('opus', 'low'), 3), true, 'a new effort')
  assert.equal(f.pass(m('sonnet', null), 4), true, 'a new model')
  assert.equal(f.pass(m('sonnet', 'low'), 5), false, 'the effort carried over from before')
  assert.equal(f.pass(m('sonnet', 'low'), 104), true, 'repeated once 100 events have gone out')
  assert.equal(f.pass(m('sonnet', 'low'), 105), false)

  assert.equal(f.pass(m('haiku', 'low', 'a1'), 106), true, 'an agent is its own key')
  assert.equal(f.pass(m('haiku', 'low', 'a1'), 107), false)
  f.forget('s', 'a1')
  assert.equal(f.pass(m('haiku', 'low', 'a1'), 108), true, 'a finished agent that comes back is told again')
  assert.equal(f.pass(m('sonnet', 'low'), 109), false, 'forgetting an agent leaves the main one alone')

  f.pass({ ...m('opus', 'high'), sessionId: 't' }, 110)
  f.forget('s')
  assert.equal(f.pass(m('sonnet', 'low'), 111), true, 'a closed session starts over')
  assert.equal(f.pass(m('haiku', 'low', 'a1'), 112), true)
  assert.equal(f.pass({ ...m('opus', 'high'), sessionId: 't' }, 113), false, 'another session keeps its own')
})

/** a project folder with one main transcript: three records of one model, one of another, and a title */
function project(): { dir: string; path: string } {
  const dir = tmp()
  const path = join(dir, `${SID}.jsonl`)
  const assistant = (model: string, text: string) => ({
    type: 'assistant',
    timestamp: '2026-09-23T01:00:00.000Z',
    perTurnEffort: 'high',
    message: { model, content: [{ type: 'text', text }] },
  })
  const recs = [assistant('opus', 'one'), assistant('opus', 'two'), assistant('opus', 'three'), assistant('sonnet', 'four'), { type: 'ai-title', aiTitle: '제목' }]
  writeFileSync(path, recs.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return { dir, path }
}

test('a transcript says its model once per change, and a session tracked again hears its title and model again', async () => {
  const { dir } = project()
  const pw = new ProjectWatcher(dir) // never start()ed: no fs.watch, no poll timer
  const got: DeskEvent[] = []
  pw.on('event', (e: DeskEvent) => got.push(e))

  await pw.track(SID)
  const models = () => got.filter((e) => e.kind === 'model').map((e) => (e.kind === 'model' ? e.model : ''))
  assert.deepEqual(models(), ['opus', 'sonnet'])
  assert.equal(got.filter((e) => e.kind === 'text').length, 4, 'everything else still goes through')
  assert.equal(got.filter((e) => e.kind === 'title').length, 1)

  pw.untrack(SID) // the session ended …
  got.length = 0
  await pw.track(SID) // … and came back with the same id (claude --resume)
  assert.deepEqual(models(), ['opus', 'sonnet'])
  assert.equal(got.filter((e) => e.kind === 'title').length, 1, 'the renderer dropped the session and needs its title again')
  pw.stop()
})

test('a transcript is found in its slug folder with one look, and anywhere else by the full search', async () => {
  const base = tmp()
  assert.equal(await findTranscript(SID, CWD, base), null, 'no projects folder at all')
  mkdirSync(join(base, 'projects', projectSlug(CWD)), { recursive: true })
  mkdirSync(join(base, 'projects', 'elsewhere'), { recursive: true })
  assert.equal(await transcriptAt(SID, CWD, base), null)
  assert.equal(await findTranscript(SID, CWD, base), null)

  const other = join(base, 'projects', 'elsewhere', `${SID}.jsonl`)
  writeFileSync(other, '')
  assert.equal(await transcriptAt(SID, CWD, base), null, 'the cheap look only knows the slug folder')
  assert.equal(await findTranscript(SID, CWD, base), other)

  const direct = join(base, 'projects', projectSlug(CWD), `${SID}.jsonl`)
  writeFileSync(direct, '')
  assert.equal(await transcriptAt(SID, CWD, base), direct)
  assert.equal(await findTranscript(SID, CWD, base), direct, 'the slug folder first')
  assert.equal(await transcriptAt(SID, undefined, base), null, 'no cwd, no slug')
})

/** a config folder whose sessions/ holds one live session: this test process itself */
function sessionHome(sessionId = SID): string {
  const base = tmp()
  mkdirSync(join(base, 'sessions'), { recursive: true })
  writeFileSync(join(base, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId, cwd: CWD, status: 'idle' }))
  return base
}

test('an external session is judged once, and again only when this window gets a new shell', async () => {
  const base = sessionHome()
  let asked = 0
  const parents = async (): Promise<Map<number, number>> => {
    asked++
    return new Map([[process.pid, 1]]) // its parent is nobody of ours
  }
  let shells = [{ ptyId: 1, pid: 424242 }]
  const w = new SessionWatcher({ ownedShells: () => shells, baseDir: base, parents })
  const seen: SessionInfo[] = []
  w.on('session', (s: SessionInfo) => seen.push(s))

  await w.scan()
  assert.equal(asked, 1)
  assert.equal(seen.at(-1)?.mine, false)
  await w.scan()
  await w.scan()
  assert.equal(asked, 1, 'used to be a PowerShell + WMI query every few seconds')

  shells = [...shells, { ptyId: 2, pid: 434343 }]
  await w.scan()
  assert.equal(asked, 2, 'a new shell asks again')
  shells = [shells[1]]
  await w.scan()
  assert.equal(asked, 2, 'a closed one does not')
  w.stop()
})

test('a verdict from a map that did not know the pid is asked about again', async () => {
  const base = sessionHome()
  let asked = 0
  const parents = async (): Promise<Map<number, number>> => {
    asked++
    return new Map() // a failed query answers with an empty map
  }
  const w = new SessionWatcher({ ownedShells: () => [{ ptyId: 1, pid: 424242 }], baseDir: base, parents })
  await w.scan()
  assert.equal(asked, 2, 'once, then once more with a fresh map')
  await w.scan()
  assert.equal(asked, 4, 'not settled: the next scan asks again')
  w.stop()
})

test('a session in one of our shells is ours, and is not asked about again', async () => {
  const base = sessionHome()
  let asked = 0
  const parents = async (): Promise<Map<number, number>> => {
    asked++
    return new Map([
      [process.pid, 777],
      [777, 1],
    ])
  }
  const w = new SessionWatcher({ ownedShells: () => [{ ptyId: 5, pid: 777 }], baseDir: base, parents })
  const seen: SessionInfo[] = []
  w.on('session', (s: SessionInfo) => seen.push(s))
  await w.scan()
  await w.scan()
  assert.equal(asked, 1)
  assert.equal(seen.at(-1)?.ptyId, 5)
  w.stop()
})

test('a session without a transcript is looked for in its slug folder every tick, everywhere else with backoff', async () => {
  const base = sessionHome()
  mkdirSync(join(base, 'projects', 'elsewhere'), { recursive: true })
  const w = new DeskWatcher({ baseDir: base }) // not start()ed: the test drives the scan and the retries
  const priv = w as unknown as {
    pendingTranscript: Map<string, { scanAt: number; misses: number }>
    retryPending: () => Promise<void>
  }
  const events: DeskEvent[] = []
  w.on('event', (e: DeskEvent) => events.push(e))

  await w.rescan()
  const pending = priv.pendingTranscript.get(SID)
  assert.ok(pending, 'no transcript yet: pending')
  assert.equal(pending.scanAt, 0, 'the first full look is due at once')

  await priv.retryPending()
  assert.equal(pending.misses, 1)
  const next = pending.scanAt
  assert.ok(next > Date.now(), 'the next full look is put off')
  await priv.retryPending()
  assert.equal(pending.misses, 1, 'before it is due only the slug folder is looked at')
  assert.equal(pending.scanAt, next)

  const other = join(base, 'projects', 'elsewhere', `${SID}.jsonl`)
  writeFileSync(other, '')
  await priv.retryPending()
  assert.ok(priv.pendingTranscript.has(SID), 'a folder the slug rule does not name waits for the full look')
  pending.scanAt = 0 // time passes
  await priv.retryPending()
  assert.ok(!priv.pendingTranscript.has(SID))
  const last = events.filter((e) => e.kind === 'session').at(-1)
  assert.equal(last?.kind === 'session' ? last.transcriptPath : null, other)
  w.stop()
})

test('stop() while start() is still scanning leaves no timer behind', async () => {
  const base = tmp()
  mkdirSync(join(base, 'sessions'), { recursive: true })
  const w = new DeskWatcher({ baseDir: base })
  const started = w.start()
  w.stop()
  await started
  assert.equal((w as unknown as { locate: unknown }).locate, null, 'the retry interval was set up after stop() and never cleared')
})
