import { EventEmitter } from 'node:events'
import { promises as fsp, existsSync, mkdirSync, watch, type FSWatcher, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { StatusSnapshot, RateWindow } from '../shared/events'
import { claudeDir } from './watcher/paths'

/**
 * Opt-in status line integration.
 *
 * Claude Code can run a `statusLine.command` and feeds it a JSON snapshot (model, context window,
 * cost, rate limits) on stdin whenever the conversation updates. That is the only place the CLI
 * exposes the 5-hour / 7-day usage windows, so the app installs a tiny script that (1) prints a
 * one-line status for the terminal and (2) drops the JSON into ~/.hamster-desk/status/<session>.json,
 * which the app watches. The script runs asynchronously next to the CLI and never blocks the model.
 */

export const HAMSTER_HOME = join(homedir(), '.hamster-desk')
export const STATUS_DIR = join(HAMSTER_HOME, 'status')
export const SCRIPT_PATH = join(HAMSTER_HOME, 'statusline.cjs')
const MARK = 'hamster-desk statusline'

// Written with CommonJS so it runs under any Node the user has on PATH. Kept dependency-free and tiny.
const SCRIPT = `#!/usr/bin/env node
// ${MARK} — prints one status line for Claude Code and mirrors the JSON for Hamster Desk.
const fs = require('fs'); const path = require('path'); const os = require('os');
let raw = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let j = {}; try { j = JSON.parse(raw); } catch {}
  try {
    const dir = path.join(os.homedir(), '.hamster-desk', 'status'); fs.mkdirSync(dir, { recursive: true });
    const id = String(j.session_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
    const tmp = path.join(dir, id + '.tmp'); fs.writeFileSync(tmp, JSON.stringify({ ts: Date.now(), ...j })); fs.renameSync(tmp, path.join(dir, id + '.json'));
  } catch {}
  const pct = (w) => (w && typeof w.used_percentage === 'number') ? Math.round(w.used_percentage) + '%' : null;
  const at = (w) => { if (!w || w.resets_at == null) return ''; const t = typeof w.resets_at === 'number' ? (w.resets_at < 1e12 ? w.resets_at * 1000 : w.resets_at) : Date.parse(w.resets_at); if (!t) return ''; const d = new Date(t); const now = new Date(); const hh = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); return d.toDateString() === now.toDateString() ? hh : (d.getMonth()+1) + '/' + d.getDate() + ' ' + hh; };
  const parts = [];
  if (j.model && j.model.display_name) parts.push(j.model.display_name);
  if (j.effort && j.effort.level) parts.push(j.effort.level);
  if (j.context_window && typeof j.context_window.used_percentage === 'number') parts.push('ctx ' + Math.round(j.context_window.used_percentage) + '%');
  const rl = j.rate_limits || {};
  const fh = pct(rl.five_hour); if (fh) parts.push('5h ' + fh + (at(rl.five_hour) ? ' (' + at(rl.five_hour) + ')' : ''));
  const sd = pct(rl.seven_day); if (sd) parts.push('7d ' + sd + (at(rl.seven_day) ? ' (' + at(rl.seven_day) + ')' : ''));
  process.stdout.write(parts.join(' · ') + '\\n');
});
`

// PowerShell twin for machines without Node (Windows always has powershell.exe). Slower to start
// (~200 ms) but still asynchronous from Claude Code's point of view.
export const SCRIPT_PS_PATH = join(HAMSTER_HOME, 'statusline.ps1')
const SCRIPT_PS = `# ${MARK} (PowerShell fallback)
$raw = [Console]::In.ReadToEnd()
try { $j = $raw | ConvertFrom-Json } catch { $j = $null }
if ($j) {
  try {
    $dir = Join-Path $env:USERPROFILE '.hamster-desk\\status'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $id = ([string]$j.session_id) -replace '[^a-zA-Z0-9_-]', ''
    $j | Add-Member -NotePropertyName ts -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) -Force
    $tmp = Join-Path $dir ($id + '.tmp')
    [IO.File]::WriteAllText($tmp, ($j | ConvertTo-Json -Depth 8 -Compress))
    Move-Item -Force $tmp (Join-Path $dir ($id + '.json'))
  } catch {}
  $parts = @()
  if ($j.model -and $j.model.display_name) { $parts += $j.model.display_name }
  if ($j.effort -and $j.effort.level) { $parts += $j.effort.level }
  if ($j.context_window -and $j.context_window.used_percentage -ne $null) { $parts += ('ctx ' + [math]::Round($j.context_window.used_percentage) + '%') }
  function fmt($w) { if ($w -and $w.used_percentage -ne $null) { $s = [math]::Round($w.used_percentage).ToString() + '%'; if ($w.resets_at) { $t = [DateTimeOffset]::FromUnixTimeSeconds([long]$w.resets_at).ToLocalTime(); $s += ' (' + $t.ToString('HH:mm') + ')' }; return $s } return $null }
  if ($j.rate_limits) { $a = fmt $j.rate_limits.five_hour; if ($a) { $parts += ('5h ' + $a) }; $b = fmt $j.rate_limits.seven_day; if ($b) { $parts += ('7d ' + $b) } }
  Write-Output ($parts -join ' · ')
}
`

function nodeOnPath(): boolean {
  const exe = process.platform === 'win32' ? 'node.exe' : 'node'
  return (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').some((d) => d && existsSync(join(d, exe)))
}

function settingsPath(): string {
  return join(claudeDir(), 'settings.json')
}

function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeSettings(s: Record<string, unknown>): void {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2) + '\n', 'utf8')
}

