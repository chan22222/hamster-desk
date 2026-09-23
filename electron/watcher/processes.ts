import { execFile, type ChildProcess } from 'node:child_process'

/**
 * Parent-pid map of every process, used to tell "claude started inside this window's shell"
 * apart from claude sessions running in other terminals. Windows: one PowerShell call, cached.
 */
let cache: { at: number; map: Map<number, number> } | null = null
let inflight: Promise<Map<number, number>> | null = null
const TTL = 4000
/** Get-CimInstance answers in ~0.5 s; one that has not answered by now waits on a wedged WMI */
const QUERY_TIMEOUT_MS = 10_000
/** after a failed query the last map answers for this long, instead of a new PowerShell every scan */
const RETRY_AFTER_FAIL_MS = 30_000
let failedAt = 0
/** the query that is running, so the last watcher to stop can take it down with it */
let running: { child: ChildProcess; cancelled: boolean } | null = null
let users = 0
const CANCELLED = new Error('parent map query cancelled')

/** `fresh`: skip the cache — the caller is looking for a process the cached map is too old to know */
export function parentMap(fresh = false): Promise<Map<number, number>> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return Promise.resolve(cache.map)
  if (inflight) return inflight
  if (Date.now() - failedAt < RETRY_AFTER_FAIL_MS) return Promise.resolve(cache?.map ?? new Map())
  inflight = query()
    .then((map) => {
      cache = { at: Date.now(), map }
      return map
    })
    .catch((e) => {
      if (e !== CANCELLED) failedAt = Date.now()
      return cache?.map ?? new Map()
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/**
 * A watcher that asks for parent maps holds one of these while it runs. When the last one lets go
 * (the app is quitting, the last account was removed), a query still running is killed rather than
 * left behind as an orphaned powershell.exe.
 */
export function retainParentMap(): () => void {
  users++
  let held = true
  return () => {
    if (!held) return
    held = false
    if (--users > 0 || !running) return
    running.cancelled = true
    running.child.kill()
    running = null
  }
}

function query(): Promise<Map<number, number>> {
  return new Promise((resolve, reject) => {
    const win = process.platform === 'win32'
    const cmd = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'
    const run: { child: ChildProcess; cancelled: boolean } = {
      cancelled: false,
      child: execFile(
        win ? 'powershell.exe' : 'ps',
        win ? ['-NoProfile', '-NonInteractive', '-Command', cmd] : ['-axo', 'pid=,ppid='],
        { windowsHide: true, maxBuffer: 8 << 20, timeout: QUERY_TIMEOUT_MS },
        (err, stdout) => {
          clearTimeout(deadline)
          if (running === run) running = null
          if (run.cancelled) reject(CANCELLED)
          else if (err) reject(err)
          else resolve(parsePairs(stdout))
        },
      ),
    }
    running = run
    // `timeout` kills the child, but the callback also waits for its pipes to close: this settles the
    // promise regardless, so a query that never finishes cannot hold every later scan behind it
    const deadline = setTimeout(() => {
      run.child.kill()
      if (running === run) running = null
      reject(new Error('parent map query timed out'))
    }, QUERY_TIMEOUT_MS + 2000)
  })
}

function parsePairs(text: string): Map<number, number> {
  const map = new Map<number, number>()
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/)
    if (m) map.set(Number(m[1]), Number(m[2]))
  }
  return map
}

export function isDescendant(pid: number, ancestor: number, map: Map<number, number>): boolean {
  let cur = pid
  for (let i = 0; i < 64; i++) {
    const p = map.get(cur)
    if (p === undefined || p === 0 || p === cur) return false
    if (p === ancestor) return true
    cur = p
  }
  return false
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
