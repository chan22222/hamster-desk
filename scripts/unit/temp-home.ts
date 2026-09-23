// Imported first, for its side effect: HAMSTER_HOME points at a fresh temp folder before any module
// that fixes its paths when it loads (electron/statusline.ts) is evaluated. Setting the variable in
// a test's own body is too late for those — every import runs before the body does.
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const TEMP_ROOT = mkdtempSync(join(tmpdir(), 'hd-home-'))
// named like the real one: electron/statusline.ts knows the app's own command by its `.hamster-desk` path
export const TEMP_HOME = join(TEMP_ROOT, '.hamster-desk')
mkdirSync(TEMP_HOME, { recursive: true })
process.env.HAMSTER_HOME = TEMP_HOME
