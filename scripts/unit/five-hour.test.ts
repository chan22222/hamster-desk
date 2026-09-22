// Starting the next 5-hour window right after the last one ends (electron/five-hour.ts): what the
// CLI's stream-json answer says, when a message is due, and — the part that must never go wrong —
// that nothing ever turns into a message on every tick.
//
// HAMSTER_HOME points at a temp folder *before* anything is imported, so ui.json lands there and not
// in the real ~/.hamster-desk. No real `claude` runs: `exec` is a fake and the clock is ours.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

const HOME = mkdtempSync(join(tmpdir(), 'hd-five-hour-'))
process.env.HAMSTER_HOME = HOME
// the error wording asserted below is Korean (electron/lang.ts): fixed before the module is imported
process.env.HAMSTER_LANG = 'ko'

import { flushUi, saveUi } from '../../electron/ui-store'
import { GRACE_MS, WINDOW_MS, FiveHourStarter, backoffMs, dueAt, parsePing, sanitizeEntries, type FiveHourAccountRef, type FiveHourEntry } from '../../electron/five-hour'

after(() => rmSync(HOME, { recursive: true, force: true }))

const MIN = 60_000
const T0 = Date.UTC(2026, 8, 22, 9, 0, 0)

/** What `claude -p --output-format stream-json --verbose` printed for one real call (trimmed). */
function stream(o: { resetsSec?: number | null; status?: string; type?: string; error?: string } = {}): string {
  const lines = [JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: 'none', model: 'claude-haiku-4-5-20251001' })]
  if (o.resetsSec !== null) {
    const r = o.resetsSec ?? Math.floor((T0 + WINDOW_MS) / 1000)
    lines.push(
      JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: o.status ?? 'allowed',
          resetsAt: r,
          rateLimitType: o.type ?? 'five_hour',
          isUsingOverage: false,
          ...(o.type && o.type !== 'five_hour' ? {} : { unifiedWindows: { five_hour: { utilization: 0, resetsAt: r }, seven_day: { utilization: 0, resetsAt: r + 86400 } } }),
        },
      }),
    )
  }
  lines.push(JSON.stringify({ type: 'result', subtype: o.error ? 'error_during_execution' : 'success', is_error: !!o.error, result: o.error ?? 'OK', total_cost_usd: 0.0004 }))
  return lines.join('\n') + '\n'
}

test('parsePing reads the 5-hour end out of the rate_limit_event, in ms', () => {
  // the exact numbers of the call that settled the format
  const out = [
    '{"type":"system","subtype":"init","apiKeySource":"none"}',
    '{"type":"assistant","message":{}}',
    '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1790066400,"rateLimitType":"five_hour","overageStatus":"rejected","isUsingOverage":false,"unifiedWindows":{"five_hour":{"utilization":0,"resetsAt":1790066400},"seven_day":{"utilization":0,"resetsAt":1790596800}}}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"OK","total_cost_usd":0.000403}',
  ].join('\r\n')
  assert.deepEqual(parsePing(out), { resetsAt: 1790066400_000, blockedUntil: null, blockedBy: null, noLimits: false, error: null })
})

test('parsePing: an error, a limit that refused, and an answer with no limits at all', () => {
  assert.equal(parsePing(stream({ resetsSec: null, error: 'Not logged in · Please run /login' })).error, 'Not logged in · Please run /login')
  const weekly = parsePing(stream({ status: 'rejected', type: 'seven_day', resetsSec: 1790596800, error: 'Claude AI usage limit reached' }))
  assert.equal(weekly.blockedUntil, 1790596800_000)
  assert.equal(weekly.blockedBy, 'seven_day')
  assert.equal(weekly.resetsAt, null, 'a weekly event says nothing about the 5-hour window')
  // an API-key or Console login answers without any rate limit: say so rather than pretend
  assert.equal(parsePing(stream({ resetsSec: null })).noLimits, true)
  assert.equal(parsePing('garbage\n').error, '응답을 읽지 못했어요')
})

test('dueAt: off is never, a known end waits a minute past it, a retry can push it later', () => {
  const e: FiveHourEntry = { on: false, resetsAt: T0, lastAt: null, error: null, failures: 0, retryAt: null }
  assert.equal(dueAt(e), null)
  assert.equal(dueAt({ ...e, on: true }), T0 + GRACE_MS)
  assert.equal(dueAt({ ...e, on: true, resetsAt: null }), 0, 'nothing known: right away')
  assert.equal(dueAt({ ...e, on: true, retryAt: T0 + 30 * MIN }), T0 + 30 * MIN)
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(backoffMs), [2, 5, 15, 30, 60, 60].map((m) => m * MIN))
})

