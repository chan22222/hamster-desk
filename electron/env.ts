import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

// Environment hygiene + locating the claude CLI. Kept apart from pty.ts on purpose: pty.ts imports
// node-pty (a native module built for the Electron ABI), so anything that pulls it in cannot run
// under plain node/tsx. The bubble summarizer needs cleanEnv()/findClaude() and must stay testable
// with `npx tsx`, hence this dependency-free module.

/**
 * The shell should look like the user's own terminal, not like the process that launched the app.
 * When the app is started through npm/npx (or from inside another Claude Code session) the inherited
 * environment carries npm_* variables and `node_modules/.bin` PATH entries, which can shadow the real
 * `claude` binary with a stale copy. Strip those and put the native install dir (~/.local/bin) first.
 */
export const INTERNAL_MARKERS = new Set([
  // set by a running Claude Code session for its children; inheriting them makes the nested
  // claude think it is a child session (transcript saving off, no session file)
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'INIT_CWD',
  'NODE',
  'ELECTRON_RUN_AS_NODE',
])

export function findOnPath(exe: string): string | null {
  for (const d of (process.env.PATH ?? '').split(delimiter)) {
    if (!d) continue
    const p = join(d, exe)
    if (existsSync(p)) return p
  }
  return null
}

export function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== 'string') continue
    if (/^npm_/i.test(k) || INTERNAL_MARKERS.has(k)) continue
    env[k] = v
  }
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const parts = (env[pathKey] ?? '').split(delimiter).filter((p) => p && !/node_modules[\\/]\.bin/i.test(p))
  const native = join(homedir(), '.local', 'bin')
  if (existsSync(join(native, process.platform === 'win32' ? 'claude.exe' : 'claude'))) {
    const rest = parts.filter((p) => p.replace(/[\\/]+$/, '').toLowerCase() !== native.toLowerCase())
    parts.splice(0, parts.length, native, ...rest)
  }
  env[pathKey] = parts.join(delimiter)
  return env
}

export interface ClaudeBin {
  path: string
  /** a npm-global `claude.cmd` shim: it is a batch file, so it has to go through cmd.exe */
  viaCmd: boolean
}

/**
 * Locate the claude CLI along the *cleaned* PATH (so ~/.local/bin wins and npm's node_modules/.bin
 * shims are ignored). On Windows a plain `claude.exe` is preferred; `claude.cmd` (npm -g install)
 * is the fallback and has to be run through the command interpreter.
 */
export function findClaude(): ClaudeBin | null {
  const env = cleanEnv()
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const dirs = (env[pathKey] ?? '').split(delimiter).filter(Boolean)
  const win = process.platform === 'win32'
  for (const d of dirs) {
    const p = join(d, win ? 'claude.exe' : 'claude')
    if (existsSync(p)) return { path: p, viaCmd: false }
  }
  if (win) {
    for (const d of dirs) {
      const p = join(d, 'claude.cmd')
      if (existsSync(p)) return { path: p, viaCmd: true }
    }
  }
  return null
}

/** MSVCRT argument quoting — what cmd.exe hands to the child's command line. */
function winQuote(s: string): string {
  if (s !== '' && !/[\s"^&|<>()%!]/.test(s)) return s
  const esc = s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  return `"${esc}"`
}

export interface ClaudeInvocation {
  file: string
  args: string[]
  /** pass as child_process `windowsVerbatimArguments` */
  verbatim: boolean
}

/** Turn a claude argv into something execFile/spawn can run, routing .cmd shims through cmd.exe. */
export function claudeInvocation(bin: ClaudeBin, args: string[]): ClaudeInvocation {
  if (!bin.viaCmd) return { file: bin.path, args, verbatim: false }
  const line = [winQuote(bin.path), ...args.map(winQuote)].join(' ')
  // `cmd /s /c "<line>"` strips exactly the outer quote pair and runs the rest verbatim.
  return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true }
}
