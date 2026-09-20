import type { HamsterState } from '../store'

/** The pose a hamster plays. The studio maps each one onto the rig's procedural animation. */
export type IsoAnim = 'idle' | 'blink' | 'type' | 'read' | 'think' | 'talk' | 'wave' | 'walk' | 'phone' | 'sleep' | 'run'

export function animFor(state: HamsterState, sinceMs: number): IsoAnim {
  switch (state) {
    case 'idle':
      return sinceMs > 90_000 ? 'sleep' : 'idle'
    case 'thinking':
      return 'think'
    case 'reading':
    case 'searching':
    case 'browsing':
      return 'read'
    case 'writing':
      return 'type'
    case 'running':
      return 'run'
    case 'hiring':
      return 'phone'
    case 'talking':
      return 'talk'
    case 'waiting':
      return 'wave'
    case 'arriving':
    case 'leaving':
      return 'walk'
  }
}

export function screenColor(state: HamsterState, t: number): { bg: string; fg: string; lines: number } {
  switch (state) {
    case 'writing':
      return { bg: '#1d4f8a', fg: '#7dd3fc', lines: 5 }
    case 'running':
      return { bg: Math.floor(t / 300) % 2 ? '#175c34' : '#12472a', fg: '#4ade80', lines: 5 }
    case 'reading':
    case 'searching':
    case 'browsing':
      return { bg: '#4a3b8a', fg: '#c4b5fd', lines: 4 }
    case 'waiting':
      return { bg: '#8a2b2b', fg: '#fca5a5', lines: 2 }
    case 'idle':
      return { bg: '#1a1f33', fg: '#2f3448', lines: 1 }
    default:
      return { bg: '#2a3f6b', fg: '#8fb4ff', lines: 3 }
  }
}

export function statusDot(state: HamsterState): string {
  return state === 'idle' ? '#5b6172' : state === 'waiting' ? '#ff6b6b' : '#4cd4a4'
}

export const AGENT_TINT: Record<string, string> = {
  main: '#c98a45',
  Explore: '#5aa9e6',
  Plan: '#9b7bff',
  'general-purpose': '#4cd4a4',
  'claude-code-guide': '#f2a541',
  claude: '#e07a5f',
  agent: '#8d99ae',
}

export function tintFor(agentType: string): string {
  return AGENT_TINT[agentType] ?? AGENT_TINT.agent
}
