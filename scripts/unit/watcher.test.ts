// The transcript watcher (electron/watcher/): the incremental reader under a racing poll, 1 MB chunks
// and a rewritten file; the `model` events that no longer repeat themselves; finding a transcript
// without a synchronous scan; an external session that is judged once instead of every scan; a
// watcher stopped halfway through starting; subagents that end without an end_turn (a parent's
// task notification, found in the catch-up or further back, and a workflow agent's StructuredOutput);
// a pid file caught mid-rewrite; and the `user` records the CLI writes itself, which are no prompt.
// Everything runs against throwaway folders — no PowerShell (the parent map is handed in), no Electron.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Tailer, scanLines } from '../../electron/watcher/tail'
import { parseRecord } from '../../electron/watcher/parse'
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

test('a poll made while a read runs resolves once what was in the file by then has been read', async () => {
  const p = join(tmp(), 'd.jsonl')
  writeFileSync(p, lines('D', 30_000).join('\n') + '\n') // 3 MB: three chunks, with a yield between them
  const got: string[] = []
  let asked: Promise<void> | null = null
  const t = new Tailer(p, (l) => {
    got.push(l)
    if (asked) return
    appendFileSync(p, 'after\n')
    asked = t.poll() // used to resolve at once, with the first chunk still being read
  })
  const opening = t.open()
  while (!asked) await new Promise((r) => setImmediate(r))
  await asked
  assert.equal(got.at(-1), 'after')
  await opening
  t.close()
})

// Subagents that never write an end_turn: the parent's <task-notification>, and a workflow agent's StructuredOutput.

const T0 = Date.parse('2026-09-23T02:00:00.000Z')
const at = (ms: number): string => new Date(T0 + ms).toISOString()
const jsonl = (recs: unknown[]): string => recs.map((r) => JSON.stringify(r) + '\n').join('')
const said = (text: string, ms: number) => ({ type: 'assistant', timestamp: at(ms), message: { model: 'opus', content: [{ type: 'text', text }], stop_reason: 'tool_use' } })
const calls = (id: string, name: string, ms: number) => ({ type: 'assistant', timestamp: at(ms), message: { model: 'opus', content: [{ type: 'tool_use', id, name, input: {} }] } })
const result = (id: string, ms: number, error = false) => ({
  type: 'user',
  timestamp: at(ms),
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: error ? 'Output does not match the schema' : 'Structured output provided successfully', ...(error ? { is_error: true } : {}) }] },
})
/** what Claude Code writes to the parent when a background task stops */
const notice = (taskId: string, status = 'completed'): string =>
  `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>${status}</status>\n<summary>Agent "x" finished</summary>\n<note>the same task-id may notify more than once</note>\n<result>done</result>\n</task-notification>`
const queued = (taskId: string, ms: number, status?: string) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: at(ms), sessionId: SID, content: notice(taskId, status) })
const handedIn = (taskId: string, ms: number) => ({ type: 'attachment', timestamp: at(ms), attachment: { type: 'queued_command', prompt: notice(taskId), commandMode: 'task-notification' } })
const asUser = (taskId: string, ms: number, status?: string) => ({ type: 'user', timestamp: at(ms), message: { role: 'user', content: notice(taskId, status) } })

/** a project folder with a main transcript and agent transcripts (each with its meta), under `sub` of subagents/ */
function withAgents(main: unknown[], agents: Record<string, unknown[]>, sub = ''): { dir: string; mainPath: string; agentPath: (id: string) => string } {
  const dir = tmp()
  const mainPath = join(dir, `${SID}.jsonl`)
  writeFileSync(mainPath, jsonl(main))
  const folder = join(dir, SID, 'subagents', sub)
  mkdirSync(folder, { recursive: true })
  const agentPath = (id: string): string => join(folder, `agent-${id}.jsonl`)
  for (const [id, recs] of Object.entries(agents)) {
    const meta = sub ? { agentType: 'workflow-subagent', spawnDepth: 1 } : { agentType: 'general-purpose', description: id }
    writeFileSync(join(folder, `agent-${id}.meta.json`), JSON.stringify(meta))
    writeFileSync(agentPath(id), jsonl(recs))
  }
  return { dir, mainPath, agentPath }
}

