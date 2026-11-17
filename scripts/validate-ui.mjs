import assert from 'node:assert/strict';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sitePort = process.env.PLANHAUS_SITE_PORT || '4175';
const debugPort = process.env.PLANHAUS_DEBUG_PORT || '9223';
const siteUrl = `http://127.0.0.1:${sitePort}/`;
const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?${siteUrl}`, { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', event => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
  if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) errors.push(msg.params.entry.text);
});

function cdp(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function navigate(url = siteUrl) {
  await cdp('Page.navigate', { url });
  await sleep(350);
}

async function point(x, y) {
  return evaluate(`(() => { const svg=document.querySelector('#planCanvas'); const p=svg.createSVGPoint(); p.x=${x}; p.y=${y}; const q=p.matrixTransform(svg.getScreenCTM()); return {x:q.x,y:q.y}; })()`);
}

async function mouse(type, p, button = 'left', buttons = type === 'mouseMoved' ? 1 : undefined) {
  const mask = button === 'right' ? 2 : button === 'middle' ? 4 : 1;
  const activeButtons = buttons ?? (type === 'mousePressed' ? mask : 0);
  await cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button, clickCount: 1, buttons: activeButtons });
}

async function drag(a, b) {
  await mouse('mousePressed', a);
  await mouse('mouseMoved', b, 'left', 1);
  await mouse('mouseReleased', b);
  await sleep(80);
}

async function click(p, button = 'left') {
  await mouse('mousePressed', p, button);
  await mouse('mouseReleased', p, button);
  await sleep(80);
}

async function contextmenu(p) {
  await evaluate(`(() => { const target=document.elementFromPoint(${p.x}, ${p.y}); if (!target) return false; return target.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true,button:2,clientX:${p.x},clientY:${p.y}})); })()`);
  await sleep(80);
}

async function drawing() {
  return evaluate(`JSON.parse(localStorage.getItem('planhaus-project'))`);
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Log.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await navigate();

const seeded = {
  project: '互動驗證',
  items: [{ id: 'room-test', type: 'room', x: 200, y: 200, w: 600, h: 400, name: '測試房間', color: '#e9e3d5' }]
};
await evaluate(`localStorage.setItem('planhaus-project', ${JSON.stringify(JSON.stringify(seeded))}); location.reload(); true`);
await sleep(350);

const base = await evaluate(`(() => ({
  title: document.title,
  roomStroke: document.querySelector('.plan-room') ? getComputedStyle(document.querySelector('.plan-room')).strokeWidth : null,
  minFont: document.querySelector('.tool') ? getComputedStyle(document.querySelector('.tool')).fontSize : null,
  svgReady: !!document.querySelector('#planCanvas')
}))()`);
if (!base.roomStroke) throw new Error(`Room failed to render: ${JSON.stringify({ base, errors, saved: await drawing() })}`);
assert.equal(base.svgReady, true);
assert.equal(base.roomStroke, '6px');
assert.equal(base.minFont, '16px');

await evaluate(`document.querySelector('[data-tool="door"]').click()`);
await drag(await point(400, 200), await point(400, 280));
let state = await drawing();
let doors = state.items.filter(i => i.type === 'door');
assert.equal(doors.length, 1);
assert.equal(doors[0].swing, 'in');
assert.equal(doors[0].wallRef?.id, 'room-test');

await drag(await point(300, 200), await point(300, 120));
state = await drawing();
doors = state.items.filter(i => i.type === 'door');
assert.equal(doors.length, 2);
assert.equal(doors[1].swing, 'out');

const openingMarkup = await evaluate(`(() => { const g=document.querySelector('[data-id="${doors[0].id}"]'); return {cut:!!g?.querySelector('.plan-opening-cut'), hit:!!g?.querySelector('.opening-hit')}; })()`);
assert.deepEqual(openingMarkup, { cut: true, hit: true });

await evaluate(`document.querySelector('[data-tool="select"]').click()`);
await drag(await point(400, 200), await point(520, 200));
state = await drawing();
let movedDoor = state.items.find(i => i.id === doors[0].id);
assert.ok(Math.abs(movedDoor.x - 520) <= 2, `door x=${movedDoor.x}`);
assert.equal(movedDoor.wallRef?.id, 'room-test');

await contextmenu(await point(movedDoor.x, movedDoor.y));
state = await drawing();
movedDoor = state.items.find(i => i.id === doors[0].id);
assert.equal(movedDoor.swing, 'out');

await evaluate(`document.querySelector('[data-opening="fixed"]').click()`);
await click(await point(660, 200));
state = await drawing();
let win = state.items.find(i => i.type === 'window');
assert.ok(win);
await evaluate(`document.querySelector('[data-tool="select"]').click()`);
await contextmenu(await point(win.x, win.y));
state = await drawing();
win = state.items.find(i => i.id === win.id);
assert.equal(win.flipped, true);

await evaluate(`document.querySelector('[data-tool="furniture"]').click(); document.querySelector('[data-furniture="sofa"]').click()`);
await click(await point(500, 420));
state = await drawing();
let sofa = state.items.find(i => i.type === 'furniture' && i.name === 'sofa');
assert.ok(sofa);
await evaluate(`document.querySelector('[data-tool="select"]').click()`);
await contextmenu(await point(sofa.x, sofa.y));
state = await drawing();
sofa = state.items.find(i => i.id === sofa.id);
assert.equal(sofa.rotation, 90);

const zoomPoint = await point(700, 500);
const zoomAnchorBefore = await evaluate(`window.Planhaus.screenToPlan(${zoomPoint.x}, ${zoomPoint.y})`);
await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: zoomPoint.x, y: zoomPoint.y, deltaX: 0, deltaY: -120 });
await sleep(80);
const zoomAnchorAfter = await evaluate(`window.Planhaus.screenToPlan(${zoomPoint.x}, ${zoomPoint.y})`);
assert.ok(Math.abs(zoomAnchorAfter.x - zoomAnchorBefore.x) < 0.5);
assert.ok(Math.abs(zoomAnchorAfter.y - zoomAnchorBefore.y) < 0.5);

const middleBefore = await evaluate(`document.querySelector('#planCanvas').getAttribute('viewBox')`);
const middleStart = await point(900, 650), middleEnd = { x: middleStart.x + 60, y: middleStart.y + 30 };
await mouse('mousePressed', middleStart, 'middle');
await mouse('mouseMoved', middleEnd, 'middle', 4);
await mouse('mouseReleased', middleEnd, 'middle');
await sleep(80);
const middleAfter = await evaluate(`document.querySelector('#planCanvas').getAttribute('viewBox')`);
assert.notEqual(middleAfter, middleBefore);

const spaceBefore = middleAfter;
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
const spaceStart = await point(960, 660), spaceEnd = { x: spaceStart.x - 55, y: spaceStart.y + 25 };
await drag(spaceStart, spaceEnd);
await cdp('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
const spaceAfter = await evaluate(`document.querySelector('#planCanvas').getAttribute('viewBox')`);
assert.notEqual(spaceAfter, spaceBefore);

await evaluate(`document.querySelector('#exportBtn').click()`);
const exportModal = await evaluate(`(() => ({
  visible: !document.querySelector('.export-modal').classList.contains('hidden'),
  actions: [...document.querySelectorAll('.export-modal [data-export]')].map(node => node.dataset.export)
}))()`);
assert.equal(exportModal.visible, true);
assert.deepEqual(exportModal.actions, ['svg', 'png', 'pdf', 'close']);
const svgExport = await evaluate(`(() => {
  const original = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { this.dataset.testDownload = 'true'; };
  document.querySelector('.export-modal [data-export="svg"]').click();
  HTMLAnchorElement.prototype.click = original;
  return { toast: document.querySelector('#toast').textContent, closed: document.querySelector('.export-modal').classList.contains('hidden') };
})()`);
assert.equal(svgExport.toast, '已匯出可攜式 SVG');
assert.equal(svgExport.closed, true);

await cdp('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
await navigate();
const tabletLandscape = await evaluate(`(() => ({
  grid: getComputedStyle(document.querySelector('.app-shell')).gridTemplateColumns,
  toolWidth: document.querySelector('.tool-rail').getBoundingClientRect().width,
  touchHeight: document.querySelector('.tool').getBoundingClientRect().height,
  inspectorHidden: document.body.classList.contains('inspector-hidden'),
  toggleVisible: getComputedStyle(document.querySelector('#inspectorToggle')).display !== 'none',
  overflow: document.documentElement.scrollWidth <= innerWidth
}))()`);
assert.ok(tabletLandscape.grid.startsWith('88px '), tabletLandscape.grid);
assert.equal(Math.round(tabletLandscape.toolWidth), 88);
assert.ok(tabletLandscape.touchHeight >= 44);
assert.equal(tabletLandscape.inspectorHidden, true);
assert.equal(tabletLandscape.toggleVisible, true);
assert.equal(tabletLandscape.overflow, true);

await cdp('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
await navigate();
const tabletPortrait = await evaluate(`(() => ({
  hidden: document.body.classList.contains('inspector-hidden'),
  toggleVisible: getComputedStyle(document.querySelector('#inspectorToggle')).display !== 'none',
  dockPosition: getComputedStyle(document.querySelector('.tool-rail')).position,
  dockDirection: getComputedStyle(document.querySelector('.tool-rail')).flexDirection,
  labelVisible: getComputedStyle(document.querySelector('.tool span:not(.tool-icon)')).display !== 'none',
  overflow: document.documentElement.scrollWidth <= innerWidth
}))()`);
assert.equal(tabletPortrait.hidden, true);
assert.equal(tabletPortrait.toggleVisible, true);
assert.equal(tabletPortrait.dockPosition, 'fixed');
assert.equal(tabletPortrait.dockDirection, 'row');
assert.equal(tabletPortrait.labelVisible, true);
assert.equal(tabletPortrait.overflow, true);

await evaluate(`document.querySelector('[data-tool="door"]').click()`);
assert.equal(await evaluate(`document.body.classList.contains('inspector-hidden')`), false);
await evaluate(`document.querySelector('[data-opening="single"]').click()`);
assert.equal(await evaluate(`document.body.classList.contains('inspector-hidden')`), true);

await evaluate(`document.querySelector('[data-tool="select"]').click()`);
await click(await point(win.x, win.y));
await evaluate(`document.querySelector('#inspectorToggle').click()`);
assert.equal(await evaluate(`document.querySelector('#archPanel')?.textContent.includes('翻轉窗戶方向')`), true);
await evaluate(`document.querySelector('#closeInspector').click()`);

await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
const pinchBefore = await evaluate(`document.querySelector('#planCanvas').getAttribute('viewBox')`);
const pinchCenter = await point(900, 600);
await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
  { x: pinchCenter.x - 45, y: pinchCenter.y, id: 11, radiusX: 5, radiusY: 5, force: 1 },
  { x: pinchCenter.x + 45, y: pinchCenter.y, id: 12, radiusX: 5, radiusY: 5, force: 1 }
] });
await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
  { x: pinchCenter.x - 80, y: pinchCenter.y - 10, id: 11, radiusX: 5, radiusY: 5, force: 1 },
  { x: pinchCenter.x + 80, y: pinchCenter.y + 10, id: 12, radiusX: 5, radiusY: 5, force: 1 }
] });
await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(80);
const pinchAfter = await evaluate(`document.querySelector('#planCanvas').getAttribute('viewBox')`);
assert.notEqual(pinchAfter, pinchBefore);

const beforePan = await evaluate(`document.querySelector('#planCanvas').getAttribute('viewBox')`);
const panStart = await point(1050, 700), panEnd = { x: panStart.x - 70, y: panStart.y - 45 };
await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: panStart.x, y: panStart.y, id: 1, radiusX: 5, radiusY: 5, force: 1 }] });
await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: panEnd.x, y: panEnd.y, id: 1, radiusX: 5, radiusY: 5, force: 1 }] });
await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(80);
const afterPan = await evaluate(`document.querySelector('#planCanvas').getAttribute('viewBox')`);
assert.notEqual(afterPan, beforePan);

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await navigate();
const mobile = await evaluate(`(() => ({
  dockBottom: getComputedStyle(document.querySelector('.tool-rail')).bottom,
  dockHeight: document.querySelector('.tool-rail').getBoundingClientRect().height,
  toolWidth: document.querySelector('.tool').getBoundingClientRect().width,
  fileVisible: getComputedStyle(document.querySelector('#fileBtn')).display !== 'none',
  exportVisible: getComputedStyle(document.querySelector('#exportBtn')).display !== 'none',
  settingsVisible: getComputedStyle(document.querySelector('#inspectorToggle')).display !== 'none',
  inspectorInert: document.querySelector('#inspector').inert,
  overflow: document.documentElement.scrollWidth <= innerWidth
}))()`);
assert.equal(mobile.dockBottom, '0px');
assert.ok(mobile.dockHeight >= 82);
assert.ok(mobile.toolWidth >= 64);
assert.equal(mobile.fileVisible, true);
assert.equal(mobile.exportVisible, true);
assert.equal(mobile.settingsVisible, true);
assert.equal(mobile.inspectorInert, true);
assert.equal(mobile.overflow, true);
await evaluate(`document.querySelector('#inspectorToggle').click(); const field=document.querySelector('#mobileProjectName'); field.value='手機圖面'; field.dispatchEvent(new Event('change',{bubbles:true}))`);
assert.equal(await evaluate(`JSON.parse(localStorage.getItem('planhaus-project')).project`), '手機圖面');
assert.equal(await evaluate(`document.querySelector('#projectName').value`), '手機圖面');
assert.equal(await evaluate(`document.querySelector('#inspector').inert`), false);

await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(80);
assert.equal(await evaluate(`document.body.classList.contains('inspector-hidden')`), false);
assert.equal(await evaluate(`document.querySelector('#inspector').inert`), false);

assert.deepEqual(errors, []);
await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
await cdp('Emulation.clearDeviceMetricsOverride');
await cdp('Target.closeTarget', { targetId: target.id });
ws.close();
console.log(JSON.stringify({ base, openingMarkup, exportModal, tabletLandscape, tabletPortrait, mobile, navigation: { zoomAnchorBefore, zoomAnchorAfter, middleBefore, middleAfter, spaceBefore, spaceAfter, pinchBefore, pinchAfter, beforePan, afterPan }, errors, result: 'PASS' }, null, 2));
