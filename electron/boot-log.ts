import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HAMSTER_HOME } from './statusline'

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
 */

const KEEP = 50
const marks: [string, number][] = []
let written = false

export const bootLogPath = (): string => join(HAMSTER_HOME, 'boot.log')

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
