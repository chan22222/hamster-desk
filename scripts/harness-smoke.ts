// Checks collaboration mode without Electron:
//   npx tsx scripts/harness-smoke.ts
// (a) the state model in electron/harness.ts, against a throwaway HAMSTER_HOME + CLAUDE_CONFIG_DIR
//     so the user's real ~/.claude and ~/.hamster-desk are never touched;
// (b) the shell wrapper itself, run under a real pwsh with a fake `claude.cmd` on PATH, to prove the
//     four decisions: inject / off / subcommand / print.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'hd-harness-'))
const home = join(root, 'hamster-desk')
const claudeCfg = join(root, 'claude')
mkdirSync(home, { recursive: true })
mkdirSync(claudeCfg, { recursive: true })
// must be set before electron/harness.ts is loaded: HAMSTER_HOME is read at module load
process.env.HAMSTER_HOME = home
process.env.CLAUDE_CONFIG_DIR = claudeCfg

let failures = 0
function check(ok: boolean, what: string, extra?: unknown): void {
  if (ok) console.log(`  ok   ${what}`)
  else {
    failures++
    console.log(`  FAIL ${what}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`)
  }
}

const settingsFile = join(claudeCfg, 'settings.json')
const harnessFile = join(home, 'harness.json')
const agentFile = (n: string): string => join(claudeCfg, 'agents', `${n}.md`)

