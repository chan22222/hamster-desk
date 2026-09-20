// Smoke-test helper: once a session exists, fake N subagents with different models/states so the
// office layout can be checked without spending tokens. Enabled with HAMSTER_PREFS='{"demoAgents":6}'.
import type { DeskEvent } from '@shared/events'
import { useDesk, type FeedItem, type FeedKind } from '../store'

const TYPES = ['Explore', 'Plan', 'general-purpose', 'claude-code-guide', 'claude', 'agent']
const MODELS = ['claude-haiku-4-5-20251001', 'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-opus-5', 'claude-newmodel-7']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'high', 'medium']
const DESCS = ['워커 구조 조사', '구현 계획 수립', '테스트 실행', 'CLI 문서 확인', '리팩터 초안', '벤치마크']

export function seedStudioDemo(apply: (e: DeskEvent) => void, count: number): void {
  const sid = 'studio-preview', ts = Date.now()
  apply({ kind: 'session', sessionId: sid, pid: 0, cwd: 'Hamster Desk / Studio', name: '햄스터 스튜디오', status: 'busy', startedAt: ts, updatedAt: ts, version: 'preview', sessionKind: 'replay', mine: false, ptyId: null, transcriptPath: null })
  apply({ kind: 'model', sessionId: sid, agentId: null, model: 'claude-fable-5-1', effort: 'high', ts })
  for (let i = 0; i < count - 1; i++) {
    apply({ kind: 'agent_start', sessionId: sid, agentId: `studio-${i}`, agentType: TYPES[i % TYPES.length], description: DESCS[i % DESCS.length], toolUseId: null, depth: 1, background: false, ts })
    apply({ kind: 'model', sessionId: sid, agentId: `studio-${i}`, model: MODELS[i % MODELS.length], effort: EFFORTS[i % EFFORTS.length], ts })
  }
  // Two hamsters start with a small feed so a screenshot taken right away shows the stack,
  // including a merged row (`×3`) — rows time out on their own from here on.
  const born = Date.now()
  let seq = 0
  const row = (hid: string, kind: FeedKind, tone: FeedItem['tone'], text: string, count = 1): FeedItem =>
    ({ id: `${hid}:demo-${++seq}`, kind, tone, text, raw: text, born, ts: born, count, summarized: true })
  const feedFor = (hid: string, i: number): FeedItem[] =>
    i === 0
      ? [row(hid, 'say', 'talk', '말풍선을 채팅 피드로 바꾸고 있어요'), row(hid, 'act', 'edit', 'store.ts  +42 −18')]
      : i === 1
        ? [row(hid, 'say', 'name', '워커 구조를 살펴봐 줘'), row(hid, 'act', 'info', '실행: npm run test:office', 3)]
        : []
  useDesk.setState(s => ({
    // autoCam is forced on (in memory only) so the preview looks the same however the last
    // capture run left the saved preference
    prefs: { ...s.prefs, deskH: 520, showLog: false, showSidebar: false, autoCam: true },
    sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], title: '작은 동료들과, 함께 만드는 하루', hamsters: Object.fromEntries(Object.entries(s.sessions[sid].hamsters).map(([id, h], i) => [id, {
      ...h,
      state: (['writing', 'reading', 'thinking', 'idle', 'running', 'waiting'] as const)[i % 6],
      feed: feedFor(id, i),
    }])) } },
  }))
}

export function startDemo(apply: (e: DeskEvent) => void, n: number): () => void {
  let timer: number | null = null
  let started = false
  const stop = (): void => {
    if (timer) window.clearInterval(timer)
  }
  const t0 = Date.now()
  const tickWait = window.setInterval(() => {
    const st = useDesk.getState()
    // prefer the session running in this window; fall back to any session after 20 s
    const mine = Object.values(st.sessions).find((x) => x.info.mine)
    const s = mine ?? (Date.now() - t0 > 20000 ? Object.values(st.sessions)[0] : undefined)
    if (!s || started) return
    started = true
    window.clearInterval(tickWait)
    const sid = s.info.sessionId
    const now = Date.now()
    for (let i = 0; i < n; i++) {
      const id = `demo-${i}`
      window.setTimeout(() => {
        apply({ kind: 'agent_start', sessionId: sid, agentId: id, agentType: TYPES[i % TYPES.length], description: DESCS[i % DESCS.length], toolUseId: null, depth: 1, background: i % 2 === 0, ts: now })
        apply({ kind: 'model', sessionId: sid, agentId: id, model: MODELS[i % MODELS.length], effort: EFFORTS[i % EFFORTS.length], ts: now })
      }, 400 * i)
    }
    // keep them busy with a rotating set of activities
    const acts: DeskEvent['kind'][] = ['tool', 'text', 'thinking']
    let k = 0
    timer = window.setInterval(() => {
      const i = k % n
      const id = `demo-${i}`
      const kind = acts[Math.floor(k / n) % acts.length]
      const ts = Date.now()
      if (kind === 'tool') {
        const names = ['Read', 'Edit', 'Bash', 'Grep', 'Agent', 'WebFetch']
        const nm = names[k % names.length]
        const action = nm === 'Read' ? 'read' : nm === 'Edit' ? 'write' : nm === 'Bash' ? 'run' : nm === 'Grep' ? 'search' : nm === 'Agent' ? 'hire' : 'browse'
        // every other round fires the same tool three times: that is what the `×3` badge is for
        const repeats = k % 2 === 0 ? 3 : 1
        for (let r = 0; r < repeats; r++) {
          const useId = `t${k}-${r}`
          apply({ kind: 'tool', sessionId: sid, agentId: id, toolUseId: useId, name: nm, action, label: 'src/store.ts', file: 'src/store.ts', ts })
          if (nm === 'Edit') apply({ kind: 'edit', sessionId: sid, agentId: id, toolUseId: useId, file: 'C:/demo/src/store.ts', op: 'edit', added: 3, removed: 1, preview: null, ts })
          window.setTimeout(() => apply({ kind: 'tool_done', sessionId: sid, agentId: id, toolUseId: useId, ok: true, ts: Date.now() }), 2500)
        }
      } else if (kind === 'text') {
        apply({ kind: 'text', sessionId: sid, agentId: id, text: '이 부분은 워커 쪽에서 처리하는 게 맞겠어요', ts })
      } else {
        apply({ kind: 'thinking', sessionId: sid, agentId: id, ts })
      }
      k++
    }, 1200)
  }, 500)
  return () => {
    window.clearInterval(tickWait)
    stop()
  }
}
