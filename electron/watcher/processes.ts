import { execFile } from 'node:child_process'

/**
 * Parent-pid map of every process, used to tell "claude started inside this window's shell"
 * apart from claude sessions running in other terminals. Windows: one PowerShell call, cached.
 */
let cache: { at: number; map: Map<number, number> } | null = null
let inflight: Promise<Map<number, number>> | null = null
const TTL = 4000

export function parentMap(): Promise<Map<number, number>> {
  if (cache && Date.now() - cache.at < TTL) return Promise.resolve(cache.map)
  if (inflight) return inflight
  inflight = query()
    .then((map) => {
      cache = { at: Date.now(), map }
      return map
    })
    .catch(() => cache?.map ?? new Map())
    .finally(() => {
      inflight = null
    })
  return inflight
}

function query(): Promise<Map<number, number>> {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      const cmd = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, maxBuffer: 8 << 20 }, (err, stdout) => {
        if (err) return reject(err)
        resolve(parsePairs(stdout))
      })
    } else {
      execFile('ps', ['-axo', 'pid=,ppid='], { maxBuffer: 8 << 20 }, (err, stdout) => {
        if (err) return reject(err)
        resolve(parsePairs(stdout))
      })
    }
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
