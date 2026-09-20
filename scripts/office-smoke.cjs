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
  const click = async text => { await evaluate(`Array.from(document.querySelectorAll('.office-controls button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`); await settle() }
  // The name plates are DOM now, so "did anybody move?" is just their box positions.
  const plates = () => evaluate("return Object.fromEntries(Array.from(document.querySelectorAll('.office-nameplate[data-id]')).filter(e => e.style.display !== 'none').map(e => { const r = e.getBoundingClientRect(); return [e.dataset.id, [Math.round(r.left), Math.round(r.top)]] }))")
  const mapPoints = () => evaluate("return document.querySelector('.office-minimap polygon').getAttribute('points')")
  try {
    await win.loadURL('http://127.0.0.1:5186/?studio-demo=8')
    await new Promise(r => setTimeout(r, 2200))
    assert.equal(await evaluate("return !!document.querySelector('.office-nogl')"), false, 'WebGL context could not be created')
    await evaluate(`
      const {useDesk} = await import('/store.ts'); window.testStore = useDesk;
      useDesk.setState(s => ({sessions: {...s.sessions, 'studio-preview': {...s.sessions['studio-preview'], hamsters: Object.fromEntries(Object.entries(s.sessions['studio-preview'].hamsters).map(([id,h],i) => [id,{...h,name:'동료'+i,state:'idle',bubble:null}]))}}}));
    `)
    await settle()
    await shot('studio-default')
    // The studio opens on the main hamster, which sits in the north-west corner the camera looks
    // towards — so most desks start behind it. Frame a desk in the far row (same 250%) to get a
    // roomful of name plates to compare positions against.
    await evaluate(`const select=document.querySelector('.office-follow select');select.value='studio-6';select.dispatchEvent(new Event('change',{bubbles:true}));`)
    await settle()
    const before = await plates()
    assert.ok(Object.keys(before).length >= 4, `expected visible occupied desks, got ${JSON.stringify(before)}`)
    const art = await evaluate(`
      const {buildHamster} = await import('/desk/vox/hamster.ts');
      const {voxMaterial} = await import('/desk/vox/material.ts');
      const {modelSkin} = await import('/desk/skins.ts');
      const rig = buildHamster({skin: modelSkin('claude-opus-5'), tint: '#c98a45', main: true}, voxMaterial({localDetail: true}));
      const legGeo = rig.legs.map(l => l.children[0].geometry);
      return {parts: rig.group.children.length, head: rig.headG.children.length, legs: rig.legs.length, sharedLegs: legGeo.every(g => g === legGeo[0]), headY: rig.headY};
    `)
    assert.equal(art.legs, 4, 'the rig needs two arms and two legs')
    assert.ok(art.parts >= 7, 'the rig needs a body, scarf, head, four limbs and a tail')
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
    assert.deepEqual(await plates(), afterRemove, 'seated hamsters kept walking')
    await click('지도')
    const mapBefore = await mapPoints()
    win.webContents.sendInputEvent({ type: 'mouseDown', x: 400, y: 240, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 440, y: 265, button: 'left' })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: 440, y: 265, button: 'left', clickCount: 1 })
    await settle()
    assert.notEqual(await mapPoints(), mapBefore, 'drag did not pan')
    const mapAfterDrag = await mapPoints()
    await evaluate("const svg=document.querySelector('.office-minimap svg'),r=svg.getBoundingClientRect();svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width*.6,clientY:r.top+r.height*.6}))")
    await settle()
    assert.notEqual(await mapPoints(), mapAfterDrag, 'map click did not navigate')
    await click('+')
    assert.equal(await evaluate("return document.querySelector('.office-zoom').textContent"), '313%')
    assert.notEqual(await mapPoints(), mapBefore)
    assert.equal(await evaluate("return document.querySelector('.desk-studio').classList.contains('is-dragging')"), false)
    await click('−')
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
    await evaluate('window.testStore.setState(s=>({prefs:{...s.prefs,folded:true}}))')
    await settle()
    await evaluate('window.testStore.setState(s=>({prefs:{...s.prefs,folded:false}}))')
    await settle()
    await click('지도')
    await settle()
    assert.equal(await mapPoints(), cameraBeforeSwitch, 'folding lost the camera')
    await click('⌂')
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
    await evaluate('window.testStore.setState({sessions:{},activeTab:null})')
    await settle()
    assert.ok(await evaluate("return document.querySelector('.office-welcome').textContent.includes('자리는 준비되어 있어요')"))
    assert.deepEqual(errors, [])
    fs.writeFileSync(path.resolve('work/office-smoke-result.json'),JSON.stringify({passed:true,checks:['webgl context','voxel hamster rig','add/remove/reorder stability','stationary animation','drag pan','minimap click','zoom','wheel','overview','locate agent','session camera isolation','fold camera persistence','compact viewport','48-agent overflow','empty office','no renderer errors'],art},null,2))
    console.log('PASS: renderer, voxel rig, occupancy changes, navigation, session switches, folding, compact layout')
  } catch(e) { console.error(e); process.exitCode=1 }
  finally { win.destroy(); app.quit() }
})