test('sanitizeEntries drops rubbish instead of trusting it', () => {
  const s = sanitizeEntries({ default: { on: true, resetsAt: 5, failures: -3 }, 'Bad Id!': { on: true }, x: 'nope', 'acc-2': { on: 'yes' } })
  assert.deepEqual(Object.keys(s).sort(), ['acc-2', 'default'])
  assert.equal(s.default.failures, 0)
  assert.equal(s['acc-2'].on, false)
  assert.deepEqual(sanitizeEntries([1, 2]), {})
})

// ---- the scheduler itself

interface Rig {
  s: FiveHourStarter
  calls: (string | null)[]
  clock: { now: number }
  /** what the fake claude answers next (a string, or an Error to throw) */
  reply: { next: string | Error }
}

let accounts: FiveHourAccountRef[] = []

function rig(): Rig {
  const clock = { now: T0 }
  const calls: (string | null)[] = []
  const reply: Rig['reply'] = { next: stream() }
  const s = new FiveHourStarter({
    accounts: () => accounts,
    now: () => clock.now,
    exec: async (dir) => {
      calls.push(dir)
      if (reply.next instanceof Error) throw reply.next
      return reply.next
    },
  })
  return { s, calls, clock, reply }
}

/** the fake exec resolves at once; one macrotask lets the whole ping settle */
const settle = (): Promise<void> => new Promise((r) => setImmediate(r))

beforeEach(() => {
  flushUi()
  saveUi({ fiveHourStart: null })
  flushUi()
  accounts = [
    { id: 'default', dir: null },
    { id: 'acc-2', dir: join(HOME, 'profiles', 'acc-2') },
  ]
})

test('off by default: nothing is ever sent for an account nobody switched on', async () => {
  const { s, calls, clock } = rig()
  for (let i = 0; i < 10; i++) {
    clock.now += WINDOW_MS
    await s.tick()
  }
  assert.equal(calls.length, 0)
  assert.equal(s.state().default.on, false)
  assert.equal(s.state().default.nextAt, null)
})

test('switched on with nothing known: one message now, under that account, and the end it reports', async () => {
  const { s, calls, clock } = rig()
  s.set('acc-2', true)
  await settle()
  assert.deepEqual(calls, [accounts[1].dir])
  const a = s.state()['acc-2']
  assert.equal(a.resetsAt, T0 + WINDOW_MS)
  assert.equal(a.lastAt, T0)
  assert.equal(a.nextAt, T0 + WINDOW_MS + GRACE_MS)
  assert.equal(a.error, null)

  // nothing more until that end has passed, then exactly one
  clock.now = T0 + WINDOW_MS
  await s.tick()
  assert.equal(calls.length, 1)
  clock.now = T0 + WINDOW_MS + GRACE_MS
  await s.tick()
  await s.tick() // the second tick finds the new window: no double send
  assert.equal(calls.length, 2)
})

test('a running window seen in the status line is waited out, not interrupted', async () => {
  const { s, calls, clock } = rig()
  s.observe('default', { usedPercentage: 40, resetsAt: T0 + 2 * 60 * MIN })
  s.set('default', true)
  await settle()
  assert.equal(calls.length, 0)
  assert.equal(s.state().default.nextAt, T0 + 2 * 60 * MIN + GRACE_MS)
  clock.now = T0 + 2 * 60 * MIN + GRACE_MS
  await s.tick()
  assert.equal(calls.length, 1)
})

test('a stale status line (an end that already passed) never turns into a message per redraw', async () => {
  const { s, calls, clock } = rig()
  s.set('default', true)
  await settle()
  assert.equal(calls.length, 1)
  // the CLI redraws from rate limits it cached before: an older end comes in again and again
  for (let i = 0; i < 20; i++) {
    s.observe('default', { usedPercentage: 99, resetsAt: T0 - 60 * MIN })
    clock.now += MIN
    await s.tick()
  }
  assert.equal(calls.length, 1)
  assert.equal(s.state().default.resetsAt, T0 + WINDOW_MS)
})

