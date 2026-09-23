// The renderer store's bookkeeping (src/store.ts): what a terminal waiting for an answer, a session
// that ends and a tab that closes leave behind — nothing — and the bubbles expiring on time however
// busy the other hamsters are.
//
// One mocked clock for the whole file: the store books its timers in module state, so a clock that
// started over for each test would leave the previous test's bookings in a time that never comes.
import './dom-shim'
import { beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import type { DeskEvent, GitInfo, SessionInfo } from '../../shared/events'
import { useDesk } from '../../src/store'

mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 })

const initial = useDesk.getState()
beforeEach(() => {
  useDesk.setState({
    sessions: {},
    workspaces: [],
    activeTab: null,
    ptyWaiting: {},
    git: {},
    profiles: initial.profiles,
    currentProfileId: initial.currentProfileId,
    cliAccountHidden: false,
    cliAccountMergedInto: null,
  })
})

function session(sessionId: string, ptyId: number | null = null): DeskEvent {
  const info: SessionInfo = { sessionId, pid: 1, cwd: 'C:\\p', name: '', status: 'busy', startedAt: 0, updatedAt: 0, version: '', sessionKind: '', mine: ptyId !== null, ptyId, transcriptPath: null }
  return { kind: 'session', ...info }
}
const apply = (e: DeskEvent): void => useDesk.getState().apply(e)
const read = (sessionId: string, agentId: string | null, label: string): DeskEvent => ({ kind: 'tool', sessionId, agentId, toolUseId: `${label}:${Date.now()}`, name: 'Read', action: 'read', label, file: null, ts: Date.now() })

test('a key that answered nothing hands out nothing new', () => {
  apply(session('s1', 7))
  const before = useDesk.getState()
  apply({ kind: 'waiting_clear', ptyId: 7, ts: Date.now() }) // an arrow key, say, with no prompt up
  assert.equal(useDesk.getState().ptyWaiting, before.ptyWaiting)
  assert.equal(useDesk.getState().sessions, before.sessions)
})

test('a wait ends when it is answered, when its claude exits, and when its tab closes', () => {
  apply(session('s1', 7))
  apply({ kind: 'waiting', ptyId: 7, reason: 'permission', ts: Date.now() })
  assert.ok(7 in useDesk.getState().ptyWaiting)
  assert.equal(useDesk.getState().sessions.s1.waiting, true)
  apply({ kind: 'waiting_clear', ptyId: 7, ts: Date.now() })
  assert.deepEqual(useDesk.getState().ptyWaiting, {})
  assert.equal(useDesk.getState().sessions.s1.waiting, false)

  apply({ kind: 'waiting', ptyId: 7, reason: 'question', ts: Date.now() })
  apply({ kind: 'session_gone', sessionId: 's1' })
  assert.deepEqual(useDesk.getState().ptyWaiting, {})

  const ws = useDesk.getState().addWorkspace('C:\\p')
  useDesk.getState().bindWorkspacePty(ws.id, 9, 'C:\\p')
  apply({ kind: 'waiting', ptyId: 9, reason: 'permission', ts: Date.now() })
  useDesk.getState().removeWorkspace(ws.id)
  assert.deepEqual(useDesk.getState().ptyWaiting, {})
})

test('an expired bubble goes on time while another hamster keeps talking', () => {
  apply(session('s1'))
  apply(read('s1', 'a1', 'quiet.ts'))
  assert.equal(useDesk.getState().sessions.s1.hamsters.a1.feed.length, 1)
  // the main hamster says something new every half second for six seconds
  for (let i = 1; i <= 12; i++) {
    mock.timers.tick(500)
    apply(read('s1', null, `busy-${i}.ts`))
  }
  // the quiet one's row lived three seconds, and every push since would have put the sweep off
  assert.equal(useDesk.getState().sessions.s1.hamsters.a1.feed.length, 0)
  assert.ok(useDesk.getState().sessions.s1.hamsters.main.feed.length > 0)
})

test('the same model again changes nothing', () => {
  apply(session('s1'))
  apply({ kind: 'model', sessionId: 's1', agentId: null, model: 'claude-fable-5-1', effort: 'high', ts: Date.now() })
  const before = useDesk.getState().sessions
  apply({ kind: 'model', sessionId: 's1', agentId: null, model: 'claude-fable-5-1', effort: 'high', ts: Date.now() })
  assert.equal(useDesk.getState().sessions, before)
  apply({ kind: 'model', sessionId: 's1', agentId: null, model: 'claude-opus-5-5', effort: 'high', ts: Date.now() })
  assert.equal(useDesk.getState().sessions.s1.model, 'claude-opus-5-5')
})

test('a compact boundary is kept as a time, not as a phrase in some language', () => {
  apply(session('s1'))
  apply({ kind: 'compact', sessionId: 's1', ts: 1234 })
  assert.equal(useDesk.getState().sessions.s1.compactedAt, 1234)
})

test('a status snapshot waits for its session, but not for ever', () => {
  const snap = (sessionId: string): DeskEvent => ({
    kind: 'status',
    sessionId,
    ts: Date.now(),
    model: null,
    effort: 'max',
    contextUsedPct: 12,
    contextSize: 200_000,
    costUSD: null,
    linesAdded: null,
    linesRemoved: null,
    fiveHour: null,
    sevenDay: null,
    otherWindows: {},
  })
  apply(snap('early'))
  apply(session('early'))
  assert.equal(useDesk.getState().sessions.early.status?.contextUsedPct, 12)

  apply(snap('never'))
  mock.timers.tick(6 * 60_000)
  apply(snap('other')) // the next early snapshot lets go of the ones that waited too long
  apply(session('never'))
  assert.equal(useDesk.getState().sessions.never.status, null)
})

test('the CLI account folded into its twin reopens its tabs under that twin', () => {
  const list = [
    { id: 'acc-2', name: '회사', dir: 'C:\\acc-2' },
    { id: 'acc-3', name: '다른 사람', dir: 'C:\\acc-3' },
  ]
  useDesk.getState().setProfiles({ list, currentId: 'acc-3', mergedDefaultInto: 'acc-2' })
  assert.equal(useDesk.getState().addWorkspace('C:\\p', undefined, undefined, 'default').profileId, 'acc-2')
  // merely taken off the list: the current account, like any account the list has lost
  useDesk.getState().setProfiles({ list, currentId: 'acc-3', hiddenDefault: true })
  assert.equal(useDesk.getState().addWorkspace('C:\\p', undefined, undefined, 'default').profileId, 'acc-3')
})

test('a closed tab, and a tab that moved on, take their git chip along', () => {
  const info: GitInfo = { repo: true, branch: 'main', changed: 0, ahead: 0, behind: 0, at: 0, error: null }
  const a = useDesk.getState().addWorkspace('C:\\a')
  const b = useDesk.getState().addWorkspace('C:\\b')
  useDesk.getState().setGit('C:\\a', info)
  useDesk.getState().setGit('C:\\b\\', info)
  useDesk.getState().removeWorkspace(a.id)
  assert.deepEqual(Object.keys(useDesk.getState().git), ['c:\\b'])
  useDesk.getState().moveWorkspace(b.id, 'C:\\c')
  assert.deepEqual(Object.keys(useDesk.getState().git), [])
})
