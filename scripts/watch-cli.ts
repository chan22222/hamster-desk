// Standalone check of the watcher, no Electron: prints every desk event as it happens.
//   npm run watch:cli            → all live claude sessions on this machine
import { DeskWatcher } from '../electron/watcher'
import type { DeskEvent } from '../shared/events'

const C = {
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
}

function who(e: DeskEvent): string {
  const a = 'agentId' in e && e.agentId ? `${C.magenta}${e.agentId.slice(0, 6)}${C.reset}` : `${C.cyan}main${C.reset}`
  const sid = 'sessionId' in e ? e.sessionId.slice(0, 8) : '--------'
  return `${C.dim}${sid}${C.reset} ${a}`
}

function line(e: DeskEvent): string {
  switch (e.kind) {
    case 'session':
      return `${C.green}session${C.reset} ${e.sessionId.slice(0, 8)} pid=${e.pid} ${e.status} mine=${e.mine} ${e.name} ${C.dim}${e.transcriptPath ?? '(no transcript yet)'}${C.reset}`
    case 'session_gone':
      return `${C.red}session_gone${C.reset} ${e.sessionId.slice(0, 8)}`
    case 'title':
      return `${who(e)} title  ${e.title}`
    case 'prompt':
      return `${who(e)} ${C.yellow}prompt${C.reset} ${e.text}`
    case 'agent_start':
      return `${who(e)} ${C.green}+hamster${C.reset} [${e.agentType}] ${e.description}${e.background ? ' (bg)' : ''}`
    case 'agent_stop':
      return `${who(e)} ${C.red}-hamster${C.reset}`
    case 'tool':
      return `${who(e)} ${C.blue}${e.action}${C.reset} ${e.name} ${e.label}`
    case 'tool_done':
      return `${who(e)} ${C.dim}done${C.reset} ${e.toolUseId.slice(-6)} ${e.ok ? '' : C.red + 'ERR' + C.reset}`
    case 'edit':
      return `${who(e)} ${C.yellow}edit${C.reset} ${e.op} ${e.file} +${e.added} -${e.removed}`
    case 'text':
      return `${who(e)} text   ${e.text.slice(0, 100)}`
    case 'thinking':
      return `${who(e)} ${C.dim}thinking${C.reset}`
    case 'turn_end':
      return `${who(e)} turn_end ${e.durationMs}ms`
    case 'cost':
      return `${who(e)} cost +${e.linesAdded} -${e.linesRemoved} $${e.costUSD.toFixed(2)}`
    case 'compact':
      return `${who(e)} compact`
    default:
      return JSON.stringify(e)
  }
}

const w = new DeskWatcher()
w.on('event', (e: DeskEvent) => {
  const t = new Date().toISOString().slice(11, 23)
  console.log(`${C.dim}${t}${C.reset} ${line(e)}`)
})
w.start().then(() => console.log(`${C.dim}watching ~/.claude/sessions … Ctrl+C to quit${C.reset}`))
process.on('SIGINT', () => {
  w.stop()
  process.exit(0)
})
