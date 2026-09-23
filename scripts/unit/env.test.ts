// Running claude (electron/env.ts): an npm `claude.cmd` is followed to what it starts, so nothing
// goes through cmd.exe — which cuts an argument at its first line break and expands `%…%` inside
// quotes — and when it has to, an argument cmd.exe would not pass on as it is is refused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claudeInvocation, parseCmdShim } from '../../electron/env'

/** what npm 7+ writes for a package whose bin is a native exe (@anthropic-ai/claude-code today) */
const EXE_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
  '',
].join('\r\n')

/** …and for a JS bin, run by node */
const JS_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  '',
].join('\r\n')

/** npm 6 */
const OLD_SHIM = [
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  ') ELSE (',
  '  @SETLOCAL',
  '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
  '  node  "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  ')',
].join('\r\n')

test('the program a claude.cmd starts is read out of it, whichever npm wrote it', () => {
  assert.equal(parseCmdShim(EXE_SHIM), 'node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe')
  assert.equal(parseCmdShim(JS_SHIM), 'node_modules\\@anthropic-ai\\claude-code\\cli.js')
  assert.equal(parseCmdShim(OLD_SHIM), 'node_modules\\@anthropic-ai\\claude-code\\cli.js', 'the script, not node.exe in front of it')
  // pnpm's reaches up out of its folder
  assert.equal(parseCmdShim('  "%~dp0\\node.exe"  "%~dp0\\..\\@anthropic-ai\\claude-code\\cli.js" %*'), '..\\@anthropic-ai\\claude-code\\cli.js')
})

test('a shim that says anything else is not followed', () => {
  assert.equal(parseCmdShim('@echo off\r\nclaude-real.bat %*'), null)
  assert.equal(parseCmdShim('"%dp0%\\thing.bat" %*'), null)
  assert.equal(parseCmdShim(''), null)
})

test('a followed shim runs its program directly, the arguments exactly as given', () => {
  const multi = 'line one\nline two with "quotes" and %PATH%'
  const exe = claudeInvocation({ path: 'C:\\npm\\claude.cmd', viaCmd: false, run: { file: 'C:\\npm\\claude.exe', args: [] } }, ['-p', multi])
  assert.deepEqual(exe, { file: 'C:\\npm\\claude.exe', args: ['-p', multi], verbatim: false })
  const js = claudeInvocation({ path: 'C:\\npm\\claude.cmd', viaCmd: false, run: { file: 'C:\\node\\node.exe', args: ['C:\\npm\\cli.js'] } }, ['--version'])
  assert.deepEqual(js, { file: 'C:\\node\\node.exe', args: ['C:\\npm\\cli.js', '--version'], verbatim: false })
})

test('through cmd.exe: plain arguments pass, the ones cmd.exe would change are refused', () => {
  const bin = { path: 'C:\\npm\\claude.cmd', viaCmd: true }
  const ok = claudeInvocation(bin, ['-p', '--tools', '', '--system-prompt', 'Reply with the single word OK.'])
  assert.equal(ok.verbatim, true)
  assert.deepEqual(ok.args.slice(0, 4), ['/d', '/v:off', '/s', '/c'])
  assert.equal(ok.args[4], '"C:\\npm\\claude.cmd -p --tools "" --system-prompt "Reply with the single word OK.""')
  for (const bad of ['two\nlines', 'a\rb', 'say "hi"', '100%', '%USERPROFILE%', 'bang!']) {
    assert.throws(() => claudeInvocation(bin, ['-p', bad]), /unsafe-argument/, JSON.stringify(bad))
  }
})
