// The CLI's `get_usage` answer (electron/usage-query.ts): the per-model weekly windows the status
// line never carries, read out of the stream-json control response exactly as CLI 2.1.278 wrote it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UsageQuerier, parseUsage } from '../../electron/usage-query'

/** trimmed from a real answer for a Max account on 2026-09-22 */
const RESPONSE = {
  type: 'control_response',
  response: {
    subtype: 'success',
    request_id: 'usage',
    response: {
      session: { total_cost_usd: 0 },
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 29, resets_at: '2026-09-22T08:40:00.796084+00:00', limit_dollars: null },
        seven_day: { utilization: 8, resets_at: '2026-09-28T12:00:00.796109+00:00' },
        seven_day_oauth_apps: null,
        seven_day_opus: null,
        seven_day_sonnet: null,
        nimbus_quill: { utilization: 0, resets_at: null },
        model_scoped: [{ display_name: 'Fable', utilization: 14, resets_at: '2026-09-28T12:00:00.796336+00:00' }],
      },
      behaviors: null,
    },
  },
}
const lines = (...objs: unknown[]): string => objs.map((o) => JSON.stringify(o)).join('\n') + '\n'

test('parseUsage reads the two windows and the per-model weekly ones', () => {
  const u = parseUsage(lines({ type: 'system', subtype: 'init' }, RESPONSE), 'acc-2', 1000)
  assert.ok(u)
  assert.equal(u.profileId, 'acc-2')
  assert.equal(u.ts, 1000)
  assert.equal(u.subscription, 'max')
  assert.deepEqual(u.fiveHour, { usedPercentage: 29, resetsAt: Date.parse('2026-09-22T08:40:00.796084+00:00') })
  assert.deepEqual(u.sevenDay, { usedPercentage: 8, resetsAt: Date.parse('2026-09-28T12:00:00.796109+00:00') })
  assert.deepEqual(Object.keys(u.models), ['Fable'], 'a null bucket and the promo bucket are not models')
  assert.equal(u.models.Fable.usedPercentage, 14)
})

test('parseUsage: the older named buckets count when the server labels nothing', () => {
  const r = JSON.parse(JSON.stringify(RESPONSE)) as { response: { response: { rate_limits: Record<string, unknown> } } }
  r.response.response.rate_limits.model_scoped = []
  r.response.response.rate_limits.seven_day_opus = { utilization: 55, resets_at: 1790596800 }
  const u = parseUsage(lines(r), 'default')
  assert.deepEqual(u?.models, { Opus: { usedPercentage: 55, resetsAt: 1790596800_000 } })
})

test('parseUsage: no response, an error response, garbage → null', () => {
  assert.equal(parseUsage('', 'x'), null)
  assert.equal(parseUsage(lines({ type: 'system' }), 'x'), null)
  assert.equal(parseUsage(lines({ type: 'control_response', response: { subtype: 'error', error: 'nope' } }), 'x'), null)
  assert.equal(parseUsage('not json\n{broken', 'x'), null)
})

test('UsageQuerier asks every logged-in account once, emits each answer, skips the rest', async () => {
  const asked: (string | null)[] = []
  const got: string[] = []
  const q = new UsageQuerier({
    accounts: () => [
      { id: 'default', dir: null, loggedIn: true },
      { id: 'acc-2', dir: 'D:/two', loggedIn: true },
      { id: 'acc-3', dir: 'D:/three', loggedIn: false },
    ],
    exec: async (dir) => {
      asked.push(dir)
      if (dir === 'D:/two') throw new Error('offline')
      return lines(RESPONSE)
    },
  })
  q.on('usage', (u: { profileId: string }) => got.push(u.profileId))
  const answers = await q.refresh()
  assert.deepEqual(asked, [null, 'D:/two'])
  assert.deepEqual(got, ['default'])
  assert.equal(answers.length, 1, 'a failed account is simply missing from the answer')
  assert.deepEqual((await q.refresh('acc-2')).length, 0)
  assert.deepEqual(asked, [null, 'D:/two', 'D:/two'])
})
