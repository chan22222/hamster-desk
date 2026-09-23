// The desk events main keeps for a renderer that mounts late (electron/backlog.ts): the ring, and
// what it must not forget — a session's own `session` event above all, or everything that session
// said afterwards is dropped by the store and it never shows up in the office.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventBacklog } from '../../electron/backlog'
import type { DeskEvent, SessionInfo, StatusSnapshot } from '../../shared/events'

const info = (sessionId: string, status: SessionInfo['status'] = 'busy'): SessionInfo => ({ sessionId, status }) as unknown as SessionInfo
const session = (sessionId: string, status: SessionInfo['status'] = 'busy'): DeskEvent => ({ kind: 'session', ...info(sessionId, status) })
const text = (sessionId: string, n: number): DeskEvent => ({ kind: 'text', sessionId, agentId: null, text: `line ${n}`, ts: n })
const snapshot = (sessionId: string, profileId: string, ts: number, withWindows: boolean): DeskEvent =>
  ({
    kind: 'status',
    sessionId,
    ts,
    profileId,
    model: null,
    effort: null,
    contextUsedPct: null,
    contextSize: null,
    costUSD: null,
    linesAdded: null,
    linesRemoved: null,
    fiveHour: withWindows ? { usedPercentage: 10, resetsAt: null } : null,
    sevenDay: null,
    otherWindows: {},
  }) as { kind: 'status' } & StatusSnapshot

/** what a renderer mounting now would apply, in order (src/App.tsx `take`: anything not newer than the last is skipped) */
function mount(b: EventBacklog): DeskEvent[] {
  let last = 0
  const out: DeskEvent[] = []
  for (const item of b.replay(0)) {
    if (item.seq <= last) continue
    last = item.seq
    out.push(item.ev)
  }
  return out
}

const kinds = (evs: DeskEvent[]): string[] => evs.map((e) => ('sessionId' in e ? `${e.kind}:${e.sessionId}` : e.kind))

test('a short history comes back whole, in order, and nothing twice', () => {
  const b = new EventBacklog(10)
  b.push(session('a'))
  b.push(text('a', 1))
  b.push({ kind: 'title', sessionId: 'a', title: 'x' })
  const got = b.replay(0)
  assert.deepEqual(
    got.map((i) => i.seq),
    [1, 2, 3],
  )
  assert.deepEqual(
    b.replay(2).map((i) => i.seq),
    [3],
    'after: only what is newer',
  )
})

test('a session whose `session` event the ring dropped still arrives first', () => {
  const b = new EventBacklog(5)
  b.push(session('a'))
  b.push({ kind: 'title', sessionId: 'a', title: 'the title' })
  b.push({ kind: 'model', sessionId: 'a', agentId: null, model: 'fable', effort: 'high', ts: 1 })
  for (let n = 0; n < 20; n++) b.push(text('a', n))
  const evs = mount(b)
  assert.deepEqual(kinds(evs).slice(0, 3), ['session:a', 'title:a', 'model:a'], 'the pinned ones, in the order they happened')
  assert.equal(evs.length, 3 + 5, 'then the ring')
})

test('the latest `session` is replayed once the first is gone; the first when the latest is still in the ring', () => {
  const b = new EventBacklog(5)
  b.push(session('a', 'busy'))
  for (let n = 0; n < 10; n++) b.push(text('a', n))
  b.push(session('a', 'idle')) // in the ring
  let evs = mount(b)
  assert.equal(kinds(evs)[0], 'session:a', 'the first makes the session exist before the ring')
  assert.equal(evs.filter((e) => e.kind === 'session').length, 2, 'then the latest from the ring')

  for (let n = 0; n < 10; n++) b.push(text('a', 100 + n)) // both gone from the ring now
  evs = mount(b)
  const sessions = evs.filter((e) => e.kind === 'session') as ({ kind: 'session' } & SessionInfo)[]
  assert.equal(sessions.length, 1, 'only the latest')
  assert.equal(sessions[0].status, 'idle')
})

test('a session that ended is not brought back', () => {
  const b = new EventBacklog(3)
  b.push(session('a'))
  b.push({ kind: 'title', sessionId: 'a', title: 'x' })
  b.push({ kind: 'session_gone', sessionId: 'a' })
  for (let n = 0; n < 10; n++) b.push(text('b', n))
  assert.deepEqual(
    mount(b).filter((e) => 'sessionId' in e && e.sessionId === 'a'),
    [],
  )
})

test('a finished sub-agent stays finished; a working one keeps its start and model', () => {
  const b = new EventBacklog(3)
  b.push(session('a'))
  const start = (agentId: string): DeskEvent => ({ kind: 'agent_start', sessionId: 'a', agentId, agentType: 't', description: 'd', toolUseId: null, depth: 1, background: false, ts: 1 })
  b.push(start('done'))
  b.push({ kind: 'model', sessionId: 'a', agentId: 'done', model: 'haiku', effort: null, ts: 2 })
  b.push({ kind: 'agent_stop', sessionId: 'a', agentId: 'done', ts: 3 })
  b.push(start('busy'))
  b.push({ kind: 'model', sessionId: 'a', agentId: 'busy', model: 'sonnet', effort: null, ts: 4 })
  for (let n = 0; n < 10; n++) b.push(text('a', n))
  const agents = mount(b).filter((e) => (e.kind === 'agent_start' || e.kind === 'model') && e.agentId !== null)
  assert.deepEqual(
    agents.map((e) => (e.kind === 'agent_start' || e.kind === 'model' ? `${e.kind}:${e.agentId}` : '')),
    ['agent_start:busy', 'model:busy'],
  )
})

test('the newest status line with rate limits per account, and the versions, survive the ring', () => {
  const b = new EventBacklog(3)
  b.push(snapshot('s1', 'acc-2', 100, true))
  b.push(snapshot('s2', 'acc-2', 50, true)) // older numbers, reported later: not the account's newest
  b.push(snapshot('s3', 'acc-2', 200, false)) // no windows: says nothing about the account
  b.push({ kind: 'version', current: '2.1.0', latest: '2.1.0', checkedAt: 1, error: null })
  for (let n = 0; n < 10; n++) b.push(text('x', n))
  const evs = mount(b)
  assert.ok(evs.some((e) => e.kind === 'version'))
  const statuses = evs.filter((e) => e.kind === 'status') as ({ kind: 'status' } & StatusSnapshot)[]
  // every session's own latest line, s1 among them as the account's newest with windows
  assert.deepEqual(
    statuses.map((s) => s.sessionId),
    ['s1', 's2', 's3'],
  )
})

test('status files of sessions that never ran here are the first to go past the cap', () => {
  const b = new EventBacklog(2, 3)
  b.push(session('live'))
  for (const id of ['old1', 'old2', 'old3']) b.push(snapshot(id, 'default', 1, false))
  for (let n = 0; n < 10; n++) b.push(text('x', n))
  const ids = mount(b)
    .filter((e) => e.kind === 'session' || e.kind === 'status')
    .map((e) => ('sessionId' in e ? e.sessionId : ''))
  assert.ok(ids.includes('live'), 'the live session is kept')
  assert.ok(!ids.includes('old1'), 'the oldest never-live one went')
})
