import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * What the update check did, one line per event, in ~/.hamster-desk/update.log (the last 200 kept).
 *
 *   2026-09-21T09:40:01.123Z installed 0.1.3 | available 0.1.5
 *   2026-09-21T09:40:09.456Z installed 0.1.3 | error net::ERR_INTERNET_DISCONNECTED
 *
 * "확인 실패" on screen used to be all anyone could say about a failed check, and an update happens
 * on somebody else's PC, after the fact. Pure node, every failure swallowed — like boot-log.ts.
 */

const KEEP = 200

/** Read from the env on every call, like ui-store.ts — a constant would be fixed before a test can point it at a temp folder. */
export const updateLogPath = (): string => join(process.env.HAMSTER_HOME || join(homedir(), '.hamster-desk'), 'update.log')

export function logUpdate(who: string, what: string): void {
  try {
    const file = updateLogPath()
    let old: string[] = []
    try {
      old = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    } catch {
      /* first line */
    }
    mkdirSync(dirname(file), { recursive: true })
    const line = `${new Date().toISOString()} ${who} | ${what.replace(/\s+/g, ' ').slice(0, 400)}`
    writeFileSync(file, [...old, line].slice(-KEEP).join('\n') + '\n', 'utf8')
  } catch {
    /* ignore */
  }
}