export function statusLineCommand(): string {
  if (nodeOnPath()) return `node "${SCRIPT_PATH}"`
  return process.platform === 'win32' ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${SCRIPT_PS_PATH}"` : `node "${SCRIPT_PATH}"`
}

export type StatusLineState = 'installed' | 'foreign' | 'none'

/** 'installed' = ours, 'foreign' = the user has their own status line, 'none' = nothing configured. */
export function statusLineState(): StatusLineState {
  const s = readSettings()
  const sl = s.statusLine as { command?: string } | undefined
  if (!sl || typeof sl.command !== 'string') return 'none'
  return /statusline\.(cjs|ps1)/.test(sl.command) && sl.command.includes('.hamster-desk') ? 'installed' : 'foreign'
}

/** Write the script and point Claude Code's statusLine at it. Keeps a backup of a foreign command. */
export function installStatusLine(): void {
  mkdirSync(STATUS_DIR, { recursive: true })
  writeFileSync(SCRIPT_PATH, SCRIPT, 'utf8')
  writeFileSync(SCRIPT_PS_PATH, SCRIPT_PS, 'utf8')
  const s = readSettings()
  const prev = s.statusLine as Record<string, unknown> | undefined
  if (prev && typeof prev.command === 'string' && !/statusline\.(cjs|ps1)/.test(String(prev.command))) {
    s.hamsterDeskPreviousStatusLine = prev
  }
  s.statusLine = { type: 'command', command: statusLineCommand(), padding: 0 }
  writeSettings(s)
}

export function uninstallStatusLine(): void {
  const s = readSettings()
  const sl = s.statusLine as { command?: string } | undefined
  if (sl && typeof sl.command === 'string' && /statusline\.(cjs|ps1)/.test(sl.command)) {
    if (s.hamsterDeskPreviousStatusLine) {
      s.statusLine = s.hamsterDeskPreviousStatusLine
      delete s.hamsterDeskPreviousStatusLine
    } else {
      delete s.statusLine
    }
    writeSettings(s)
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function window(v: unknown): RateWindow | null {
  if (!v || typeof v !== 'object') return null
  const w = v as Record<string, unknown>
  const used = num(w.used_percentage) ?? num(w.utilization) ?? num(w.used)
  if (used === null) return null
  let resetsAt: number | null = null
  const r = w.resets_at ?? w.reset_at ?? w.resetsAt
  if (typeof r === 'number') resetsAt = r < 1e12 ? r * 1000 : r
  else if (typeof r === 'string') {
    const t = Date.parse(r)
    resetsAt = Number.isNaN(t) ? null : t
  }
  return { usedPercentage: used, resetsAt }
}

export function parseSnapshot(j: Record<string, unknown>): StatusSnapshot | null {
  const sessionId = typeof j.session_id === 'string' ? j.session_id : null
  if (!sessionId) return null
  const model = j.model as Record<string, unknown> | undefined
  const ctx = j.context_window as Record<string, unknown> | undefined
  const cost = j.cost as Record<string, unknown> | undefined
  const effort = j.effort as Record<string, unknown> | undefined
  const rl = (j.rate_limits ?? {}) as Record<string, unknown>
  const other: Record<string, RateWindow> = {}
  for (const [k, v] of Object.entries(rl)) {
    if (k === 'five_hour' || k === 'seven_day') continue
    const w = window(v)
    if (w) other[k] = w
  }
  return {
    sessionId,
    ts: num(j.ts) ?? Date.now(),
    model: model && typeof model.id === 'string' ? { id: model.id, displayName: String(model.display_name ?? model.id) } : null,
    effort: effort && typeof effort.level === 'string' ? effort.level : null,
    contextUsedPct: num(ctx?.used_percentage),
    contextSize: num(ctx?.context_window_size),
    costUSD: num(cost?.total_cost_usd),
    linesAdded: num(cost?.total_lines_added),
    linesRemoved: num(cost?.total_lines_removed),
    fiveHour: window(rl.five_hour),
    sevenDay: window(rl.seven_day),
    otherWindows: other,
  }
}

/** Watches ~/.hamster-desk/status/*.json and emits 'status' with a StatusSnapshot. */
export class StatusWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private seen = new Map<string, number>() // file → mtime

  start(): void {
    mkdirSync(STATUS_DIR, { recursive: true })
    try {
      this.watcher = watch(STATUS_DIR, { persistent: false }, (_e, f) => {
        if (f && String(f).endsWith('.json')) void this.read(String(f))
      })
      this.watcher.on('error', () => {})
    } catch {
      /* poll only */
    }
    this.timer = setInterval(() => void this.scan(), 5000)
    void this.scan()
  }

  stop(): void {
    this.watcher?.close()
    if (this.timer) clearInterval(this.timer)
  }

  private async scan(): Promise<void> {
    let names: string[]
    try {
      names = (await fsp.readdir(STATUS_DIR)).filter((n) => n.endsWith('.json'))
    } catch {
      return
    }
    for (const n of names) await this.read(n)
  }

  private async read(name: string): Promise<void> {
    const p = join(STATUS_DIR, name)
    let st
    try {
      st = await fsp.stat(p)
    } catch {
      return
    }
    if (this.seen.get(name) === st.mtimeMs) return
    let j: Record<string, unknown>
    try {
      j = JSON.parse(await fsp.readFile(p, 'utf8'))
    } catch {
      return // mid-rename; retried on the next event
    }
    this.seen.set(name, st.mtimeMs)
    const snap = parseSnapshot(j)
    if (snap) this.emit('status', snap)
  }
}

export function statusDirExists(): boolean {
  return existsSync(STATUS_DIR)
}
