// What kind of project a folder is, and the commands people run in one — the sidebar's `실행` menu.
//
// Everything comes from the folder's own top level: one readdir, a stat of each marker file it
// knows, and the text of the few it actually parses (package.json, the Makefile, pyproject.toml,
// pom.xml, build.gradle). Nothing below the folder is read and nothing is executed — the sidebar
// asks on every folder change, so this has to cost about what the listing costs. The answer is
// cached on the folder's mtime plus each marker's `size:mtime`, the way electron/transcripts.ts
// caches, so a second visit is the stats and nothing else.
//
// Pure node on purpose: no `electron` import anywhere, so scripts/unit/project-actions.test.ts can
// run it under tsx against temp folders.

import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import type { ProjectAction, ProjectActionGroup, ProjectActionLabel, ProjectInfo, ProjectKindInfo } from '../shared/events'
import { findOnPath } from './env'

/** the tools a folder's markers are useless without: a Makefile needs make, a compose file docker */
export interface Tools {
  make: boolean
  docker: boolean
}

export interface DetectOptions {
  /** `process.platform` unless a test says otherwise: it decides the venv line and the gradle wrapper's name */
  platform?: NodeJS.Platform
  /** what is on PATH; looked up once per process unless given */
  tools?: Tools
}

/** how many Makefile targets the menu takes — a build's Makefile can name fifty */
export const MAKE_TARGETS_MAX = 12
/** how many package.json scripts the menu takes; a monorepo root can hold forty */
const NODE_SCRIPTS_MAX = 30
/** a marker file bigger than this is not read (a Makefile is not a 5 MB file) */
const READ_MAX = 256 * 1024
/** folders remembered; the sidebar only ever asks about one at a time */
const CACHE_MAX = 64

/** `dir` → its answer, plus the stamp of the folder and its markers it was computed from. */
const cache = new Map<string, { stamp: string; info: ProjectInfo }>()

let toolsCache: Tools | null = null

/** `make` and `docker` on this machine's PATH, looked up once. */
function toolsOnPath(platform: NodeJS.Platform): Tools {
  if (!toolsCache) {
    const has = (name: string): boolean => findOnPath(platform === 'win32' ? `${name}.exe` : name) !== null
    toolsCache = { make: has('make'), docker: has('docker') }
  }
  return toolsCache
}

/** the files whose presence (and contents) decide the answer; the stamp is taken over these */
const MARKERS = [
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'manage.py',
  'Pipfile',
  'uv.lock',
  'poetry.lock',
  'Cargo.toml',
  'go.mod',
  'Makefile',
  'makefile',
  'GNUmakefile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
]

async function readText(dir: string, name: string): Promise<string> {
  try {
    const fh = await fsp.open(join(dir, name), 'r')
    try {
      const st = await fh.stat()
      if (st.size > READ_MAX) return ''
      return (await fh.readFile()).toString('utf8')
    } finally {
      await fh.close()
    }
  } catch {
    return ''
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isFile()
  } catch {
    return false
  }
}

/** What one detector gets: the folder, its entry names and a way to read a marker. */
interface Folder {
  dir: string
  names: Set<string>
  platform: NodeJS.Platform
  tools: Tools
  read(name: string): Promise<string>
}

/**
 * `labelKey` names a command the UI words in its language (`run.actions` in shared/i18n); a script
 * the app does not know has none, and its row shows `label` — the script's own name. `detail` is
 * what follows the label in brackets: `실행 (main.py)`, `테스트 (pytest)`.
 */
const action = (kind: string, id: string, labelKey: ProjectActionLabel | null, command: string, group: ProjectActionGroup, detail?: string): ProjectAction => ({
  id: `${kind}:${id}`,
  labelKey,
  label: id,
  command,
  group,
  ...(detail ? { detail } : {}),
})

// ---- Node -----------------------------------------------------------------------------------

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

