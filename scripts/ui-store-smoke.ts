// Checks the UI settings file (~/.hamster-desk/ui.json) without Electron:
//   npx tsx scripts/ui-store-smoke.ts        (npm run smoke:ui)
// Everything runs against a throwaway HAMSTER_HOME, so the user's real settings are never touched.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flushUi, loadUi, saveUi, uiPath } from '../electron/ui-store'

// ui-store reads HAMSTER_HOME on every uiPath() call (nothing at import time), so setting it here —
// after the imports have been evaluated — is enough to keep the real ~/.hamster-desk untouched.
const tmpRoot = mkdtempSync(join(tmpdir(), 'hd-ui-'))
process.env.HAMSTER_HOME = tmpRoot

let failures = 0
function check(ok: boolean, what: string, extra?: unknown): void {
  if (ok) console.log(`  ok   ${what}`)
  else {
    failures++
    console.log(`  FAIL ${what}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`)
  }
}

/** Read the file the way a fresh process would: straight off disk, ignoring the module's cache. */
function onDisk(): unknown {
  try {
    return JSON.parse(readFileSync(uiPath(), 'utf8'))
  } catch {
    return null
  }
}

console.log('\n[1] no file yet')
{
  check(!existsSync(uiPath()), 'ui.json does not exist', uiPath())
  const s = loadUi()
  check(JSON.stringify(s) === '{}', 'loadUi() is {}', s)
}

console.log('\n[2] save + flush lands on disk')
{
  saveUi({ a: 1 })
  flushUi()
  check(JSON.stringify(onDisk()) === '{"a":1}', 'file holds {"a":1}', onDisk())
  check(!existsSync(`${uiPath()}.tmp`), 'the atomic temp file was renamed away')
}

console.log('\n[3] shallow merge / null deletes')
{
  const merged = saveUi({ b: 2 })
  flushUi()
  check(JSON.stringify(merged) === '{"a":1,"b":2}', 'saveUi returns the merged state', merged)
  check(JSON.stringify(onDisk()) === '{"a":1,"b":2}', 'file holds both keys', onDisk())
  const after = saveUi({ a: null })
  flushUi()
  check(JSON.stringify(after) === '{"b":2}', 'null removed "a"', after)
  check(JSON.stringify(onDisk()) === '{"b":2}', 'file no longer has "a"', onDisk())
  const skipped = saveUi({ fn: () => 1, gone: undefined })
  flushUi()
  check(JSON.stringify(skipped) === '{"b":2}', 'function / undefined values ignored', skipped)
}

console.log('\n[4] 300 ms debounce')
{
  const before = JSON.stringify(onDisk())
  for (let i = 0; i < 5; i++) saveUi({ n: i })
  check(JSON.stringify(onDisk()) === before, 'file still holds the old content right after 5 saves', onDisk())
  check(JSON.stringify(loadUi()) === '{"b":2,"n":4}', 'loadUi() already sees the pending state', loadUi())
  flushUi()
  check(JSON.stringify(onDisk()) === '{"b":2,"n":4}', 'flushUi() wrote the newest state', onDisk())
}

console.log('\n[5] corrupt file')
{
  writeFileSync(uiPath(), '{{{', 'utf8')
  const s = loadUi()
  check(JSON.stringify(s) === '{}', 'loadUi() falls back to {}', s)
  const bad = join(tmpRoot, 'ui.corrupt.json')
  check(existsSync(bad), 'ui.corrupt.json kept the damaged file')
  check(existsSync(bad) && readFileSync(bad, 'utf8') === '{{{', 'ui.corrupt.json holds the original bytes')
  check(!existsSync(uiPath()), 'the broken ui.json was moved out of the way')
}

console.log('\n[6] oversized save is ignored, not thrown')
{
  let threw: unknown = null
  let result: unknown = null
  try {
    result = saveUi({ huge: 'x'.repeat(300 * 1024) })
  } catch (e) {
    threw = e
  }
  check(threw === null, 'saveUi did not throw', threw instanceof Error ? threw.message : threw)
  check(JSON.stringify(result) === '{}', 'state unchanged', result)
  flushUi()
  check(!existsSync(uiPath()), 'nothing was written', onDisk())
  const ok = saveUi({ small: 'still works' })
  flushUi()
  check(JSON.stringify(ok) === '{"small":"still works"}', 'the store still accepts normal saves', ok)
}

flushUi()
rmSync(tmpRoot, { recursive: true, force: true })
console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n')
process.exit(failures ? 1 : 0)