const kinds = (got: DeskEvent[], agentId: string): string[] => got.filter((e) => 'agentId' in e && e.agentId === agentId).map((e) => e.kind)
const stopped = (got: DeskEvent[]): string[] => got.flatMap((e) => (e.kind === 'agent_stop' ? [e.agentId] : []))
const pollAll = (pw: ProjectWatcher): Promise<void> => (pw as unknown as { pollAll: () => Promise<void> }).pollAll()
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30))

test('an agent the parent was told had finished leaves once its own file has been read (attach)', async () => {
  const quoted = { type: 'user', timestamp: at(40), message: { content: [{ type: 'tool_result', tool_use_id: 'grep', content: notice('a4') }] } }
  const { dir } = withAgents(
    [
      queued('a2', 5), // a2 was resumed (SendMessage) after this one and is working still
      queued('a1', 10),
      handedIn('a1', 20), // the same notice again
      queued('b5j15rbre', 30), // a background shell: no agent of ours
      quoted, // a grep through a transcript is not a notice
      asUser('a3', 50, 'failed'),
    ],
    {
      a1: [said('working', 0), calls('t1', 'Read', 1), result('t1', 2)],
      a2: [said('first', 0), said('again', 60)],
      a3: [said('trying', 0)],
      a4: [said('busy', 0)],
    },
  )
  const pw = new ProjectWatcher(dir)
  const got: DeskEvent[] = []
  pw.on('event', (e: DeskEvent) => got.push(e))
  await pw.track(SID)
  assert.deepEqual(stopped(got).sort(), ['a1', 'a3'])
  assert.equal(kinds(got, 'a1').at(-1), 'agent_stop', 'after everything it wrote')
  assert.ok(!got.some((e) => 'agentId' in e && e.agentId === 'b5j15rbre'), 'no hamster for a task that is not an agent')
  pw.stop()
})

test('a notice read live lets its agent go after its last words, and one resumed later comes back', async () => {
  const { dir, mainPath, agentPath } = withAgents([said('hi', 0)], { a1: [said('working', 1)] })
  const pw = new ProjectWatcher(dir)
  const got: DeskEvent[] = []
  pw.on('event', (e: DeskEvent) => got.push(e))
  await pw.track(SID)
  assert.deepEqual(kinds(got, 'a1'), ['agent_start', 'text', 'model'])
  got.length = 0

  // its last words and the notice land together; the main transcript is read first
  appendFileSync(agentPath('a1'), jsonl([said('here is my report', 8)]))
  appendFileSync(mainPath, jsonl([queued('a1', 10), queued('bgshell1', 11)]))
  await pollAll(pw)
  await settle()
  assert.deepEqual(kinds(got, 'a1'), ['text', 'agent_stop'])
  got.length = 0

  appendFileSync(mainPath, jsonl([handedIn('a1', 20)]))
  appendFileSync(agentPath('a1'), jsonl([said('flushed late', 9)])) // written before the notice, on disk after it
  await pollAll(pw)
  await settle()
  assert.deepEqual(kinds(got, 'a1'), [], 'neither a second stop nor a hamster brought back by an old line')

  appendFileSync(agentPath('a1'), jsonl([said('asked again', 60)])) // SendMessage
  await pollAll(pw)
  await settle()
  assert.deepEqual(kinds(got, 'a1'), ['agent_start', 'text', 'model'], 'back at the desk')
  got.length = 0

  appendFileSync(mainPath, jsonl([queued('a1', 70)]))
  await pollAll(pw)
  await settle()
  assert.deepEqual(kinds(got, 'a1'), ['agent_stop'], 'and gone again with the next notice')
  pw.stop()
})

test('a workflow agent leaves when its StructuredOutput goes through, not when one fails validation', async () => {
  const { dir } = withAgents(
    [said('hi', 0)],
    {
      w1: [calls('so1', 'StructuredOutput', 0), result('so1', 1, true), calls('so2', 'StructuredOutput', 2), result('so2', 3)],
      w2: [said('checking', 0), calls('so3', 'StructuredOutput', 1), result('so3', 2, true)],
    },
    join('workflows', 'wf_1'),
  )
  const pw = new ProjectWatcher(dir)
  const got: DeskEvent[] = []
  pw.on('event', (e: DeskEvent) => got.push(e))
  await pw.track(SID)
  assert.deepEqual(stopped(got), ['w1'])
  const w1 = got.flatMap((e) => (!('agentId' in e) || e.agentId !== 'w1' ? [] : e.kind === 'tool_done' ? [`${e.toolUseId}:${e.ok}`] : [e.kind]))
  assert.deepEqual(w1.slice(w1.indexOf('so1:false')), ['so1:false', 'tool', 'so2:true', 'agent_stop'], 'the failed call is retried; the one that went through ends it')
  pw.stop()
})