function settings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}
function writeSettings(s: Record<string, unknown>): void {
  writeFileSync(settingsFile, JSON.stringify(s, null, 2), 'utf8')
}
function harnessJson(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(harnessFile, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}
function reset(): void {
  rmSync(harnessFile, { force: true })
  rmSync(join(claudeCfg, 'agents'), { recursive: true, force: true })
  rmSync(settingsFile, { force: true })
}

async function stateTests(): Promise<void> {
  const h = await import('../electron/harness')

  console.log('\n[1] enable(app): nothing lands in settings.json')
  {
    reset()
    writeSettings({ model: 'claude-fable-5-1', permissions: { defaultMode: 'auto' } })
    const st = h.enableHarness({ implEffort: 'max', scope: 'app', on: true })
    check(st.on, 'state reports on', st)
    check(settings().agent === undefined, 'settings.json has no agent key', settings())
    check(settings().model === 'claude-fable-5-1', 'other settings keys untouched', settings())
    check(harnessJson().on === true && harnessJson().scope === 'app', 'harness.json on + scope app', harnessJson())
    check(existsSync(agentFile('hd-architect')) && existsSync(agentFile('hd-implementer')), 'both agent files written')
  }

  console.log('\n[2] enable(global): settings.json gets the agent key')
  {
    reset()
    const st = h.enableHarness({ implEffort: 'xhigh', scope: 'global', on: true })
    check(st.on, 'state reports on', st)
    check(settings().agent === 'hd-architect', 'agent: hd-architect', settings())
    check(harnessJson().scope === 'global', 'harness.json scope global', harnessJson())
    // and back to app scope: the global key must not linger
    h.enableHarness({ implEffort: 'xhigh', scope: 'app', on: true })
    check(settings().agent === undefined, 'switching global → app releases the key', settings())
  }

  console.log('\n[3] a foreign agent is kept and restored')
  {
    reset()
    writeSettings({ agent: 'other', model: 'm' })
    h.enableHarness({ implEffort: 'max', scope: 'global', on: true })
    check(settings().agent === 'hd-architect', 'ours while on', settings())
    check(settings().hamsterDeskPreviousAgent === 'other', 'previous agent remembered', settings())
    const off = h.disableHarness()
    check(!off.on, 'state reports off', off)
    check(settings().agent === 'other', 'previous agent restored', settings())
    check(settings().hamsterDeskPreviousAgent === undefined, 'bookkeeping key removed', settings())
    check(!existsSync(agentFile('hd-architect')) && !existsSync(agentFile('hd-implementer')), 'agent files deleted')
  }

  console.log('\n[4] migration off the old global-only setup')
  {
    reset()
    // legacy state: agent in settings.json, harness.json without a scope
    writeSettings({ agent: 'hd-architect', model: 'm' })
    mkdirSync(join(claudeCfg, 'agents'), { recursive: true })
    writeFileSync(agentFile('hd-architect'), 'x', 'utf8')
    writeFileSync(agentFile('hd-implementer'), 'x', 'utf8')
    writeFileSync(harnessFile, JSON.stringify({ implEffort: 'max' }), 'utf8')
    check(h.migrateHarness(), 'migration ran')
    check(harnessJson().scope === 'app' && harnessJson().on === true, 'now scope app, still on', harnessJson())
    check(settings().agent === undefined, 'global agent key removed', settings())
    check(settings().model === 'm', 'other keys untouched', settings())
    check(h.harnessState().on, 'collaboration mode still reported on', h.harnessState())
    check(!h.migrateHarness(), 'migration does not run twice')
  }

  console.log('\n[5] disable while in app scope')
  {
    reset()
    h.enableHarness({ implEffort: 'max', scope: 'app', on: true })
    const off = h.disableHarness()
    check(!off.on && harnessJson().on === false, 'off and persisted', harnessJson())
    check(settings().agent === undefined, 'still no agent key', settings())
  }
}

// ---- the shell wrapper, run for real

function fakeClaudeDir(): string {
  const dir = join(root, 'bin')
  mkdirSync(dir, { recursive: true })
  // echoes the arguments it was called with, which is all the assertions need
  writeFileSync(join(dir, 'claude.cmd'), '@echo off\r\necho %*\r\n', 'utf8')
  writeFileSync(join(dir, 'claude'), '#!/bin/sh\necho "$@"\n', { encoding: 'utf8', mode: 0o755 })
  return dir
}

function writeHarness(cfg: Record<string, unknown> | null): string {
  const file = join(root, 'wrapper-harness.json')
  if (cfg === null) rmSync(file, { force: true })
  else writeFileSync(file, JSON.stringify(cfg), 'utf8')
  return file
}

async function wrapperTests(): Promise<void> {
  const { psWrapperScript, encodeForPowerShell } = await import('../electron/shell-wrapper')
  const bin = fakeClaudeDir()

  if (process.platform !== 'win32') {
    console.log('\n[6] powershell wrapper — skipped (not win32)')
  } else {
    console.log('\n[6] powershell wrapper')
    const run = (harness: Record<string, unknown> | null, cmd: string): string => {
      const script = `${psWrapperScript()}\n${cmd}`
      const out = execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeForPowerShell(script)], {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, PATH: bin + delimiter + (process.env.PATH ?? ''), HAMSTER_HARNESS_FILE: writeHarness(harness) },
      })
      return out.trim()
    }
    const ON = { implEffort: 'max', scope: 'app', on: true }
    check(run(ON, 'claude foo') === '--agent hd-architect foo', 'on + app scope injects', run(ON, 'claude foo'))
    check(run({ ...ON, on: false }, 'claude foo') === 'foo', 'off runs claude unchanged', run({ ...ON, on: false }, 'claude foo'))
    check(run({ ...ON, scope: 'global' }, 'claude foo') === 'foo', 'global scope does not inject (settings.json does)', run({ ...ON, scope: 'global' }, 'claude foo'))
    check(run(ON, 'claude update') === 'update', 'a subcommand is left alone', run(ON, 'claude update'))
    check(run(ON, 'claude -p hi') === '-p hi', 'print mode is left alone', run(ON, 'claude -p hi'))
    check(run(ON, 'claude --agent mine') === '--agent mine', 'an explicit --agent wins', run(ON, 'claude --agent mine'))
    check(run(null, 'claude foo') === 'foo', 'missing config means no injection', run(null, 'claude foo'))
  }

  console.log('\n[7] bash wrapper')
  if (process.platform === 'win32') {
    console.log('  skip — bash wrapper is only used on non-win32 (Git Bash is not the spawned shell)')
  } else {
    const { bashWrapperScript } = await import('../electron/shell-wrapper')
    const rc = join(root, 'wrapper.bash')
    writeFileSync(rc, bashWrapperScript(), 'utf8')
    const run = (harness: Record<string, unknown> | null, cmd: string): string =>
      execFileSync('bash', ['-c', `. "${rc}"; ${cmd}`], {
        encoding: 'utf8',
        env: { ...process.env, PATH: bin + delimiter + (process.env.PATH ?? ''), HAMSTER_HARNESS_FILE: writeHarness(harness) },
      }).trim()
    const ON = { implEffort: 'max', scope: 'app', on: true }
    check(run(ON, 'claude foo') === '--agent hd-architect foo', 'on + app scope injects')
    check(run({ ...ON, on: false }, 'claude foo') === 'foo', 'off runs claude unchanged')
    check(run(ON, 'claude update') === 'update', 'a subcommand is left alone')
    check(run(ON, 'claude -p hi') === '-p hi', 'print mode is left alone')
  }
}

async function main(): Promise<void> {
  console.log(`temp profile: ${root}`)
  await stateTests()
  await wrapperTests()
  rmSync(root, { recursive: true, force: true })
  console.log(failures === 0 ? '\nharness-smoke: all checks passed' : `\nharness-smoke: ${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
