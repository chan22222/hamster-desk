import * as pty from 'node-pty'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { cleanEnv, findOnPath } from './env'
import type { PtyInfo } from '../shared/events'

// cleanEnv/findOnPath live in ./env so modules that must not load node-pty (the bubble summarizer,
// tsx smoke scripts) can use them. Re-exported because pty.ts was their original home.
export { cleanEnv, findOnPath } from './env'

export interface PtyHandle extends PtyInfo {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export function defaultShell(): string {
  if (process.platform === 'win32') {
    return findOnPath('pwsh.exe') ?? 'powershell.exe'
  }
  return process.env.SHELL || 'bash'
}

let nextId = 1

/**
 * Spawns the user's shell under a pseudo terminal (ConPTY on Windows). The user runs `claude` in it
 * exactly as they would in Windows Terminal; nothing sits between the CLI and the API.
 */
export function spawnPty(
  cols: number,
  rows: number,
  onData: (data: string) => void,
  onExit: (code: number) => void,
  cwd?: string,
  /** another account's config folder (electron/profiles.ts); null leaves the env exactly as it is */
  configDir?: string | null,
): PtyHandle {
  const shell = defaultShell()
  const env = cleanEnv()
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.HAMSTER_DESK = '1'
  // the one thing that tells the CLI which account it is: where it keeps its login and settings
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir
  const dir = cwd && existsSync(cwd) ? cwd : homedir()
  const proc = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: Math.max(2, cols),
    rows: Math.max(1, rows),
    cwd: dir,
    env,
    useConpty: true,
  })
  const id = nextId++
  proc.onData(onData)
  proc.onExit(({ exitCode }) => onExit(exitCode))
  return {
    id,
    pid: proc.pid,
    shell,
    cwd: dir,
    write: (d) => proc.write(d),
    resize: (c, r) => {
      try {
        proc.resize(Math.max(2, c), Math.max(1, r))
      } catch {
        /* closed */
      }
    },
    kill: () => {
      // ConPTY only signals the shell; a claude session running inside it would survive, so take the tree down.
      // taskkill already took the shell with it, and node-pty's conpty helper would then die with
      // "AttachConsole failed" all over stderr, so only fall back to proc.kill() if taskkill could not run.
      if (process.platform === 'win32') {
        try {
          execFileSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore', windowsHide: true })
          return
        } catch {
          /* taskkill unavailable or the tree is already gone — let node-pty try */
        }
      }
      try {
        proc.kill()
      } catch {
        /* already gone */
      }
    },
  }
}

// ---- prompt detection on the terminal stream (heuristic; the transcript never records a permission prompt)
// The full-screen TUI positions every word with cursor moves, so after stripping escapes the spaces are gone.
// We therefore compare with all whitespace removed on both sides.

const ESC = String.fromCharCode(27)
const ANSI = new RegExp(
  [
    `${ESC}\\[[0-9;?]*[ -/]*[@-~]`, // CSI
    `${ESC}\\][^${ESC}\\u0007]*(?:\\u0007|${ESC}\\\\)`, // OSC ... BEL | ST
    `${ESC}[PX^_][^${ESC}]*${ESC}\\\\`, // DCS / SOS / PM / APC ... ST
    `${ESC}[@-Z\\\\-_]`, // 2-byte escapes
    `\\u009b[0-9;?]*[ -/]*[@-~]`, // 8-bit CSI
  ].join('|'),
  'g',
)

export function stripTerminal(s: string): string {
  return s.replace(ANSI, '').replace(/\s+/g, '')
}

const squash = (s: string): string => s.replace(/\s+/g, '')

type WaitReason = 'permission' | 'question'
const RAW_PATTERNS: { text: string; reason: WaitReason }[] = [
  { text: 'Do you want to proceed', reason: 'permission' },
  { text: 'Do you want to make this edit', reason: 'permission' },
  { text: 'Do you want to create', reason: 'permission' },
  { text: 'Do you want to allow', reason: 'permission' },
  { text: 'Do you want to run', reason: 'permission' },
  { text: 'No, and tell Claude what to do differently', reason: 'permission' },
  { text: "Yes, and don't ask again", reason: 'permission' },
  { text: 'Allow once', reason: 'permission' },
  { text: 'Allow always', reason: 'permission' },
  { text: 'Yes, I trust this folder', reason: 'question' },
  { text: 'Enter to confirm·Esc to cancel', reason: 'question' },
  { text: 'Enter to confirm • Esc to cancel', reason: 'question' },
]
export const WAITING_PATTERNS = RAW_PATTERNS.map((p) => ({ ...p, text: squash(p.text).toLowerCase() }))

export class PromptDetector {
  private buf = ''
  constructor(private readonly onWaiting: (reason: 'permission' | 'question') => void) {}
  feed(chunk: string): void {
    this.buf = (this.buf + stripTerminal(chunk).toLowerCase()).slice(-4000)
    for (const p of WAITING_PATTERNS) {
      if (this.buf.includes(p.text)) {
        this.buf = ''
        this.onWaiting(p.reason)
        return
      }
    }
  }
}
