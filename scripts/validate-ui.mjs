import assert from 'node:assert/strict';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const target = await fetch('http://127.0.0.1:9223/json/new?http://127.0.0.1:4175/', { method: 'PUT' }).then(r => r.json());
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

async function navigate(url = 'http://127.0.0.1:4175/') {
  await cdp('Page.navigate', { url });
  await sleep(350);
}

async function point(x, y) {
  return evaluate(`(() => { const svg=document.querySelector('#planCanvas'); const p=svg.createSVGPoint(); p.x=${x}; p.y=${y}; const q=p.matrixTransform(svg.getScreenCTM()); return {x:q.x,y:q.y}; })()`);
}

async function mouse(type, p, button = 'left', buttons = type === 'mouseMoved' ? 1 : undefined) {
  const activeButtons = buttons ?? (type === 'mousePressed' ? (button === 'right' ? 2 : 1) : 0);
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
  roomStroke: getComputedStyle(document.querySelector('.plan-room')).strokeWidth,
  minFont: getComputedStyle(document.querySelector('.tool')).fontSize,
  svgReady: !!document.querySelector('#planCanvas')
}))()`);
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

await cdp('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
await navigate();
const tabletLandscape = await evaluate(`(() => ({
  grid: getComputedStyle(document.querySelector('.app-shell')).gridTemplateColumns,
  toolWidth: document.querySelector('.tool-rail').getBoundingClientRect().width,
  touchHeight: document.querySelector('.tool').getBoundingClientRect().height,
  overflow: document.documentElement.scrollWidth <= innerWidth
}))()`);
assert.ok(tabletLandscape.grid.startsWith('88px '), tabletLandscape.grid);
assert.equal(Math.round(tabletLandscape.toolWidth), 88);
assert.ok(tabletLandscape.touchHeight >= 44);
assert.equal(tabletLandscape.overflow, true);

await cdp('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
await navigate();
const tabletPortrait = await evaluate(`(() => ({
  hidden: document.body.classList.contains('inspector-hidden'),
  toggleVisible: getComputedStyle(document.querySelector('#inspectorToggle')).display !== 'none',
  grid: getComputedStyle(document.querySelector('.app-shell')).gridTemplateColumns,
  overflow: document.documentElement.scrollWidth <= innerWidth
}))()`);
assert.equal(tabletPortrait.hidden, true);
assert.equal(tabletPortrait.toggleVisible, true);
assert.ok(tabletPortrait.grid.startsWith('76px '), tabletPortrait.grid);
assert.equal(tabletPortrait.overflow, true);
await evaluate(`document.querySelector('#inspectorToggle').click()`);
assert.equal(await evaluate(`document.body.classList.contains('inspector-hidden')`), false);

assert.deepEqual(errors, []);
await cdp('Emulation.clearDeviceMetricsOverride');
await cdp('Target.closeTarget', { targetId: target.id });
ws.close();
console.log(JSON.stringify({ base, openingMarkup, tabletLandscape, tabletPortrait, errors, result: 'PASS' }, null, 2));