test('failures back off 2 → 5 → 15 minutes, and a success clears the error', async () => {
  const { s, calls, clock, reply } = rig()
  reply.next = new Error('getaddrinfo ENOTFOUND api.anthropic.com')
  s.set('default', true)
  await settle()
  assert.equal(s.state().default.error, 'getaddrinfo ENOTFOUND api.anthropic.com')
  assert.equal(s.state().default.nextAt, T0 + 2 * MIN)

  clock.now = T0 + MIN
  await s.tick()
  assert.equal(calls.length, 1, 'not before the backoff')
  clock.now = T0 + 2 * MIN
  await s.tick()
  assert.equal(calls.length, 2)
  assert.equal(s.state().default.nextAt, T0 + 2 * MIN + 5 * MIN)

  reply.next = stream({ resetsSec: Math.floor((T0 + 7 * MIN + WINDOW_MS) / 1000) })
  clock.now = T0 + 7 * MIN
  await s.tick()
  assert.equal(calls.length, 3)
  assert.equal(s.state().default.error, null)
  assert.equal(s.state().default.nextAt, T0 + 7 * MIN + WINDOW_MS + GRACE_MS)
})

test('the CLI answering with an error (logged out) backs off like any failure', async () => {
  const { s, reply } = rig()
  reply.next = stream({ resetsSec: null, error: 'Not logged in · Please run /login' })
  s.set('default', true)
  await settle()
  assert.equal(s.state().default.error, 'Not logged in · Please run /login')
  assert.equal(s.state().default.nextAt, T0 + 2 * MIN)
})

test('a weekly limit waits until it lifts; a used-up 5-hour window is no error at all', async () => {
  const { s, reply, clock } = rig()
  const lift = T0 + 3 * 24 * 60 * MIN
  reply.next = stream({ status: 'rejected', type: 'seven_day', resetsSec: lift / 1000, error: 'Claude AI usage limit reached' })
  s.set('default', true)
  await settle()
  assert.equal(s.state().default.error, '사용 한도에 걸려 있어요')
  assert.equal(s.state().default.nextAt, lift + GRACE_MS)

  const end = T0 + 90 * MIN
  reply.next = stream({ status: 'rejected', type: 'five_hour', resetsSec: end / 1000, error: 'Claude AI usage limit reached' })
  s.set('acc-2', true)
  await settle()
  assert.equal(s.state()['acc-2'].error, null)
  assert.equal(s.state()['acc-2'].nextAt, end + GRACE_MS)

  // a lift time that is already past must still not mean "again on the next tick"
  reply.next = stream({ status: 'rejected', type: 'seven_day', resetsSec: (T0 - 60 * MIN) / 1000, error: 'limit' })
  s.set('default', false)
  s.set('default', true)
  await settle()
  assert.equal(s.state().default.nextAt, clock.now + backoffMs(1))
})

test('no rate limits in the answer: flagged, and the next try is five hours out rather than now', async () => {
  const { s, calls, clock, reply } = rig()
  reply.next = stream({ resetsSec: null })
  s.set('default', true)
  await settle()
  assert.match(s.state().default.error ?? '', /구독/)
  assert.equal(s.state().default.nextAt, T0 + WINDOW_MS + GRACE_MS)
  clock.now += 10 * MIN
  await s.tick()
  assert.equal(calls.length, 1)
})

test('kept in ui.json across a restart; a forgotten account takes its entry with it', async () => {
  const first = rig()
  first.s.set('acc-2', true)
  await settle()
  flushUi()
  const stored = JSON.parse(readFileSync(join(HOME, 'ui.json'), 'utf8')).fiveHourStart
  assert.equal(stored['acc-2'].on, true)
  assert.equal(stored['acc-2'].resetsAt, T0 + WINDOW_MS)
  assert.equal(stored.default, undefined, 'an account never switched on is not written down')

  const again = rig()
  assert.equal(again.s.state()['acc-2'].on, true)
  await again.s.tick()
  assert.equal(again.calls.length, 0, 'the window it learned before the restart is still running')

  accounts = [{ id: 'default', dir: null }]
  again.s.set('default', true)
  await settle()
  flushUi()
  const after = JSON.parse(readFileSync(join(HOME, 'ui.json'), 'utf8')).fiveHourStart
  assert.deepEqual(Object.keys(after), ['default'])
  assert.equal(again.s.state()['acc-2'], undefined)
})

test('switching off stops the messages; an unknown account cannot be switched on', async () => {
  const { s, calls, clock } = rig()
  s.set('default', true)
  await settle()
  s.set('default', false)
  clock.now += 3 * WINDOW_MS
  await s.tick()
  assert.equal(calls.length, 1)
  assert.equal(s.set('nobody', true).nobody, undefined)
})