/** the scripts everyone has, in the order the menu lists them (each worded by `run.actions[name]`), and the group each gets */
const NODE_KNOWN: { name: ProjectActionLabel; group: ProjectActionGroup }[] = [
  { name: 'dev', group: 'dev' },
  { name: 'start', group: 'dev' },
  { name: 'serve', group: 'dev' },
  { name: 'preview', group: 'dev' },
  { name: 'build', group: 'build' },
  { name: 'test', group: 'test' },
  { name: 'lint', group: 'test' },
]
const NODE_KNOWN_NAMES = new Set<string>(NODE_KNOWN.map((k) => k.name))

/** the badge's framework word: the first of these found among the dependencies wins */
const NODE_FRAMEWORKS: [string, string][] = [
  ['next', 'Next'],
  ['nuxt', 'Nuxt'],
  ['@angular/core', 'Angular'],
  ['astro', 'Astro'],
  ['@remix-run/react', 'Remix'],
  ['@sveltejs/kit', 'SvelteKit'],
  ['electron', 'Electron'],
  ['vite', 'Vite'],
  ['@nestjs/core', 'Nest'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
]

/**
 * Which runner a package.json wants: its `packageManager` field first, then whichever lockfile is
 * there, then npm.
 */
export function packageManagerOf(pkg: Record<string, unknown>, names: Set<string>): PackageManager {
  const field = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0].trim() : ''
  if (field === 'pnpm' || field === 'yarn' || field === 'bun' || field === 'npm') return field
  if (names.has('pnpm-lock.yaml')) return 'pnpm'
  if (names.has('yarn.lock')) return 'yarn'
  if (names.has('bun.lockb') || names.has('bun.lock')) return 'bun'
  return 'npm'
}

/** The line people actually type for a script under each runner. */
export function nodeCommand(pm: PackageManager, script: string): string {
  if (pm === 'npm') return script === 'start' || script === 'test' ? `npm ${script}` : `npm run ${script}`
  // `bun test` is bun's own test runner, not the script; the long form is the only safe one
  if (pm === 'bun') return `bun run ${script}`
  // pnpm and yarn run the everyday scripts by name; a script that could be one of their own
  // commands (`install`, `add`, `publish`…) keeps the long form
  return NODE_KNOWN_NAMES.has(script) ? `${pm} ${script}` : `${pm} run ${script}`
}

/**
 * What a script name may look like to be offered at all. The name is typed into a shell as it is
 * (`npm run <name>`), and a package.json is only somebody's text: a key like `x; curl … | iex` or
 * one with a line break in it would be a second command. Real script names are words, `:`, `.`,
 * `@`, `/`, `+` and `-`.
 */
export const SAFE_SCRIPT = /^[\w:.@/+-]+$/

/** `build:vite` belongs with `build`, `test:unit` with `test`; anything else is 기타 */
function nodeGroupOf(script: string): ProjectActionGroup {
  const head = script.split(':')[0]
  return NODE_KNOWN.find((k) => k.name === head)?.group ?? 'other'
}

async function detectNode(f: Folder): Promise<ProjectKindInfo | null> {
  if (!f.names.has('package.json')) return null
  let pkg: Record<string, unknown> = {}
  try {
    const v: unknown = JSON.parse(await f.read('package.json'))
    if (v && typeof v === 'object' && !Array.isArray(v)) pkg = v as Record<string, unknown>
  } catch {
    /* a broken package.json is still a Node folder: install is all we can offer */
  }
  const pm = packageManagerOf(pkg, f.names)
  const scriptsRaw = pkg.scripts && typeof pkg.scripts === 'object' ? (pkg.scripts as Record<string, unknown>) : {}
  const scripts = Object.keys(scriptsRaw).filter((s) => typeof scriptsRaw[s] === 'string' && SAFE_SCRIPT.test(s))

  const actions: ProjectAction[] = []
  for (const k of NODE_KNOWN) if (scripts.includes(k.name)) actions.push(action('node', k.name, k.name, nodeCommand(pm, k.name), k.group))
  for (const s of scripts) {
    if (NODE_KNOWN_NAMES.has(s)) continue
    if (s.startsWith('pre') || s.startsWith('post')) continue // lifecycle hooks run by themselves
    if (actions.length >= NODE_SCRIPTS_MAX) break
    actions.push(action('node', s, null, nodeCommand(pm, s), nodeGroupOf(s)))
  }
  if (!f.names.has('node_modules')) actions.push(action('node', 'install', 'install', `${pm} install`, 'install'))

  const deps = new Set<string>()
  for (const key of ['dependencies', 'devDependencies']) {
    const d = pkg[key]
    if (d && typeof d === 'object') for (const name of Object.keys(d as object)) deps.add(name)
  }
  const framework = NODE_FRAMEWORKS.find(([dep]) => deps.has(dep))?.[1]
  return { kind: 'node', badge: `Node · ${pm}${framework ? ` · ${framework}` : ''}`, actions }
}

