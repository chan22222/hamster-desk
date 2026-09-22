// The "명령 하달" block in an account's CLAUDE.md (electron/delegation.ts): it goes in whole, comes
// out whole, leaves everything else exactly as it was, and never touches the real ~/.claude.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'

const HOME = mkdtempSync(join(tmpdir(), 'hd-delegation-'))
process.env.HAMSTER_HOME = HOME

import { DEFAULT_DELEGATION, applyToFile, blockFor, fileState, sanitizeConfig, syncDelegation, withBlock, withoutBlock, storeConfig } from '../../electron/delegation'
import { flushUi } from '../../electron/ui-store'

after(() => rmSync(HOME, { recursive: true, force: true }))

const ON = { ...DEFAULT_DELEGATION }
const OFF = { ...DEFAULT_DELEGATION, on: false }

test('the block: markers, an owner line, the preset lines, the cap only when set', () => {
  const b = blockFor(ON)
  assert.ok(b.startsWith('<!-- hamster-desk:delegation start -->\n<!-- Hamster Desk'))
  assert.ok(b.endsWith('<!-- hamster-desk:delegation end -->'))
  assert.match(b, /## 작업 분담/)
  assert.doesNotMatch(b, /최대 \d개/)
  assert.match(blockFor({ ...ON, cap: 3 }), /최대 3개/)
  // a custom text is taken line by line, as bullets; blank = the default preset's first line
  assert.match(blockFor({ ...ON, preset: 'custom', custom: '항상 셋으로 나눠\n- 검토는 넷째가' }), /- 항상 셋으로 나눠\n- 검토는 넷째가/)
  assert.match(blockFor({ ...ON, preset: 'custom', custom: '  ' }), /독립적인 부분/)
})

test('sanitizeConfig: on by default, unknown preset/cap fall back, custom is capped', () => {
  assert.deepEqual(sanitizeConfig(undefined), DEFAULT_DELEGATION)
  assert.equal(sanitizeConfig({ on: false }).on, false)
  assert.equal(sanitizeConfig({ preset: 'nope', cap: 5 }).preset, 'when-needed')
  assert.equal(sanitizeConfig({ preset: 'eager', cap: 5 }).cap, 0)
  assert.equal(sanitizeConfig({ custom: 'a\r\nb' }).custom, 'a\nb')
  assert.equal(sanitizeConfig({ custom: 'x'.repeat(5000) }).custom.length, 2000)
})

test('withBlock / withoutBlock leave the user’s own text exactly as it was', () => {
  const own = '# 내 메모\n\n- 한국어로 답해\n'
  const w = withBlock(own, ON)
  assert.ok(w.startsWith(own.trimEnd() + '\n\n<!-- hamster-desk:delegation start -->'))
  assert.equal(withoutBlock(w), own)
  assert.equal(withBlock(w, OFF), own, 'off: only the block goes')
  // the block in the middle of a file somebody edited around: one blank line is left, not three
  const mid = `# 위\n\n${blockFor(ON)}\n\n# 아래\n`
  assert.equal(withoutBlock(mid), '# 위\n\n# 아래\n')
  // changing the preset replaces the block in place of the old one, never a second copy
  const w2 = withBlock(w, { ...ON, preset: 'eager' })
  assert.equal((w2.match(/hamster-desk:delegation start/g) ?? []).length, 1)
  assert.match(w2, /언제나 서브에이전트/)
  assert.equal(withBlock('', ON), blockFor(ON) + '\n')
  assert.equal(withBlock('', OFF), '')
})

test('applyToFile: creates, updates, removes; keeps CRLF; a file left empty is removed', () => {
  const dir = join(HOME, 'acc')
  const file = join(dir, 'CLAUDE.md')
  assert.equal(fileState(file, ON), 'none')
  assert.equal(fileState(file, OFF), 'installed', 'off and nothing there is what was asked for')
  assert.deepEqual(applyToFile(file, ON), { state: 'installed', error: null })
  assert.ok(existsSync(file))
  assert.equal(fileState(file, { ...ON, cap: 2 }), 'stale')
  assert.equal(applyToFile(file, { ...ON, cap: 2 }).state, 'installed')
  assert.match(readFileSync(file, 'utf8'), /최대 2개/)
  assert.equal(applyToFile(file, OFF).state, 'installed')
  assert.equal(existsSync(file), false, 'nothing of ours left → no zero-byte CLAUDE.md')

  writeFileSync(file, '# mine\r\n\r\n- rule\r\n', 'utf8')
  applyToFile(file, ON)
  const text = readFileSync(file, 'utf8')
  assert.ok(text.startsWith('# mine\r\n\r\n- rule\r\n\r\n<!-- hamster-desk:delegation start -->\r\n'), 'the file’s own line endings')
  assert.equal(fileState(file, ON), 'installed')
  applyToFile(file, OFF)
  assert.equal(readFileSync(file, 'utf8'), '# mine\r\n\r\n- rule\r\n')

  // a second apply with nothing to change does not rewrite the file
  applyToFile(file, ON)
  const before = readFileSync(file, 'utf8')
  applyToFile(file, ON)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('syncDelegation: every account, the stored config, and read-only for a capture run', () => {
  flushUi()
  storeConfig({ ...ON, preset: 'plan-review' })
  const a = { id: 'default', dir: join(HOME, 'cli') }
  const b = { id: 'acc-2', dir: join(HOME, 'acc-2') }
  const ro = syncDelegation([a, b], true)
  assert.equal(ro.config.preset, 'plan-review')
  assert.equal(ro.accounts.default.state, 'none')
  assert.equal(existsSync(join(a.dir, 'CLAUDE.md')), false, 'read-only wrote nothing')
  const rw = syncDelegation([a, b])
  assert.equal(rw.accounts.default.state, 'installed')
  assert.equal(rw.accounts['acc-2'].state, 'installed')
  assert.match(readFileSync(join(b.dir, 'CLAUDE.md'), 'utf8'), /검토 서브에이전트/)
  assert.equal(rw.accounts.default.file, join(a.dir, 'CLAUDE.md'))
})
