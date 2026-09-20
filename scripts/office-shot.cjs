// Visual review shots. Same setup as office-smoke.cjs (offscreen Electron against the local
// renderer preview), but it only drives the camera and the hamsters and saves PNGs — no asserts.
// The scenes are the ones that are hard to judge from the default view: the seated pose from
// three sides, one desk per state, and a hamster walking in through the door.
//
//   npm run preview:studio     # in another terminal
//   npm run shot:studio        # → work/shot-*.png
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('enable-unsafe-swiftshader')
// Own profile, like the smoke run: the dev window or the portable exe may be open, and sharing
// %APPDATA%\hamster-desk* means whoever starts second cannot lock the caches.
const profile = path.join(app.getPath('temp'), 'hamster-desk-smoke')
app.setPath('userData', profile)
app.setPath('sessionData', profile)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 880, show: false, webPreferences: { offscreen: true, contextIsolation: true, sandbox: true } })
  const errors = []
  const saved = []
  fs.mkdirSync(path.resolve('work'), { recursive: true })
  win.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message) })
  const evaluate = code => win.webContents.executeJavaScript(`(async () => { ${code} })()`)
  const settle = () => evaluate('await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const shot = async (name, hold = 250) => {
    await settle()
    await wait(hold)
    await settle()
    const file = path.resolve(`work/shot-${name}.png`)
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    saved.push(file)
    console.log('  ' + file)
  }
  const studio = expr => evaluate(`window.__studio.${expr}`)

  try {
    await win.loadURL('http://127.0.0.1:5186/?studio-demo=8')
    await wait(2400)
    if (!(await evaluate('return !!window.__studio'))) throw new Error('window.__studio missing — is this the ?studio-demo preview?')
    if (await evaluate("return !!document.querySelector('.office-nogl')")) throw new Error('WebGL context could not be created')

    // 1. the view the studio opens on: the main hamster's desk
    await shot('main-focus')

    // 2..4. the seated pose from the front, the back and the side
    await studio("focus('main')")
    await studio('zoom(4)')
    await shot('main-400')
    await studio('orbit(Math.PI, 0)')
    await shot('back-view')
    // the side view also tips down a little: at the default pitch the desk's end panel hides the
    // one thing this shot is for, namely the folded legs lying on the chair seat
    await studio('orbit(-Math.PI / 2, 0.25)')
    await shot('side-view')
    await studio('orbit(-Math.PI / 2, -0.25)') // back to the default south-east angle for the rest

    // 5. one desk per state: poses, glyphs, screen colour, blinking keys, status lamps
    await evaluate(`
      const now = Date.now();
      window.__studio.setStates({
        main: { state: 'writing' },
        'studio-0': { state: 'reading' },
        'studio-1': { state: 'thinking' },
        'studio-2': { state: 'hiring' },
        'studio-3': { state: 'talking' },
        'studio-4': { state: 'waiting' },
        'studio-5': { state: 'running' },
        'studio-6': { state: 'idle', since: now - 120000 },
      });
    `)
    await studio('focus({ i: 7, j: 5 }, 3)')
    await shot('states-300', 400)

    // 6. A new colleague walking in from the door, caught mid-stride. The camera looks down the
    // corridor rather than at the door itself: the first free desk is in the third row, so a
    // door-level framing has the walker pass beside the camera instead of across the frame.
    await studio('focus({ i: 2, j: 9.5 }, 2.2)')
    await settle()
    await studio("addArriving('shot-walker', 'claude-sonnet-5', 'Explore')")
    await wait(700)
    await shot('walk-a', 0)
    await wait(800)
    await shot('walk-b', 0)

    // 7. the whole island
    await evaluate("Array.from(document.querySelectorAll('.office-controls button')).find(b => b.textContent === '전체 보기').click()")
    await shot('overview', 400)

    if (errors.length) {
      console.error('renderer errors:')
      for (const e of errors) console.error('  ' + e)
      process.exitCode = 1
    } else {
      console.log(`OK: ${saved.length} shots`)
    }
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  } finally {
    win.destroy()
    app.quit()
  }
})