// ---- Python ---------------------------------------------------------------------------------

const PY_MARKERS = ['pyproject.toml', 'requirements.txt', 'setup.py', 'manage.py', 'Pipfile', 'uv.lock', 'poetry.lock']

/**
 * The venv line for a plain (no uv/poetry/pipenv) project. Activating rather than calling the
 * venv's python by path: after the command ends the shell is still in the venv, which is where the
 * next thing typed wants to be. PowerShell takes a path with a separator in it without `.\`.
 */
export function venvPrefix(venv: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${venv}\\Scripts\\Activate.ps1; ` : `source ${venv}/bin/activate && `
}

async function detectPython(f: Folder): Promise<ProjectKindInfo | null> {
  if (!PY_MARKERS.some((m) => f.names.has(m))) return null
  const pyproject = f.names.has('pyproject.toml') ? await f.read('pyproject.toml') : ''
  const runner = f.names.has('uv.lock') ? 'uv' : f.names.has('poetry.lock') || /^\[tool\.poetry\]/m.test(pyproject) ? 'poetry' : f.names.has('Pipfile') ? 'pipenv' : 'plain'
  const venv = f.names.has('.venv') ? '.venv' : f.names.has('venv') ? 'venv' : null
  const win = f.platform === 'win32'
  // `python3` outside a venv on unix, where `python` may be missing or be Python 2; inside one both exist
  const py = win ? 'python' : 'python3'
  const run = runner === 'uv' ? 'uv run ' : runner === 'poetry' ? 'poetry run ' : runner === 'pipenv' ? 'pipenv run ' : venv ? venvPrefix(venv, f.platform) : ''
  const django = f.names.has('manage.py')
  const pytest = ['tests', 'test', 'pytest.ini', 'conftest.py'].some((n) => f.names.has(n)) || /^\[tool\.pytest/m.test(pyproject)

  const actions: ProjectAction[] = []
  if (django) {
    actions.push(action('python', 'runserver', 'dev', `${run}${py} manage.py runserver`, 'dev', 'runserver'))
    actions.push(action('python', 'test', 'test', pytest ? `${run}pytest` : `${run}${py} manage.py test`, 'test'))
    actions.push(action('python', 'migrate', null, `${run}${py} manage.py migrate`, 'other'))
  } else {
    const entry = ['main.py', 'app.py'].find((n) => f.names.has(n))
    if (entry) actions.push(action('python', 'run', 'run', `${run}${py} ${entry}`, 'dev', entry))
    if (pytest) actions.push(action('python', 'test', 'test', `${run}pytest`, 'test', 'pytest'))
  }
  const install =
    runner === 'uv'
      ? 'uv sync'
      : runner === 'poetry'
        ? 'poetry install'
        : runner === 'pipenv'
          ? 'pipenv install'
          : f.names.has('requirements.txt')
            ? `${run}pip install -r requirements.txt`
            : f.names.has('pyproject.toml') || f.names.has('setup.py')
              ? `${run}pip install -e .`
              : null
  if (install) actions.push(action('python', 'install', 'install', install, 'install'))

  const badge = ['Python', runner !== 'plain' ? runner : venv ? 'venv' : null, django ? 'Django' : null].filter(Boolean).join(' · ')
  return { kind: 'python', badge, actions }
}

// ---- the compiled ones ----------------------------------------------------------------------

function detectRust(f: Folder): ProjectKindInfo | null {
  if (!f.names.has('Cargo.toml')) return null
  return {
    kind: 'rust',
    badge: 'Rust',
    actions: [
      action('rust', 'run', 'run', 'cargo run', 'dev'),
      action('rust', 'build', 'build', 'cargo build', 'build'),
      action('rust', 'test', 'test', 'cargo test', 'test'),
      action('rust', 'check', 'check', 'cargo check', 'other', 'check'),
    ],
  }
}

function detectGo(f: Folder): ProjectKindInfo | null {
  if (!f.names.has('go.mod')) return null
  return {
    kind: 'go',
    badge: 'Go',
    actions: [action('go', 'run', 'run', 'go run .', 'dev'), action('go', 'build', 'build', 'go build ./...', 'build'), action('go', 'test', 'test', 'go test ./...', 'test')],
  }
}

function detectDotnet(f: Folder): ProjectKindInfo | null {
  if (![...f.names].some((n) => /\.(csproj|fsproj|vbproj|sln|slnx)$/i.test(n))) return null
  return {
    kind: 'dotnet',
    badge: '.NET',
    actions: [action('dotnet', 'run', 'run', 'dotnet run', 'dev'), action('dotnet', 'build', 'build', 'dotnet build', 'build'), action('dotnet', 'test', 'test', 'dotnet test', 'test')],
  }
}

async function detectMaven(f: Folder): Promise<ProjectKindInfo | null> {
  if (!f.names.has('pom.xml')) return null
  const pom = await f.read('pom.xml')
  const actions: ProjectAction[] = []
  if (pom.includes('spring-boot')) actions.push(action('maven', 'run', 'run', 'mvn spring-boot:run', 'dev', 'spring-boot:run'))
  actions.push(action('maven', 'package', 'package', 'mvn clean package', 'build'), action('maven', 'test', 'test', 'mvn test', 'test'))
  return { kind: 'maven', badge: 'Maven', actions }
}

async function detectGradle(f: Folder): Promise<ProjectKindInfo | null> {
  const file = ['build.gradle', 'build.gradle.kts'].find((n) => f.names.has(n))
  if (!file) return null
  const text = await f.read(file)
  // the wrapper is the project's own gradle; without it, whatever `gradle` is on PATH
  const g = f.names.has('gradlew') ? (f.platform === 'win32' ? '.\\gradlew.bat' : './gradlew') : 'gradle'
  const actions: ProjectAction[] = []
  if (text.includes('org.springframework.boot')) actions.push(action('gradle', 'bootRun', 'run', `${g} bootRun`, 'dev', 'bootRun'))
  else if (/(?:id\s*\(?\s*['"]application['"]|apply plugin:\s*['"]application['"])/.test(text)) actions.push(action('gradle', 'run', 'run', `${g} run`, 'dev'))
  actions.push(action('gradle', 'build', 'build', `${g} build`, 'build'), action('gradle', 'test', 'test', `${g} test`, 'test'))
  return { kind: 'gradle', badge: 'Gradle', actions }
}

async function detectRuby(f: Folder): Promise<ProjectKindInfo | null> {
  if (!f.names.has('Gemfile')) return null
  const rails = f.names.has('bin') && (await isFile(join(f.dir, 'bin', 'rails')))
  const actions: ProjectAction[] = []
  if (rails) actions.push(action('ruby', 'server', 'dev', 'bundle exec rails server', 'dev', 'rails server'))
  if (f.names.has('spec')) actions.push(action('ruby', 'rspec', 'test', 'bundle exec rspec', 'test', 'rspec'))
  else if (rails && f.names.has('test')) actions.push(action('ruby', 'test', 'test', 'bundle exec rails test', 'test'))
  actions.push(action('ruby', 'install', 'install', 'bundle install', 'install'))
  return { kind: 'ruby', badge: rails ? 'Ruby · Rails' : 'Ruby', actions }
}

// ---- Makefile and docker compose ------------------------------------------------------------

/**
 * The targets of a Makefile, in file order, `cap` at most: a `name:` at the start of a line that is
 * not a variable (`name := …`), not special (`.PHONY`, `.DEFAULT`), and not a pattern (`%.o: %.c`).
 */
export function makeTargets(text: string, cap = MAKE_TARGETS_MAX): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!line || line.startsWith('\t') || line.startsWith('#')) continue // a recipe line, a comment
    const m = /^([A-Za-z0-9][A-Za-z0-9_./-]*)\s*:(?!=)/.exec(line)
    if (!m) continue
    const target = m[1]
    if (target.includes('%') || out.includes(target)) continue
    out.push(target)
    if (out.length >= cap) break
  }
  return out
}

/** where a make target goes in the menu, by the names people give them */
function makeGroupOf(target: string): ProjectActionGroup {
  if (/^(run|dev|serve|start|watch)$/.test(target)) return 'dev'
  if (/^(build|all|compile|dist|release)$/.test(target)) return 'build'
  if (/^(test|tests|check|lint)$/.test(target)) return 'test'
  if (/^(install|deps|setup|bootstrap)$/.test(target)) return 'install'
  return 'other'
}

async function detectMake(f: Folder): Promise<ProjectKindInfo | null> {
  const file = ['Makefile', 'makefile', 'GNUmakefile'].find((n) => f.names.has(n))
  if (!file || !f.tools.make) return null
  const targets = makeTargets(await f.read(file))
  if (targets.length === 0) return null
  return { kind: 'make', badge: 'Make', actions: targets.map((t) => action('make', t, null, `make ${t}`, makeGroupOf(t))) }
}

function detectCompose(f: Folder): ProjectKindInfo | null {
  if (!['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].some((n) => f.names.has(n)) || !f.tools.docker) return null
  return {
    kind: 'compose',
    badge: 'Docker Compose',
    actions: [action('compose', 'up', 'up', 'docker compose up', 'dev', 'up'), action('compose', 'down', 'down', 'docker compose down', 'other', 'down')],
  }
}

// ---- the whole answer -----------------------------------------------------------------------

async function build(f: Folder): Promise<ProjectKindInfo[]> {
  const found = [
    await detectNode(f),
    await detectPython(f),
    detectRust(f),
    detectGo(f),
    detectDotnet(f),
    await detectMaven(f),
    await detectGradle(f),
    await detectRuby(f),
    await detectMake(f),
    detectCompose(f),
  ]
  return found.filter((k): k is ProjectKindInfo => k !== null && k.actions.length > 0)
}

/**
 * What `dir` is and what can be run in it. `kinds` is empty for a folder that is nothing in
 * particular — and for one that cannot be read, which the listing already reports.
 */
export async function detectProject(dir: string, opts: DetectOptions = {}): Promise<ProjectInfo> {
  const platform = opts.platform ?? process.platform
  const tools = opts.tools ?? toolsOnPath(platform)
  const none: ProjectInfo = { path: dir, kinds: [] }
  if (!dir) return none
  let names: Set<string>
  let dirMtime: number
  try {
    const st = await fsp.stat(dir)
    if (!st.isDirectory()) return none
    dirMtime = st.mtimeMs
    names = new Set(await fsp.readdir(dir))
  } catch {
    return none
  }

  // the folder's own mtime moves when an entry is added or removed (node_modules, .venv, a lockfile);
  // the markers' size:mtime when one is edited — together they say whether the last answer still holds
  const stamps = [`dir:${dirMtime}`, platform, tools.make ? 'make' : '', tools.docker ? 'docker' : '']
  for (const m of MARKERS) {
    if (!names.has(m)) continue
    try {
      const st = await fsp.stat(join(dir, m))
      stamps.push(`${m}:${st.size}:${st.mtimeMs}`)
    } catch {
      stamps.push(`${m}:?`)
    }
  }
  const stamp = stamps.join('|')
  const hit = cache.get(dir)
  if (hit && hit.stamp === stamp) return hit.info

  const folder: Folder = { dir, names, platform, tools, read: (name) => readText(dir, name) }
  const info: ProjectInfo = { path: dir, kinds: await build(folder) }
  cache.set(dir, { stamp, info })
  if (cache.size > CACHE_MAX) for (const k of [...cache.keys()].slice(0, cache.size - CACHE_MAX)) cache.delete(k)
  return info
}
