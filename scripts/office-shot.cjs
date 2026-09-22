// Visual review shots. Same setup as office-smoke.cjs (offscreen Electron against the local
// renderer preview), but it only drives the camera and the hamsters and saves PNGs — no asserts.
// The scenes are the ones that are hard to judge from the default view: the seated pose from
// three sides, one desk per state, a hamster walking in through the door, and the automatic
// framing with a full room versus a lone main hamster.
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
    // STUDIO_URL: a preview on another port (`npx vite --config scripts/vite.studio.mjs --port 5187`)
    await win.loadURL(process.env.STUDIO_URL || 'http://127.0.0.1:5186/?studio-demo=8')
    await wait(2400)
    if (!(await evaluate('return !!window.__studio'))) throw new Error('window.__studio missing — is this the ?studio-demo preview?')
    if (await evaluate("return !!document.querySelector('.office-nogl')")) throw new Error('WebGL context could not be created')
    // the boss stays at its desk for every scene but the last: with seven colleagues working it
    // would otherwise get up for its rounds in the middle of the framing shots
    await studio("patrol('off')")

    // 1. the boss's desk at 250% — where ⌂ lands when only the main hamster is in
    await studio("focus('main')")
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

    // 8. automatic framing: ⌂ turns it on; with nine hamsters in the room it eases out until
    // every occupied desk is in view, and with only the main hamster it eases back to its desk
    await evaluate("document.querySelector('.office-controls button[aria-label=\"메인 햄스터로 이동\"]').click()")
    await wait(1800)
    await shot('autoframe-8', 0)
    // four hamsters: the main plus the three agents seated nearest the boss — a tight frame
    const keep = ids => evaluate(`
      const { useDesk } = await import('/store.ts');
      const st = useDesk.getState(), s = st.sessions['studio-preview'];
      const ids = ${JSON.stringify(ids)};
      useDesk.setState({ sessions: { ...st.sessions, 'studio-preview': { ...s, hamsters: Object.fromEntries(ids.map(id => [id, s.hamsters[id]])), order: ids } } });
    `)
    const clearFeeds = () => evaluate(`
      const { useDesk } = await import('/store.ts');
      const st = useDesk.getState(), s = st.sessions['studio-preview'];
      useDesk.setState({ sessions: { ...st.sessions, 'studio-preview': { ...s, hamsters: Object.fromEntries(Object.entries(s.hamsters).map(([id, h]) => [id, { ...h, feed: [] }])) } } });
    `)
    await keep(['main', 'studio-0', 'studio-1', 'studio-2'])
    // the row budget in action: at this framing `feedLines` allows two rows per hamster, and the
    // camera reserved exactly two rows' worth of sky for them
    await studio('feedLife({ act: 60000, say: 60000, warn: 60000 })')
    await studio("say('main', '\uc774 \ubd80\ubd84\uc740 \uc6cc\ucee4 \ucabd\uc5d0\uc11c \ucc98\ub9ac\ud560\uac8c\uc694')")
    await studio("act('main', 'src/store.ts')")
    await studio("say('studio-1', '\uc88c\uc11d \ubc30\uc815\ubd80\ud130 \ubcfc\uac8c\uc694')")
    await studio("act('studio-2', 'npm run build')")
    await wait(1800)
    await shot('autoframe-4', 0)
    await clearFeeds()
    await keep(['main'])
    await wait(1800)
    await shot('autoframe-1', 0)

    // 9. the chat feed, in the framing it actually gets: the lone main hamster at the automatic
    // close-up, which leaves the top of the frame clear for the stack. Rows come in at the bottom,
    // nearest the head, and push the older ones up; the repeated activity merges into one `×3`.
    // Lives are still stretched, so nothing ages out between the pushes and the capture.
    await studio('feedLife({ act: 60000, say: 60000, warn: 60000 })')
    await studio("say('main', '이 부분은 워커 쪽에서 처리하는 게 맞겠어요')")
    await wait(200)
    await studio("act('main', 'src/store.ts')")
    await wait(150)
    await studio("say('main', '테스트부터 돌려볼게요')")
    await wait(150)
    for (let i = 0; i < 3; i++) {
      await studio("act('main', 'npm run test:office')")
      await wait(120)
    }
    await shot('feed', 400)

    // 10. the same four rows at the app's default desk height and at the tallest one it allows.
    // The automatic framing measures where the ear tips land rather than dropping the ground by a
    // fixed number of pixels, so the whole stack has to clear the header band in both.
    const deskHeight = px => evaluate(`
      const { useDesk } = await import('/store.ts');
      useDesk.setState(s => ({ prefs: { ...s.prefs, deskH: ${px} } }));
    `)
    await deskHeight(420)
    await wait(1800)
    await shot('feed-420', 400)
    await deskHeight(700)
    await wait(1800)
    await shot('feed-700', 400)
    await deskHeight(520)

    // 11. the boss's rounds (src/desk/patrol.ts). Two colleagues walk in and sit; `hurry` then
    // gets the boss up at once, on fixed dice. Caught on the way — round its own desk and down
    // the lane past the plant, the anger mark over its head — then standing beside and behind the
    // colleague it picked, with the sweat mark and the flinch. Nothing is said: the colleague's
    // own rows stay exactly as they were.
    await clearFeeds()
    await studio("addArriving('patrol-0', 'claude-haiku-4-5', 'Explore')")
    await studio("addArriving('patrol-1', 'claude-opus-5', 'Plan')")
    await studio("say('patrol-1', '좌석 배정부터 볼게요')")
    await wait(3600) // through the door and into the chairs
    await studio("patrol('hurry')")
    await wait(900)
    await shot('patrol-walk', 0)
    await wait(2200) // the rest of the walk; the telling-off has just begun
    await shot('patrol-scold', 0)
    await studio("patrol('off')")
    await studio('feedLife({ act: 3000, say: 9000, warn: 12000 })')

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
