// Checks the speech-bubble summarizer without Electron:
//   npx tsx scripts/bubble-smoke.ts
// (a) fake `exec` — cache hits, per-lane superseding, the 3-failure circuit breaker, quote stripping
// (b) ONE real `claude -p --model haiku` call (spends a tiny bit of the user's subscription) to prove
//     the flag set works, print the sentence + ms, and assert nothing new landed in ~/.claude/sessions.
// Running this from inside a Claude Code session is the point of (b): CLAUDECODE & friends are
// inherited here, and cleanEnv() has to strip them or the CLI would refuse to behave normally.
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findClaude } from '../electron/env'
import { BubbleSummarizer, cleanBubble, type BubbleExec } from '../electron/summarize'
import type { BubbleRequest } from '../shared/events'

let failures = 0
function check(ok: boolean, what: string, extra?: unknown): void {
  if (ok) console.log(`  ok   ${what}`)
  else {
    failures++
    console.log(`  FAIL ${what}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`)
  }
}

const json = (result: string): string => JSON.stringify({ type: 'result', is_error: false, result })
const req = (o: Partial<BubbleRequest> = {}): BubbleRequest => ({
  key: 'k1',
  lane: 'main',
  kind: 'said',
  text: 'hello',
  lang: 'Korean',
  maxChars: 40,
  ...o,
})

async function fakeTests(): Promise<void> {
  console.log('\n[1] cache')
  {
    let calls = 0
    const exec: BubbleExec = async () => {
      calls++
      return json('파서 고치는 중')
    }
    const s = new BubbleSummarizer({ exec })
    const a = await s.summarize(req({ key: 'a' }))
    const b = await s.summarize(req({ key: 'b' }))
    check(a.text === '파서 고치는 중' && a.error === null, 'first call summarized', a)
    check(b.text === a.text && b.key === 'b', 'same input answered from cache', b)
    check(calls === 1, 'exec ran once', calls)
    const c = await s.summarize(req({ key: 'c', text: 'different' }))
    check(calls === 2 && c.text === '파서 고치는 중', 'different input runs again', calls)
    s.dispose()
  }

  console.log('\n[2] lane superseding')
  {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    let calls = 0
    const exec: BubbleExec = async (_sys, user) => {
      calls++
      await gate
      return json(`ran:${user.length}`)
    }
    // concurrency 1 so #2 and #3 sit in the queue while #1 blocks
    const s = new BubbleSummarizer({ exec, concurrency: 1 })
    const p1 = s.summarize(req({ key: '1', lane: 'main', text: 'one' }))
    const p2 = s.summarize(req({ key: '2', lane: 'main', text: 'two' }))
    const p3 = s.summarize(req({ key: '3', lane: 'main', text: 'three' }))
    const p4 = s.summarize(req({ key: '4', lane: 'agent-a', text: 'four' }))
    const r2 = await p2
    check(r2.error === 'superseded' && r2.text === null && r2.key === '2', 'queued request of the same lane is dropped', r2)
    release()
    const [r1, r3, r4] = await Promise.all([p1, p3, p4])
    check(r1.error === null && r1.text !== null, 'the running request still finishes', r1)
    check(r3.error === null && r3.text !== null, 'the newest queued request runs', r3)
    check(r4.error === null && r4.text !== null, 'another lane is untouched', r4)
    check(calls === 3, 'three execs (1, 3, 4)', calls)
    s.dispose()
  }

  console.log('\n[3] circuit breaker')
  {
    let calls = 0
    const exec: BubbleExec = async () => {
      calls++
      throw new Error('boom')
    }
    const s = new BubbleSummarizer({ exec, concurrency: 1 })
    const r1 = await s.summarize(req({ key: 'f1', lane: 'l1', text: 'a' }))
    const r2 = await s.summarize(req({ key: 'f2', lane: 'l2', text: 'b' }))
    const r3 = await s.summarize(req({ key: 'f3', lane: 'l3', text: 'c' }))
    check(r1.error === 'boom' && r2.error === 'boom' && r3.error === 'boom', 'three failures reported', [r1.error, r2.error, r3.error])
    const st = s.state()
    check(st.disabledUntil != null && st.disabledUntil > Date.now() + 4 * 60_000, 'disabled for ~5 minutes', st)
    const r4 = await s.summarize(req({ key: 'f4', lane: 'l4', text: 'd' }))
    check(r4.error === 'disabled' && r4.text === null, 'further requests short-circuit', r4)
    check(calls === 3, 'no exec after the breaker tripped', calls)
    s.dispose()
  }

  console.log('\n[4] text cleanup')
  {
    const s = new BubbleSummarizer({ exec: async () => json('  "`parse.ts` 고치는 중"  ') })
    const r = await s.summarize(req({ key: 'q', text: 'quoted' }))
    check(r.text === 'parse.ts 고치는 중', 'quotes and backticks stripped', r)
    s.dispose()

    check(cleanBubble('“말풍선 요약 중”', 40) === '말풍선 요약 중', 'curly quotes stripped')
    check(cleanBubble("'단일 따옴표'", 40) === '단일 따옴표', 'single quotes stripped')
    check(cleanBubble('「괄호 따옴표」', 40) === '괄호 따옴표', 'corner brackets stripped')
    check(cleanBubble('한 줄\n두 줄', 40) === '한 줄 두 줄', 'newlines become spaces')
    const long = cleanBubble('가'.repeat(80), 10)
    check(long.length === 22 && long.endsWith('…'), 'clipped to maxChars + 12', long)
  }

  console.log('\n[5] empty result')
  {
    const s = new BubbleSummarizer({ exec: async () => json('   ') })
    const r = await s.summarize(req({ key: 'e', text: 'empty' }))
    check(r.error === 'empty' && r.text === null, 'empty result is an error', r)
    s.dispose()
  }
}

function sessionFiles(): string[] {
  const dir = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'sessions')
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return []
  }
}

async function realCall(): Promise<void> {
  console.log('\n[6] real claude -p (one call, uses a little of the subscription)')
  const bin = findClaude()
  if (!bin) {
    console.log('  skip — no claude on PATH')
    return
  }
  console.log(`  claude: ${bin.path}${bin.viaCmd ? ' (via cmd.exe)' : ''}`)
  console.log(`  inherited CLAUDECODE=${process.env.CLAUDECODE ?? '(unset)'} — cleanEnv() must drop it`)
  const before = sessionFiles()
  const s = new BubbleSummarizer()
  const st = s.state()
  check(st.available, 'summarizer reports available', st)
  const t0 = Date.now()
  const r = await s.summarize({
    key: 'real',
    lane: 'main',
    kind: 'said',
    text: '조사 진행 중입니다 — 게임 쪽 렌더러·조명 설정과 청크 마무리 코드, 그리고 hamster-desk 의 타입 정의만 더 확인하면 명세를 쓸 수 있습니다.',
    lang: 'Korean',
    maxChars: 40,
  })
  const ms = Date.now() - t0
  console.log(`  bubble: ${r.text ?? `(null) error=${r.error}`}`)
  console.log(`  took:   ${ms} ms`)
  check(r.error === null && !!r.text, 'real call produced a bubble', r)
  const after = sessionFiles()
  check(after.length === before.length, 'no new ~/.claude/sessions/*.json', { before: before.length, after: after.length })
  s.dispose()
}

async function main(): Promise<void> {
  await fakeTests()
  await realCall()
  console.log(failures === 0 ? '\nbubble-smoke: all checks passed' : `\nbubble-smoke: ${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