test('a pid file caught mid-rewrite keeps its session; a deleted one, or a dead claude’s, ends it', async () => {
  const base = sessionHome()
  const file = join(base, 'sessions', `${process.pid}.json`)
  const w = new SessionWatcher({ ownedShells: () => [], baseDir: base, parents: async () => new Map() })
  const seen: SessionInfo[] = []
  const gone: string[] = []
  w.on('session', (s: SessionInfo) => seen.push(s))
  w.on('session_gone', (id: string) => gone.push(id))
  await w.scan()
  assert.equal(seen.length, 1)

  writeFileSync(file, '') // truncated, not written yet
  await w.scan()
  writeFileSync(file, `{"pid":${process.pid},"sessionId":"${SID}","cwd`) // cut short
  await w.scan()
  assert.deepEqual(gone, [], 'used to be reported gone, then new: untracked and read all over again')
  assert.equal(seen.length, 1, 'nor anything else said about it')
  writeFileSync(file, JSON.stringify({ pid: process.pid, sessionId: SID, cwd: CWD, status: 'busy' }))
  await w.scan()
  assert.equal(seen.at(-1)?.status, 'busy')

  // a claude that died with its file broken
  const dead = spawnSync(process.execPath, ['-e', '']).pid
  const deadSid = '22222222-2222-4222-8222-222222222222'
  w.sessions.set(deadSid, { ...seen[0], sessionId: deadSid, pid: dead })
  writeFileSync(join(base, 'sessions', `${dead}.json`), '')
  await w.scan()
  assert.deepEqual(gone, [deadSid])

  unlinkSync(file)
  await w.scan()
  assert.deepEqual(gone, [deadSid, SID])
  w.stop()
})

test('scanLines hands over the lines with the marker across chunk borders, skips one too long, and ends with the line `to` cuts', async () => {
  const p = join(tmp(), 'f.jsonl')
  const parts = [
    ...lines('pad', 10_480, 99), // 1 048 000 bytes: the next line crosses the first 1 MB chunk
    `across ${'a'.repeat(2000)} <mark>`,
    `long <mark> ${'l'.repeat(1_100_000)}`, // longer than a line is kept for
    'plain',
    'inside <mark>',
    `cut <mark> ${'c'.repeat(300)}`,
    'after <mark>',
  ]
  const text = parts.join('\n') + '\n'
  writeFileSync(p, text)
  const cut = text.indexOf('cut <mark>') + 100 // `to` falls inside the line
  const got: string[] = []
  await scanLines(p, { from: 0, to: cut, marker: '<mark>', onLine: (l) => got.push(l.slice(0, 6)), go: () => true })
  assert.deepEqual(got, ['across', 'inside', 'cut <m'], 'the long one passed over, nothing past `to`')

  got.length = 0
  await scanLines(p, { from: text.indexOf('across') + 5, to: text.length, marker: '<mark>', onLine: (l) => got.push(l.slice(0, 6)), go: () => true })
  assert.deepEqual(got, ['inside', 'cut <m', 'after '], 'a line `from` falls in is taken for cut')

  let asked = 0
  got.length = 0
  await scanLines(p, { from: 0, to: text.length, marker: '<mark>', onLine: (l) => got.push(l), go: () => ++asked < 2 })
  assert.deepEqual(got, [], 'stopped before the second chunk')
})

