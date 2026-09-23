import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Where a slow start went: one line per launch in ~/.hamster-desk/boot.log, the last 50 kept.
 *
 *   2026-09-21T06:40:01.123Z 0.1.0 2cd4682 packaged | os>main 9800 | ready +210 | window +35 | dom +480 | load +20 | booted +340 | total 10885ms
 *
 * `os>main` is the part no code of ours can touch or even see from inside: from the moment Windows
 * created the process to the first line of main.ts — loading a 240 MB unsigned exe, which is when
 * an antivirus reads it. Everything after it is this app. A slow start that shows small numbers
 * everywhere was slow *before* the process existed (the antivirus holding the launch itself).
 *
 * Pure node, every failure swallowed: a diagnostic must never be the thing that breaks a start.
 * The same goes for its neighbour below, error.log (`logError`).
 */

const KEEP = 50
const marks: [string, number][] = []
let written = false

/** Read from the env on every call, like ui-store.ts — a constant would be fixed before a test can point it at a temp folder. */
export const bootLogPath = (): string => join(process.env.HAMSTER_HOME || join(homedir(), '.hamster-desk'), 'boot.log')

export function bootMark(name: string): void {
  if (!written) marks.push([name, Date.now()])
}

/** `createdAt`: process.getCreationTime() — epoch ms, or null where the platform does not say */
export function writeBootLog(head: string, createdAt: number | null): void {
  if (written || marks.length === 0) return
  written = true
  try {
    const first = marks[0][1]
    const parts = [createdAt ? `os>${marks[0][0]} ${Math.round(first - createdAt)}` : `${marks[0][0]} 0`]
    for (let i = 1; i < marks.length; i++) parts.push(`${marks[i][0]} +${marks[i][1] - marks[i - 1][1]}`)
    const total = marks[marks.length - 1][1] - (createdAt ? Math.round(createdAt) : first)
    const line = `${new Date(first).toISOString()} ${head} | ${parts.join(' | ')} | total ${total}ms`
    const file = bootLogPath()
    let old: string[] = []
    try {
      old = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    } catch {
      /* first launch */
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, [...old, line].slice(-KEEP).join('\n') + '\n', 'utf8')
  } catch {
    /* ignore */
  }
}

// ---- error.log -------------------------------------------------------------------------------

const ERRORS_KEEP = 200

export const errorLogPath = (): string => join(process.env.HAMSTER_HOME || join(homedir(), '.hamster-desk'), 'error.log')

/**
 * What went wrong in main that nobody would otherwise see — an exception no code caught, a rejection
 * nobody handled, a step of the start-up that failed, a renderer that died: one line each in
 * ~/.hamster-desk/error.log, the last 200 kept, next to this file's boot.log.
 *
 *   2026-09-23T06:40:01.123Z start:status | Error: EPERM: operation not permitted, mkdir '…' at …
 *
 * A capture run writes nothing into the user's folder (the rule main.ts keeps for boot.log): it
 * prints the line instead. Every failure swallowed — the log must never be the next error.
 */
export function logError(where: string, err: unknown): void {
  try {
    const what = err instanceof Error ? err.stack || err.message : String(err)
    const line = `${new Date().toISOString()} ${where} | ${what.replace(/\s+/g, ' ').slice(0, 1000)}`
    console.error(`[error] ${line}`)
    if (process.env.HAMSTER_CAPTURE) return
    const file = errorLogPath()
    let old: string[] = []
    try {
      old = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    } catch {
      /* first line */
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, [...old, line].slice(-ERRORS_KEEP).join('\n') + '\n', 'utf8')
  } catch {
    /* ignore */
  }
}
