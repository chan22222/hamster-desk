import { execFile, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

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
  /** what was found on PATH: `claude.exe`, or an npm-global `claude.cmd` shim */
  path: string
  /** a `claude.cmd` shim that could not be read (see `run`): a batch file, so it has to go through cmd.exe */
  viaCmd: boolean
  /** what a `claude.cmd` shim starts, run directly instead: the program and the arguments that go first */
  run?: { file: string; args: string[] }
}

/**
 * The program an npm `claude.cmd` shim starts, relative to the shim's own folder — read out of the
 * shim so that it can be run without cmd.exe, which cuts an argument at its first line break and
 * expands `%…%` even inside quotes. npm writes the target as the last quoted `%dp0%\…` (or, before
 * npm 7, `%~dp0\…`) path on the line that hands `%*` on: the package's own `bin\claude.exe` in
 * current packages, `cli.js` for node in older ones. null when the shim says anything else.
 */
export function parseCmdShim(text: string): string | null {
  for (const line of text.split(/\r?\n/).reverse()) {
    if (!line.includes('%*')) continue
    const targets = [...line.matchAll(/"%(?:dp0%|~dp0)\\([^"%]+)"/gi)].map((m) => m[1])
    const last = targets[targets.length - 1]
    if (last && /\.(?:exe|c?js|mjs)$/i.test(last) && !/^node\.exe$/i.test(last)) return last
  }
  return null
}

/** the first `exe` along a PATH value */
function onPath(exe: string, pathValue: string): string | null {
  for (const d of pathValue.split(delimiter)) {
    if (!d) continue
    const p = join(d, exe)
    if (existsSync(p)) return p
  }
  return null
}

/** What a `claude.cmd` runs, as a program and its leading arguments; null when the shim cannot be followed. */
function runOfShim(shim: string, pathValue: string): ClaudeBin['run'] | null {
  let text: string
  try {
    text = readFileSync(shim, 'utf8')
  } catch {
    return null
  }
  const rel = parseCmdShim(text)
  if (!rel) return null
  const target = resolve(dirname(shim), rel)
  if (!existsSync(target)) return null
  if (/\.exe$/i.test(target)) return { file: target, args: [] }
  // a script: the node the shim itself would take — one next to it, else the one on PATH
  const beside = join(dirname(shim), 'node.exe')
  const node = existsSync(beside) ? beside : onPath('node.exe', pathValue)
  return node ? { file: node, args: [target] } : null
}

/**
 * Locate the claude CLI along the *cleaned* PATH (so ~/.local/bin wins and npm's node_modules/.bin
 * shims are ignored). On Windows a plain `claude.exe` is preferred; `claude.cmd` (npm -g install)
 * is the fallback, run as whatever the shim starts (`run`) — and only when the shim cannot be
 * followed, through the command interpreter.
 */
export function findClaude(): ClaudeBin | null {
  const env = cleanEnv()
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const pathValue = env[pathKey] ?? ''
  const dirs = pathValue.split(delimiter).filter(Boolean)
  const win = process.platform === 'win32'
  for (const d of dirs) {
    const p = join(d, win ? 'claude.exe' : 'claude')
    if (existsSync(p)) return { path: p, viaCmd: false }
  }
  if (win) {
    for (const d of dirs) {
      const p = join(d, 'claude.cmd')
      if (!existsSync(p)) continue
      const run = runOfShim(p, pathValue)
      return run ? { path: p, viaCmd: false, run } : { path: p, viaCmd: true }
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

/**
 * What cmd.exe does not leave alone inside quotes: a `"` ends them, `%…%` (and `!…!` where delayed
 * expansion is on) is expanded, and a line break ends the command. An argument carrying one of these
 * is refused rather than escaped — there is no escaping that holds for all of them at once.
 */
const CMD_UNSAFE = /["%!\r\n]/

export interface ClaudeInvocation {
  file: string
  args: string[]
  /** pass as child_process `windowsVerbatimArguments` */
  verbatim: boolean
}

/**
 * Turn a claude argv into something execFile/spawn can run: the CLI itself, what a `claude.cmd`
 * shim starts, or — the shim could not be followed — cmd.exe running the shim. Throws on an argument
 * cmd.exe would not pass on as it is (`CMD_UNSAFE`); only that last route ever checks.
 */
export function claudeInvocation(bin: ClaudeBin, args: string[]): ClaudeInvocation {
  if (bin.run) return { file: bin.run.file, args: [...bin.run.args, ...args], verbatim: false }
  if (!bin.viaCmd) return { file: bin.path, args, verbatim: false }
  if ([bin.path, ...args].some((a) => CMD_UNSAFE.test(a))) throw new Error('unsafe-argument')
  const line = [winQuote(bin.path), ...args.map(winQuote)].join(' ')
  // `cmd /s /c "<line>"` strips exactly the outer quote pair and runs the rest verbatim; /v:off
  // keeps `!` literal whatever the registry says about delayed expansion.
  return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/v:off', '/s', '/c', `"${line}"`], verbatim: true }
}

/**
 * Stop a child this app started, and whatever it started in turn. Through cmd.exe the child is the
 * interpreter, and killing it alone leaves claude running on; `taskkill /T` takes the whole tree.
 * Asynchronous: nothing waits for it.
 */
export function stopTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32' && child.pid) {
    execFile('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, timeout: 5000 }, (err) => {
      if (err) child.kill() // taskkill could not run; the child alone is still better than nothing
    })
    return
  }
  child.kill()
}