test('a notice from before the 8 MB catch-up still lets its agent go, after the attach, unless untracked first', async () => {
  // before the catch-up: a1's notice (twice) and a background shell's; then 9 MB of screenshots
  const filler = Array.from({ length: 90 }, () => ({ type: 'progress', timestamp: at(500), data: 'x'.repeat(100_000) }))
  const main = [queued('a1', 10), handedIn('a1', 11), queued('shell1', 12), ...filler, said('much later', 1000)]
  const agents = {
    a1: [said('done long ago', 0)],
    a2: [said('still at it', 2000)], // busy since the catch-up began: its notice would be in it
    a3: [said('never heard of again', 1)], // quiet, and no notice anywhere: stays
  }
  const { dir } = withAgents(main, agents)
  const pw = new ProjectWatcher(dir)
  const older = (pw as unknown as { older: Map<string, Promise<void>> }).older
  const got: DeskEvent[] = []
  pw.on('event', (e: DeskEvent) => got.push(e))
  await pw.track(SID)
  assert.deepEqual(stopped(got), [], 'the catch-up alone does not reach it, and the attach does not wait for the look back')
  const scan = older.get(SID)
  assert.ok(scan, 'a look further back, as a1 and a3 fell quiet before the catch-up began')
  await scan
  assert.deepEqual(stopped(got), ['a1'])
  assert.ok(!older.has(SID), 'done and forgotten')
  pw.stop()

  const again = new ProjectWatcher(dir)
  const events: DeskEvent[] = []
  again.on('event', (e: DeskEvent) => events.push(e))
  await again.track(SID)
  const cancelled = (again as unknown as { older: Map<string, Promise<void>> }).older.get(SID)
  again.untrack(SID) // the session ended before the look back got anywhere
  await cancelled
  assert.deepEqual(stopped(events), [])
  again.stop()
})

test('only what a person typed is a prompt: no notice, slash command, shell line, interrupt or compaction summary', () => {
  const ctx = { sessionId: SID, agentId: null }
  const user = (content: unknown, extra: Record<string, unknown> = {}) => ({ type: 'user', timestamp: at(0), message: { role: 'user', content }, ...extra })
  const prompts = (rec: unknown): string[] => parseRecord(rec, ctx).flatMap((e) => (e.kind === 'prompt' ? [e.text] : []))
  const human = { origin: { kind: 'human' }, promptSource: 'typed' }

  // the CLI's own
  assert.deepEqual(prompts(user(notice('a1'), { origin: { kind: 'task-notification' }, promptSource: 'system' })), [])
  assert.deepEqual(prompts(user(notice('a1'))), [], 'an older CLI says nothing about where it came from')
  assert.deepEqual(prompts(user('Goal set: 보스 이후 스테이지', { origin: { kind: 'auto-continuation' }, promptSource: 'system' })), [])
  assert.deepEqual(prompts(user('<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args>low</command-args>')), [])
  assert.deepEqual(prompts(user('<local-command-stdout>Set effort level to low</local-command-stdout>')), [])
  assert.deepEqual(prompts(user('<bash-input>git status</bash-input>')), [])
  assert.deepEqual(prompts(user('<bash-stdout>clean</bash-stdout><bash-stderr></bash-stderr>')), [])
  assert.deepEqual(prompts(user([{ type: 'text', text: '[Request interrupted by user for tool use]' }])), [])
  assert.deepEqual(prompts(user('This session is being continued from a previous conversation…', { isCompactSummary: true, isVisibleInTranscriptOnly: true })), [])
  assert.deepEqual(prompts(user('Another Claude session sent a message: …', { isMeta: true, origin: { kind: 'peer' } })), [])

  // a person's, tags and all
  assert.deepEqual(prompts(user('버그 고쳐줘', human)), ['버그 고쳐줘'])
  assert.deepEqual(prompts(user('<div class="x"></div> 이거 키워줘', human)), ['<div class="x"></div> 이거 키워줘'])
  assert.equal(prompts(user('<pasted_content id="9e20">\nlog\n</pasted_content id="9e20"> 이거 뭐야', human)).length, 1)
  assert.deepEqual(prompts(user([{ type: 'text', text: '[Image #1] 이렇게' }, { type: 'image', source: {} }], human)), ['[Image #1] 이렇게'])
  assert.deepEqual(prompts(user('/compact')), ['/compact'], 'an older CLI: plain text is still a person')
  assert.deepEqual(prompts(user('Review the diff', {})), ['Review the diff'])
  // a subagent's task arrives with no origin at all, and names the hamster
  assert.deepEqual(
    parseRecord(user('Audit the watcher'), { sessionId: SID, agentId: 'a1' }).map((e) => e.kind),
    ['prompt'],
  )
})
