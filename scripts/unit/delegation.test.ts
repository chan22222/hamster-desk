// The "멀티 에이전트" block in an account's CLAUDE.md (electron/delegation.ts): it goes in whole, comes
// out whole, leaves everything else exactly as it was, and never touches the real ~/.claude.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'

const HOME = mkdtempSync(join(tmpdir(), 'hd-delegation-'))
process.env.HAMSTER_HOME = HOME
// the block is worded in main's language (electron/lang.ts) and the regexes below are Korean, so
// the language is fixed before the module is imported — not left to the machine's locale
process.env.HAMSTER_LANG = 'ko'

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
  // what the sub-agents run with: `inherit` says nothing, anything else is one line each
  assert.doesNotMatch(b, /model: |effort: /)
  assert.match(blockFor({ ...ON, model: 'lower' }), /한 단계 낮은 모델.*fable→opus, opus→sonnet, sonnet→haiku/)
  assert.match(blockFor({ ...ON, model: 'sonnet' }), /model: sonnet/)
  assert.match(blockFor({ ...ON, effort: 'high' }), /effort: high/)
  assert.equal(blockFor({ ...ON, model: 'haiku', effort: 'low' }).split('\n').length, 7, 'a model line and an effort line on top of the five')
  // a custom text is taken line by line, as bullets; blank = the default preset's first line
  assert.match(blockFor({ ...ON, preset: 'custom', custom: '항상 셋으로 나눠\n- 검토는 넷째가' }), /- 항상 셋으로 나눠\n- 검토는 넷째가/)
  assert.match(blockFor({ ...ON, preset: 'custom', custom: '  ' }), /독립적으로 나뉘는/)
  // one line per preset (both `inherit` add none): the block must stay as short as a sentence the user would type
  for (const preset of ['when-needed', 'eager', 'plan-review'] as const) assert.equal(blockFor({ ...ON, preset }).split('\n').length, 5)
})

test('sanitizeConfig: on by default, unknown preset/cap fall back, custom is capped', () => {
  assert.deepEqual(sanitizeConfig(undefined), DEFAULT_DELEGATION)
  assert.equal(sanitizeConfig({ on: false }).on, false)
  assert.equal(sanitizeConfig({ preset: 'nope' }).preset, 'when-needed')
  // `cap` (0.1.16–0.1.18) in an older ui.json is ignored, not carried; an unknown model or effort falls back
  assert.deepEqual(sanitizeConfig({ cap: 3, model: 'nope', effort: 'zzz' }), DEFAULT_DELEGATION)
  assert.equal('cap' in sanitizeConfig({ cap: 3 }), false)
  assert.equal(sanitizeConfig({ model: 'lower', effort: 'max' }).model, 'lower')
  assert.equal(sanitizeConfig({ model: 'lower', effort: 'max' }).effort, 'max')
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
  assert.equal(fileState(file, { ...ON, effort: 'high' }), 'stale')
  assert.equal(applyToFile(file, { ...ON, effort: 'high' }).state, 'installed')
  assert.match(readFileSync(file, 'utf8'), /effort: high/)
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

test('the block is worded in main’s language: HAMSTER_LANG=en gives the English heading', () => {
  process.env.HAMSTER_LANG = 'en'
  try {
    const b = blockFor(ON)
    assert.match(b, /^<!-- hamster-desk:delegation start -->\n<!-- This block is managed by/, 'the markers stay, the owner line follows the language')
    assert.ok(b.includes('\n## Splitting work (Hamster Desk)\n'))
    assert.match(blockFor({ ...ON, model: 'lower' }), /one tier below the main model/)
    assert.match(blockFor({ ...ON, model: 'opus', effort: 'xhigh' }), /model: opus[\s\S]*effort: xhigh/)
    // a file written in one language reads as stale in the other, and the next sync rewrites it
    const file = join(HOME, 'lang', 'CLAUDE.md')
    assert.equal(applyToFile(file, ON).state, 'installed')
    process.env.HAMSTER_LANG = 'ko'
    assert.equal(fileState(file, ON), 'stale')
    assert.equal(applyToFile(file, ON).state, 'installed')
    assert.match(readFileSync(file, 'utf8'), /## 작업 분담/)
  } finally {
    process.env.HAMSTER_LANG = 'ko'
  }
})
