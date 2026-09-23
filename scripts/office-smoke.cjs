// Run with Electron against the local renderer preview. No preload, PTYs or real session watchers.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
app.commandLine.appendSwitch('disable-gpu')
// Chromium 129+ refuses software WebGL unless it is asked for explicitly; without this the
// studio cannot create a context at all on a headless box and every 3D check is meaningless.
app.commandLine.appendSwitch('enable-unsafe-swiftshader')
// Own profile, like the smoke run of the app itself: the dev window or the portable exe may be
// open, and sharing %APPDATA%\hamster-desk* means whoever starts second cannot lock the caches.
const profile = path.join(app.getPath('temp'), 'hamster-desk-smoke')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 880, show: false, webPreferences: { offscreen: true, contextIsolation: true, sandbox: true } })
  const errors = []
  fs.mkdirSync(path.resolve('work'), { recursive: true })
  win.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message) })
  const evaluate = code => win.webContents.executeJavaScript(`(async () => { ${code} })()`)
  const settle = () => evaluate('await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
  const shot = async name => fs.writeFileSync(path.resolve(`work/${name}.png`), (await win.webContents.capturePage()).toPNG())
  // icon-only buttons (⌂ + −) carry no text, so match the aria-label first and the label second
  const click = async name => { await evaluate(`Array.from(document.querySelectorAll('.office-controls button')).find(b => b.getAttribute('aria-label') === ${JSON.stringify(name)} || b.textContent.trim() === ${JSON.stringify(name)}).click()`); await settle() }
  // The name plates are DOM now, so "did anybody move?" is just their box positions.
  const plates = () => evaluate("return Object.fromEntries(Array.from(document.querySelectorAll('.office-nameplate[data-id]')).filter(e => e.style.display !== 'none').map(e => { const r = e.getBoundingClientRect(); return [e.dataset.id, [Math.round(r.left), Math.round(r.top)]] }))")
  const mapPoints = () => evaluate("return document.querySelector('.office-minimap polygon').getAttribute('points')")
  try {
    await win.loadURL('http://127.0.0.1:5186/?studio-demo=8')
    await new Promise(r => setTimeout(r, 2200))
    assert.equal(await evaluate("return !!document.querySelector('.office-nogl')"), false, 'WebGL context could not be created')
    await evaluate(`
      const {useDesk} = await import('/store.ts'); window.testStore = useDesk;
      useDesk.setState(s => ({sessions: {...s.sessions, 'studio-preview': {...s.sessions['studio-preview'], hamsters: Object.fromEntries(Object.entries(s.sessions['studio-preview'].hamsters).map(([id,h],i) => [id,{...h,name:'동료'+i,state:'idle',feed:[]}]))}}}));
    `)
    await settle()
    await shot('studio-default')
    // The studio opens on the auto-framed room. Frame the desk in the middle of the second staff
    // row (studio-4, at 250%) to get a roomful of name plates to compare positions against.
    await evaluate(`const select=document.querySelector('.office-follow select');select.value='studio-4';select.dispatchEvent(new Event('change',{bubbles:true}));`)
    await settle()
    // The feed is a chat log: rows stack up, identical rows merge into one with a ×N badge, and
    // everything times out on its own. The camera is on studio-4 at 250%, so its feed is visible.
    // (The life spans are shortened first, so the expiry case does not cost nine seconds.)
    assert.equal(await evaluate("return document.querySelector('.office-controls button[aria-pressed]').getAttribute('aria-pressed')"), 'false', 'locating a colleague must switch automatic framing off')
    await evaluate("window.__studio.feedLife({ act: 500, say: 4000 })")
    // How many rows a feed shows depends on the zoom (`feedLines`): 2 rows need 110%, 3 need 150%.
    // The follow menu put the camera at 250%, which carries the whole stack — assert that rather
    // than trust it, because every count below is a count of *visible* rows.
    const lines = await evaluate("const {feedLines} = await import('/desk/office-camera.ts'); return feedLines(parseInt(document.querySelector('.office-zoom').textContent) / 100)")
    assert.ok(lines >= 2, `the bubble cases need a zoom showing at least two rows, got ${lines}`)
    const feedOf = id => evaluate(`
      const box = document.querySelector('.office-feed[data-hid=' + JSON.stringify(${JSON.stringify(id)}) + ']');
      const rows = box ? Array.from(box.children).filter(r => getComputedStyle(r).display !== 'none') : [];
      return { count: rows.length, texts: rows.map(r => r.querySelector('.ob-text').textContent), badges: rows.map(r => (r.querySelector('.ob-count') || {}).textContent || null), opacity: box ? getComputedStyle(box).opacity : null };
    `)
    // (a) two different sentences stack, newest at the bottom (nearest the head)
    await evaluate("window.__studio.say('studio-4', '첫 번째 문장입니다')")
    await new Promise(r => setTimeout(r, 300))
    await evaluate("window.__studio.say('studio-4', '두 번째 문장이 아래에 쌓여야 해요')")
    await settle()
    const stacked = await feedOf('studio-4')
    assert.equal(stacked.count, 2, `two sentences should stack: ${JSON.stringify(stacked)}`)
    assert.deepEqual(stacked.texts, ['첫 번째 문장입니다', '두 번째 문장이 아래에 쌓여야 해요'], 'the newest sentence must be the last row')
    assert.equal(stacked.opacity, '1', `the feed stayed hidden (opacity ${stacked.opacity})`)
    // (b) the same activity three times is one row with a ×3 badge
    for (let i = 0; i < 3; i++) await evaluate("window.__studio.act('studio-4', 'npm run build')")
    await settle()
    const merged = await feedOf('studio-4')
    assert.equal(merged.count, 3, `the repeated activity must merge into one row: ${JSON.stringify(merged)}`)
    assert.equal(merged.badges[2], '×3', `expected a ×3 badge on the merged row: ${JSON.stringify(merged)}`)
    // (c) a row disappears on its own once its life is up — no ✓ to press
    await new Promise(r => setTimeout(r, 1400))
    const aged = await feedOf('studio-4')
    assert.ok(!aged.texts.some(t => t.includes('npm run build')), `the activity row outlived its life: ${JSON.stringify(aged)}`)
    assert.equal(aged.count, 2, `only the two sentences should be left: ${JSON.stringify(aged)}`)
    // right-clicking a row drops just that row (a click opens it in the bubble log instead)
    await evaluate("Array.from(document.querySelectorAll('.ob-item')).find(e => e.querySelector('.ob-text').textContent === '첫 번째 문장입니다').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))")
    await settle()
    const clicked = await feedOf('studio-4')
    assert.equal(clicked.count, 1, `a right-click should drop one row only: ${JSON.stringify(clicked)}`)
    assert.deepEqual(clicked.texts, ['두 번째 문장이 아래에 쌓여야 해요'])
    await evaluate("window.__studio.feedLife({ act: 3000, say: 9000 })")
    // The speech-bubble log: bubbles expire, the log does not. Two sentences and one activity
    // repeated three times must read as three rows with a ×3 badge, and clicking the newest row
    // has to point the camera at whoever said it.
    await evaluate("window.testStore.setState(s => ({ prefs: { ...s.prefs, showSidebar: true, showFeedLog: true } }))")
    // the cases above already left rows in it (that is the point of the log); start from empty so
    // the counts below are about these five pushes and nothing else
    await evaluate("const store = window.testStore, s = store.getState().sessions['studio-preview']; store.setState({ sessions: { ...store.getState().sessions, 'studio-preview': { ...s, log: [] } } })")
    await evaluate("window.__studio.say('studio-4', '로그에 남을 첫 문장')")
    await evaluate("window.__studio.say('studio-4', '로그에 남을 두 번째 문장')")
    for (let i = 0; i < 3; i++) await evaluate("window.__studio.act('studio-4', 'npm run test:office')")
    await settle()
    const log = await evaluate("const rows = Array.from(document.querySelectorAll('.log-row')); return { count: rows.length, first: rows[0] ? rows[0].querySelector('.log-text').textContent : null, badges: rows.map(r => (r.querySelector('.log-n') || {}).textContent || null) }")
    assert.equal(log.count, 3, `the log should keep three rows: ${JSON.stringify(log)}`)
    assert.ok(log.badges.includes('×3'), `the repeated activity needs a ×3 badge in the log: ${JSON.stringify(log)}`)
    await evaluate("document.querySelector('.log-row').click()")
    await settle()
    assert.ok(await evaluate(`return !!document.querySelector('.office-nameplate.is-selected[data-id="studio-4"]')`), 'clicking a log row must select that hamster in the studio')
    await shot('studio-log')
    await evaluate("window.testStore.setState(s => ({ prefs: { ...s.prefs, showSidebar: false } }))")
    await settle()
    await evaluate(`
      const store = window.testStore, s = store.getState().sessions['studio-preview'];
      store.setState({ sessions: { ...store.getState().sessions, 'studio-preview': { ...s, hamsters: Object.fromEntries(Object.entries(s.hamsters).map(([id, h]) => [id, { ...h, feed: [] }])) } } });
    `)
    await settle()
    const before = await plates()
    assert.ok(Object.keys(before).length >= 4, `expected visible occupied desks, got ${JSON.stringify(before)}`)
    const art = await evaluate(`
      const {buildHamster} = await import('/desk/vox/hamster.ts');
      const {voxMaterial} = await import('/desk/vox/material.ts');
      const {modelSkin} = await import('/desk/skins.ts');
      const rig = buildHamster({skin: modelSkin('claude-opus-5'), tint: '#c98a45', main: true}, voxMaterial({localDetail: true}));
      const legGeo = rig.legs.map(l => l.children[0].geometry);
      return {parts: rig.group.children.length, head: rig.headG.children.length, legs: rig.legs.length, sharedLegs: legGeo.every(g => g === legGeo[0]), headY: rig.headY, tie: !!rig.tieG && !('scarfG' in rig)};
    `)
    assert.equal(art.legs, 4, 'the rig needs two arms and two legs')
    assert.ok(art.parts >= 8, 'the rig needs a body, tie, head, four limbs and a tail')
    assert.equal(art.tie, true, 'the rig carries a tie group (no scarf)')
    assert.ok(art.head >= 2, 'the Opus skin wears glasses')
    assert.equal(art.sharedLegs, true, 'limbs must share one geometry')
    const deskCount = await evaluate(`const {OFFICE}=await import('/desk/office-world.ts'); return OFFICE.slots.length`)
    await evaluate(`
      const store=window.testStore;const s=store.getState().sessions['studio-preview'];
      const extras=Object.fromEntries(Array.from({length:20},(_,i)=>['extra-'+i,{...s.hamsters.main,id:'extra-'+i,name:'추가'+i,state:'idle'}]));
      store.setState({sessions:{...store.getState().sessions,'studio-preview':{...s,hamsters:{...s.hamsters,...extras},order:[...s.order,...Object.keys(extras)]}}});
    `)
    await settle()
    const afterAdd = await plates()
    for (const [id, pos] of Object.entries(before)) assert.deepEqual(afterAdd[id], pos, `add moved ${id}`)
    await evaluate(`const store=window.testStore,s=store.getState().sessions['studio-preview'];const hamsters={...s.hamsters};delete hamsters['studio-0'];store.setState({sessions:{...store.getState().sessions,'studio-preview':{...s,hamsters,order:s.order.filter(id=>id!=='studio-0').reverse()}}});`)
    await settle()
    const afterRemove = await plates()
    for (const [id, pos] of Object.entries(before)) if (id !== 'studio-0') assert.deepEqual(afterRemove[id], pos, `remove/reorder moved ${id}`)
    await new Promise(r => setTimeout(r, 500))
    // (the ones without a desk are another matter: the reversed order put five others at the head
    // of the queue by the door, and they walk in for it — only the seated ones must stay put)
    const later = await plates()
    for (const id of Object.keys(before)) if (id in afterRemove) assert.deepEqual(later[id], afterRemove[id], `seated ${id} kept walking`)
    await click('지도')
    const mapBefore = await mapPoints()
    // the middle button pans (the left one only takes hold of hamsters and prints)
    win.webContents.sendInputEvent({ type: 'mouseDown', x: 400, y: 240, button: 'middle', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 440, y: 265, button: 'middle' })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 440, y: 265, button: 'middle', clickCount: 1 })
    await settle()
    assert.notEqual(await mapPoints(), mapBefore, 'drag did not pan')
    const mapAfterDrag = await mapPoints()
    await evaluate("const svg=document.querySelector('.office-minimap svg'),r=svg.getBoundingClientRect();svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width*.6,clientY:r.top+r.height*.6}))")
    await settle()
    assert.notEqual(await mapPoints(), mapAfterDrag, 'map click did not navigate')
    await click('확대')
    assert.equal(await evaluate("return document.querySelector('.office-zoom').textContent"), '313%')
    assert.notEqual(await mapPoints(), mapBefore)
    assert.equal(await evaluate("return document.querySelector('.desk-studio').classList.contains('is-dragging')"), false)
    await click('축소')
    await evaluate(`const el=document.querySelector('.desk-studio'),r=el.getBoundingClientRect();el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100,clientX:r.left+200,clientY:r.top+200}));`)
    await settle()
    assert.notEqual(await evaluate("return document.querySelector('.office-zoom').textContent"), '250%')
    await click('전체 보기')
    const overview = await evaluate("return document.querySelector('.office-zoom').textContent")
    assert.ok(parseInt(overview) < 250, 'overview should zoom out from the 250% focus view')
    await shot('studio-overview')
    await evaluate(`const select=document.querySelector('.office-follow select');select.value='studio-2';select.dispatchEvent(new Event('change',{bubbles:true}));`)
    await settle()
    assert.equal(await evaluate("return document.querySelector('.office-zoom').textContent"), '250%')
    const cameraBeforeSwitch = await mapPoints()
    await evaluate(`const store=window.testStore,s=store.getState().sessions['studio-preview'];store.setState({sessions:{...store.getState().sessions,other:{...s,info:{...s.info,sessionId:'other'},order:['main'],hamsters:{main:{...s.hamsters.main,sessionId:'other'}}}},activeTab:'session:other'});`)
    await settle()
    await click('전체 보기')
    await evaluate("window.testStore.setState({activeTab:'session:studio-preview'})")
    await settle()
    assert.equal(await mapPoints(), cameraBeforeSwitch, 'switching sessions moved the other camera')
    // Folding blows the studio up first (src/desk/fold.ts): it stays mounted for the four-second
    // blast, folds away after it, and unfolding raises it again through the construction. The
    // camera has to come through all of it untouched.
    await evaluate('window.testStore.setState(s=>({prefs:{...s.prefs,folded:true}}))')
    await settle()
    assert.ok(await evaluate("return !!document.querySelector('.desk-studio')"), 'the studio should stay up for the blast')
    await new Promise(r=>setTimeout(r,5600))
    assert.equal(await evaluate("return !!document.querySelector('.desk-studio')"), false, 'the studio should be folded away once the blast is over')
    await evaluate('window.testStore.setState(s=>({prefs:{...s.prefs,folded:false}}))')
    await settle()
    assert.ok(await evaluate("return !!document.querySelector('.desk-studio')"), 'unfolding should mount the studio at once')
    await new Promise(r=>setTimeout(r,5200))
    await click('지도')
    await settle()
    assert.equal(await mapPoints(), cameraBeforeSwitch, 'folding lost the camera')
    await click('메인 햄스터로 이동')
    await click('지도')
    await evaluate('window.testStore.setState(s=>({prefs:{...s.prefs,deskH:320}}))')
    win.setSize(800, 600)
    await new Promise(r=>setTimeout(r,400))
    await shot('studio-compact')
    assert.equal(await evaluate('return document.documentElement.scrollWidth > innerWidth'), false)
    const bounds=await evaluate("const a=document.querySelector('.office-controls').getBoundingClientRect(),b=document.querySelector('.desk-studio').getBoundingClientRect();return {left:a.left>=b.left,right:a.right<=b.right,bottom:a.bottom<=b.bottom}")
    assert.deepEqual(bounds,{left:true,right:true,bottom:true})
    await evaluate(`const store=window.testStore,s=store.getState().sessions['studio-preview'];const extras=Object.fromEntries(Array.from({length:47},(_,i)=>['full-'+i,{...s.hamsters.main,id:'full-'+i,name:'만석'+i}]));store.setState({sessions:{'studio-preview':{...s,hamsters:{main:s.hamsters.main,...extras},order:['main',...Object.keys(extras)]}}});`)
    await settle()
    assert.equal(await evaluate("return document.querySelector('.office-overflow').textContent"), `${48 - deskCount}마리 빈자리 대기`)
    assert.equal(await evaluate("return document.querySelector('.office-occupancy').textContent"), `동료 ${deskCount - 1} / ${deskCount - 1}`, 'occupancy counts colleagues only, without the boss')
    await evaluate('window.testStore.setState({sessions:{},activeTab:null})')
    await settle()
    assert.ok(await evaluate("return document.querySelector('.office-welcome').textContent.includes('자리는 준비되어 있어요')"))
    assert.deepEqual(errors, [])
    fs.writeFileSync(path.resolve('work/office-smoke-result.json'),JSON.stringify({passed:true,checks:['webgl context','voxel hamster rig','feed stacking, merging, expiry, click-to-dismiss and the zoom row budget','speech-bubble log rows, merge badge and click-to-focus','add/remove/reorder stability','stationary animation','drag pan','minimap click','zoom','wheel','overview','locate agent','session camera isolation','fold camera persistence','compact viewport','48-agent overflow','empty office','no renderer errors'],art},null,2))
    console.log('PASS: renderer, voxel rig, chat feed (stack/merge/expiry/dismiss), speech-bubble log, occupancy changes, navigation, session switches, folding, compact layout')
  } catch(e) { console.error(e); process.exitCode=1 }
  finally { win.destroy(); app.quit() }
})
