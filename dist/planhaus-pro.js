/* 築間 Planhaus — Pro 擴充模組
 * 1. JSON 圖面檔：具名專案庫（localStorage）、匯出／匯入 .planhaus.json
 * 2. 多邊形房間：邊中點新增角點、右鍵／Delete 刪除角點
 * 3. 建築屬性：門窗寬高、窗台高度、牆厚、天花板高度
 * 4. 物件旋轉控制點、門窗家具拖曳與牆體自動吸附、牆體端點吸附
 * 依賴 app.js 暴露的 window.Planhaus（hooks + 內部 API），不使用外部套件。
 */
(() => {
  const P = window.Planhaus;
  if (!P) return;
  const { svg, layer, el, $ } = P;

  const FORMAT = 'planhaus', FORMAT_VERSION = 1, LIBRARY_KEY = 'planhaus-library';
  const PX = 40; // 40 px = 1 m（與 app.js meters() 一致）
  const toM = px => px / PX, toPx = m => m * PX;
  const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const deg = r => r * 180 / Math.PI, rad = d => d * Math.PI / 180;
  const norm360 = d => round(((d % 360) + 360) % 360, 1);
  const items = () => P.state.items;
  const byId = id => items().find(i => i.id === id);
  const viewScale = () => P.view.w / 1200;
  const isFacility = it => it && ['door', 'window', 'furniture'].includes(it.type);

  const DOOR_KINDS = ['single', 'double', 'sliding', 'folding'], WINDOW_KINDS = ['fixed', 'slider', 'bay', 'screen'];
  const FURNITURE = ['sofa', 'bed', 'table', 'desk', 'island', 'plant', 'bathtub', 'toilet', 'sink', 'cabinet', 'stairs', 'column'];
  const RESIZABLE_FURNITURE = ['cabinet', 'column'];
  // 預設尺寸＝app.js 原始繪圖尺寸（例如單開門 36px = 0.9m），比例 1 時外觀不變
  const OPENING_DEFAULTS = {
    single: { width: .9, height: 2.1 }, double: { width: 1.8, height: 2.1 }, sliding: { width: 1.9, height: 2.1 }, folding: { width: 1.9, height: 2.1 },
    fixed: { width: 1.4, height: 1.2, sill: .9 }, slider: { width: 1.4, height: 1.2, sill: .9 }, screen: { width: 1.4, height: 1.2, sill: .9 }, bay: { width: 1.5, height: 1.5, sill: .5 }
  };
  const WALL_THICKNESS = .3, CEILING = 2.8; // 0.3m = 原 CSS 牆線 12px

  const kindOf = it => it.kind || (it.type === 'door' ? 'single' : 'fixed');
  function openingAttrs(it) {
    const d = OPENING_DEFAULTS[kindOf(it)] || OPENING_DEFAULTS.single;
    return { width: it.width ?? d.width, height: it.height ?? d.height, sill: it.type === 'window' ? (it.sill ?? d.sill ?? .9) : 0, defWidth: d.width };
  }
  // 開口沿本地 x 軸的範圍（px），單開門鉸鏈在原點
  function openingSpan(it) {
    const a = openingAttrs(it), w = toPx(a.width);
    return kindOf(it) === 'single' ? (it.hinge === 'right' ? [-w, 0] : [0, w]) : [-w / 2, w / 2];
  }
  const wallThickness = w => w.thickness ?? WALL_THICKNESS;

  /* ---------------- 幾何：牆面線段與吸附 ---------------- */
  function segments() {
    const out = [];
    for (const it of items()) {
      if (it.type === 'wall') out.push({ a: { x: it.x1, y: it.y1 }, b: { x: it.x2, y: it.y2 }, kind: 'wall', id: it.id, thick: toPx(wallThickness(it)) });
      else if (it.type === 'room') {
        const pts = P.getPoints(it);
        pts.forEach((a, i) => out.push({ a, b: pts[(i + 1) % pts.length], kind: 'room', id: it.id, edge: i, room: it, thick: 2 }));
      }
    }
    return out;
  }
  function project(p, s) {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, len = Math.hypot(dx, dy);
    if (len < 1) return null;
    const t = clamp(((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / (len * len), 0, 1);
    const q = { x: s.a.x + dx * t, y: s.a.y + dy * t };
    return { t, q, len, dir: { x: dx / len, y: dy / len }, dist: Math.hypot(p.x - q.x, p.y - q.y) };
  }
  // 牆面法向量：房間邊朝內、獨立牆朝游標側
  function normalFor(s, pr, p) {
    let n = { x: -pr.dir.y, y: pr.dir.x };
    if (s.kind === 'room') {
      const probe = { x: pr.q.x + n.x * 6, y: pr.q.y + n.y * 6 };
      if (!P.pointInPoly(probe, P.getPoints(s.room))) n = { x: -n.x, y: -n.y };
    } else if ((p.x - pr.q.x) * n.x + (p.y - pr.q.y) * n.y < 0) n = { x: -n.x, y: -n.y };
    return n;
  }
  // 讓本地 +y 指向 n 的旋轉角
  const rotationFromNormal = n => norm360(deg(Math.atan2(-n.x, n.y)));
  function nearestSegment(p, maxDist, filter = () => true) {
    let best = null;
    for (const s of segments()) {
      if (!filter(s)) continue;
      const pr = project(p, s);
      if (!pr) continue;
      const d = pr.dist - (s.kind === 'wall' ? 2 : 0); // 同距離時優先獨立牆
      if (d <= maxDist && (!best || d < best.d)) best = { s, pr, d };
    }
    return best;
  }
  function snapOpening(it, p) {
    const hit = nearestSegment(p, 22 * viewScale());
    if (!hit) return false;
    const { s, pr } = hit, n = normalFor(s, pr, p), rotation = rotationFromNormal(n);
    // 本地 +x 在世界座標的方向，用於把開口範圍限制在線段內
    const ux = { x: Math.cos(rad(rotation)), y: Math.sin(rad(rotation)) }, sign = ux.x * pr.dir.x + ux.y * pr.dir.y >= 0 ? 1 : -1;
    const [lo, hi] = openingSpan(it).map(v => v * sign).sort((a, b) => a - b);
    let along = pr.t * pr.len;
    if (hi - lo < pr.len) along = clamp(along, -lo, pr.len - hi);
    it.x = round(s.a.x + pr.dir.x * along, 1); it.y = round(s.a.y + pr.dir.y * along, 1);
    it.rotation = rotation;
    it.wallRef = { kind: s.kind, id: s.id, ...(s.kind === 'room' ? { edge: s.edge } : {}) };
    if (s.kind === 'room') it.parentRoomId = s.id;
    else it.parentRoomId = P.roomAt({ x: it.x + n.x * 20, y: it.y + n.y * 20 })?.id || null;
    delete it.rotationManual;
    return true;
  }
  function snapFurniture(it, p) {
    const d = P.furnitureDims(it), reach = d.h / 2 + 18 * viewScale();
    const hit = nearestSegment(p, reach + 8);
    if (!hit) return false;
    const { s, pr } = hit, n = normalFor(s, pr, p), off = d.h / 2 + s.thick / 2;
    let along = pr.t * pr.len;
    if (d.w < pr.len) along = clamp(along, d.w / 2, pr.len - d.w / 2);
    it.x = round(s.a.x + pr.dir.x * along + n.x * off, 1); it.y = round(s.a.y + pr.dir.y * along + n.y * off, 1);
    it.rotation = rotationFromNormal(n);
    it.wallRef = { kind: s.kind, id: s.id, ...(s.kind === 'room' ? { edge: s.edge } : {}) };
    it.parentRoomId = s.kind === 'room' ? s.id : (P.roomAt(it)?.id || null);
    delete it.rotationManual;
    return true;
  }

  /* ---------------- 放置：門窗家具自動吸附牆面 ---------------- */
  P.hooks.place.push((common, tool, p, sub) => {
    if (tool === 'door' || tool === 'window') {
      const kind = (tool === 'door' ? DOOR_KINDS : WINDOW_KINDS).includes(sub) ? sub : (tool === 'door' ? 'single' : 'fixed');
      const d = OPENING_DEFAULTS[kind];
      Object.assign(common, { width: d.width, height: d.height }, tool === 'window' ? { sill: d.sill } : {});
      if (tool === 'door') Object.assign(common, { swing: 'in', hinge: 'left' });
      if (snapOpening(Object.assign(common, { type: tool, kind }), p)) P.toast('已吸附至牆面');
      delete common.type; delete common.kind; // 由 app.js 設定
    } else if (tool === 'furniture' && !['plant', 'column'].includes(sub)) {
      common.name = sub;
      snapFurniture(common, p);
      delete common.name;
    }
  });

  /* ---------------- 門片拖曳放置：拖曳側決定內／外開 ---------------- */
  let doorPlace = null;
  P.hooks.pointerdown.push(e => {
    if (P.tool !== 'door' || e.button !== 0) return;
    const kind = DOOR_KINDS.includes(P.openingType) ? P.openingType : 'single';
    doorPlace = { start: P.point(e, true), rawStart: P.rawPoint(e), kind, pointerId: e.pointerId };
    try { svg.setPointerCapture(e.pointerId); } catch {}
    P.preview.innerHTML = '';
    return true;
  });
  P.hooks.pointermove.push(e => {
    if (!doorPlace) return;
    const p = P.rawPoint(e);
    P.preview.innerHTML = '';
    P.preview.append(el('line', { x1: doorPlace.start.x, y1: doorPlace.start.y, x2: p.x, y2: p.y, class: 'door-drag-guide' }));
    return true;
  });
  P.hooks.pointerup.push(e => {
    if (!doorPlace) return;
    const place = doorPlace; doorPlace = null; P.preview.innerHTML = '';
    const p = place.start, room = P.roomAt(p), d = OPENING_DEFAULTS[place.kind];
    const item = { type: 'door', kind: place.kind, x: p.x, y: p.y, parentRoomId: room?.id || null, rotation: 0, width: d.width, height: d.height, swing: 'in', hinge: 'left' };
    snapOpening(item, p);
    const end = P.rawPoint(e), dx = end.x - place.rawStart.x, dy = end.y - place.rawStart.y, r = rad(item.rotation || 0), inward = { x: -Math.sin(r), y: Math.cos(r) };
    if (Math.hypot(dx, dy) >= 8) item.swing = dx * inward.x + dy * inward.y >= 0 ? 'in' : 'out';
    P.addItem(item);
    P.toast(item.swing === 'in' ? '已建立內開門' : '已建立外開門');
    return true;
  });

  /* ---------------- 牆體繪製：端點吸附既有牆端點與房間角點 ---------------- */
  let wallSnapMark = null;
  P.hooks.snapPoint.push((r, evt, raw) => {
    wallSnapMark = null;
    if (P.tool !== 'wall' || evt.altKey) return;
    const lim = 14 * viewScale();
    let best = null;
    for (const it of items()) {
      const pts = it.type === 'wall' ? [{ x: it.x1, y: it.y1 }, { x: it.x2, y: it.y2 }] : it.type === 'room' ? P.getPoints(it) : [];
      for (const q of pts) { const d = Math.hypot(q.x - raw.x, q.y - raw.y); if (d <= lim && (!best || d < best.d)) best = { d, q }; }
    }
    if (!best) return;
    wallSnapMark = { ...best.q };
    return { ...best.q };
  });
  P.hooks.pointermove.push(() => {
    // 在預覽層之後補畫吸附標記（app.js 會先清空 preview）
    queueMicrotask(() => {
      P.preview.querySelector('.snap-mark')?.remove();
      if (wallSnapMark && P.tool === 'wall') P.preview.append(el('circle', { cx: wallSnapMark.x, cy: wallSnapMark.y, r: 7, class: 'snap-mark' }));
    });
  });

  /* ---------------- 拖曳門窗家具、旋轉控制點 ---------------- */
  let move = null, rotate = null;
  P.hooks.itemPointerDown.push((e, item) => {
    if (!isFacility(item) || e.button !== 0) return;
    e.preventDefault();
    move = { id: item.id, start: P.rawPoint(e), ox: item.x, oy: item.y, before: P.snapshot(), moved: false, snapped: false };
    try { svg.setPointerCapture(e.pointerId); } catch {}
  });
  function beginRotate(e, item) {
    e.stopPropagation(); e.preventDefault();
    rotate = { id: item.id, before: P.snapshot(), changed: false };
    try { svg.setPointerCapture(e.pointerId); } catch {}
    svg.classList.add('dragging');
  }
  P.hooks.pointermove.push(e => {
    if (rotate) {
      const it = byId(rotate.id), p = P.rawPoint(e);
      if (!it) return true;
      let a = deg(Math.atan2(p.y - it.y, p.x - it.x)) + 90;
      a = e.altKey ? Math.round(a) : Math.round(a / 15) * 15;
      a = norm360(a);
      if (a !== norm360(it.rotation || 0)) { it.rotation = a; it.rotationManual = true; delete it.wallRef; rotate.changed = true; P.render(); }
      return true;
    }
    if (move) {
      const it = byId(move.id), p = P.rawPoint(e);
      if (!it) return true;
      let nx = move.ox + (p.x - move.start.x), ny = move.oy + (p.y - move.start.y);
      if (!e.altKey) { nx = P.snap(nx, 10); ny = P.snap(ny, 10); }
      if (!move.moved && Math.hypot(nx - move.ox, ny - move.oy) < 3) return true;
      move.moved = true;
      svg.classList.add('dragging');
      const target = { x: nx, y: ny };
      const snapped = !e.altKey && (it.type === 'furniture' ? (!['plant', 'column'].includes(it.name) && !it.rotationManual && snapFurniture(it, target)) : snapOpening(it, target));
      if (!snapped) {
        it.x = nx; it.y = ny;
        if (it.wallRef) { delete it.wallRef; it.rotationManual = true; }
        it.parentRoomId = P.roomAt(target)?.id || null;
      }
      move.snapped = snapped;
      P.render();
      return true;
    }
  });
  P.hooks.pointerup.push(() => {
    if (rotate) {
      const r = rotate; rotate = null; svg.classList.remove('dragging');
      if (r.changed) { P.pushHistory(r.before); P.persist('已旋轉'); P.render(); }
      return true;
    }
    if (move) {
      const m = move; move = null; svg.classList.remove('dragging');
      if (m.moved) { P.pushHistory(m.before); P.persist(m.snapped ? '已吸附至牆面' : '已移動'); P.render(); }
      return true;
    }
  });

  /* ---------------- 多邊形角點新增／刪除 ---------------- */
  let activeVertex = null;
  function deleteVertex(roomId, index) {
    const room = byId(roomId);
    if (!room?.points) return;
    if (room.points.length <= 3) { P.toast('多邊形至少需要 3 個角點'); return; }
    const before = P.snapshot(), next = room.points.filter((_, i) => i !== index);
    const test = { ...room, points: next };
    if (P.polyArea(next) < 400) { P.toast('刪除後房間面積過小'); return; }
    if (P.overlapsRoom(test, room.id)) { P.toast('刪除後會與其他房間重疊'); return; }
    room.points = next; P.syncBounds(room); activeVertex = null;
    P.commit('角點已刪除', before);
    P.toast('角點已刪除');
  }
  function insertVertex(e, room, index, pt) {
    e.stopPropagation(); e.preventDefault();
    if (e.button === 2) return;
    P.pushHistory(P.snapshot());
    room.points.splice(index + 1, 0, { x: round(pt.x, 1), y: round(pt.y, 1) });
    activeVertex = { id: room.id, index: index + 1 };
    P.beginHandleDrag(e, room, index + 1);
    P.render();
  }

  /* ---------------- 鍵盤 ---------------- */
  P.hooks.keydown.push(e => {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 's') { e.preventDefault(); saveToLibrary(); return true; }
    if ((e.ctrlKey || e.metaKey) && key === 'o') { e.preventDefault(); openFileDialog(); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && activeVertex && P.editingRoomId === activeVertex.id) { e.preventDefault(); deleteVertex(activeVertex.id, activeVertex.index); return true; }
    const it = byId(P.selected);
    if (isFacility(it) && (e.key === '[' || e.key === ']')) {
      const before = P.snapshot();
      it.rotation = norm360((it.rotation || 0) + (e.key === ']' ? 15 : -15)); it.rotationManual = true; delete it.wallRef;
      P.commit('已旋轉', before); return true;
    }
  });

  /* ---------------- 繪製附加圖層 ---------------- */
  function decorate() {
    const sel = byId(P.selected);
    if (activeVertex && P.editingRoomId !== activeVertex.id) activeVertex = null;

    for (const it of items()) {
      const node = layer.querySelector(`[data-id="${CSS.escape(it.id)}"]`);
      if (!node) continue;
      if (it.type === 'wall') node.style.strokeWidth = toPx(wallThickness(it)) + 'px';
      if (it.type === 'door' || it.type === 'window') {
        const a = openingAttrs(it), s = a.width / a.defWidth, [lo, hi] = openingSpan({ ...it, width: a.defWidth });
        // 透明點擊範圍：開口線很細，補一個容易點選的區域
        node.prepend(el('rect', { x: it.x + lo, y: it.y - 18, width: hi - lo, height: 36, class: 'opening-hit' }));
        if (Math.abs(s - 1) > .001) {
          const sy = it.type === 'door' ? s : 1;
          const visualRotation = (it.rotation || 0) + (it.flipped ? 180 : 0);
          node.setAttribute('transform', `rotate(${visualRotation} ${it.x} ${it.y}) translate(${it.x} ${it.y}) scale(${s} ${sy}) translate(${-it.x} ${-it.y})`);
          node.classList.add('pro-scaled');
        }
      }
    }

    // 角點編輯：邊中點「＋」與角點選取
    const room = byId(P.editingRoomId);
    if (room?.points) {
      const g = layer.querySelector(`[data-id="${CSS.escape(room.id)}"]`);
      g?.querySelectorAll('.vertex-handle').forEach(h => {
        const idx = +h.dataset.index;
        if (activeVertex?.id === room.id && activeVertex.index === idx) h.classList.add('active');
        h.append(el('title')); h.lastChild.textContent = '拖曳移動；右鍵或 Delete 刪除角點';
      });
      // 捕獲階段：先於 app.js 的角點拖曳處理；右鍵直接刪除角點
      g?.addEventListener('pointerdown', ev => {
        const h = ev.target.closest?.('.vertex-handle');
        if (!h) return;
        const idx = +h.dataset.index;
        if (ev.button === 2) { ev.stopPropagation(); ev.preventDefault(); deleteVertex(room.id, idx); return; }
        activeVertex = { id: room.id, index: idx };
      }, true);
      const pts = room.points, ui = el('g', { class: 'pro-ui' });
      pts.forEach((a, i) => {
        const b = pts[(i + 1) % pts.length], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (Math.hypot(b.x - a.x, b.y - a.y) < 30) return;
        const h = el('g', { class: 'edge-handle', transform: `translate(${mid.x} ${mid.y})` });
        h.append(el('circle', { r: 7 }), el('path', { d: 'M -3.5 0 H 3.5 M 0 -3.5 V 3.5' }), el('title'));
        h.lastChild.textContent = '拖曳以新增角點';
        h.addEventListener('pointerdown', ev => insertVertex(ev, room, i, mid));
        ui.append(h);
      });
      layer.append(ui);
    }

    // 選取物件：旋轉控制點與建築標註
    if (isFacility(sel)) {
      const r = rad((sel.rotation || 0) + (sel.flipped ? 180 : 0)), local = sel.type === 'furniture' ? -(P.furnitureDims(sel).h / 2 + 26) : -34;
      // 本地 (0, L) → 世界 (x − sin r·L, y + cos r·L)
      const toWorld = L => ({ x: sel.x - Math.sin(r) * L, y: sel.y + Math.cos(r) * L });
      const { x: wx, y: wy } = toWorld(local);
      const ui = el('g', { class: 'pro-ui rotate-ui' });
      ui.append(el('line', { x1: sel.x, y1: sel.y, x2: wx, y2: wy, class: 'rotate-stem' }));
      const knob = el('circle', { cx: wx, cy: wy, r: 8, class: 'rotate-handle' });
      knob.append(el('title')); knob.lastChild.textContent = '拖曳旋轉（15° 對齊，按住 Alt 自由旋轉）';
      knob.addEventListener('pointerdown', ev => beginRotate(ev, sel));
      ui.append(knob);
      if (sel.type !== 'furniture') {
        const a = openingAttrs(sel), s = a.width / a.defWidth, at = toWorld(sel.type === 'door' ? 36 * s + 18 : 26);
        const t = el('text', { x: at.x, y: at.y + 4, class: 'arch-annot' });
        t.textContent = `W${a.width.toFixed(2)} × H${a.height.toFixed(2)}` + (sel.type === 'window' ? ` · 台${a.sill.toFixed(2)}` : '');
        ui.append(t);
      } else if (RESIZABLE_FURNITURE.includes(sel.name)) {
        const d = P.furnitureDims(sel), at = toWorld(d.h / 2 + 20);
        const t = el('text', { x: at.x, y: at.y + 4, class: 'arch-annot' });
        t.textContent = `W${toM(d.w).toFixed(2)} × D${toM(d.h).toFixed(2)}`;
        ui.append(t);
      }
      layer.append(ui);
    }
    renderArchPanel(sel);
  }
  P.hooks.afterRender.push(decorate);
  svg.addEventListener('contextmenu', e => {
    if (e.target.closest?.('.vertex-handle, .edge-handle')) { e.preventDefault(); return; }
    const node = e.target.closest?.('[data-id]'), it = node && byId(node.dataset.id);
    if (it && ['door', 'window', 'furniture'].includes(it.type)) {
      e.preventDefault(); e.stopPropagation();
      const before = P.snapshot(); P.selected = it.id;
      if (it.type === 'door') it.swing = it.swing === 'out' ? 'in' : 'out';
      else if (it.type === 'window') it.flipped = !it.flipped;
      else { it.rotation = norm360((it.rotation || 0) + 90); it.rotationManual = true; delete it.wallRef; }
      P.commit(it.type === 'furniture' ? '家具已順時針旋轉' : '開口方向已翻轉', before);
      return;
    }
    if (P.editingRoomId) e.preventDefault();
  });

  // 匯出 SVG 前移除編輯用 UI（app.js 的 onclick 在目標階段執行，此處為捕獲階段）
  window.addEventListener('click', e => {
    if (!e.target.closest?.('#exportBtn')) return;
    layer.querySelectorAll('.pro-ui').forEach(n => n.remove());
    setTimeout(P.render, 0);
  }, true);

  /* ---------------- 建築屬性面板 ---------------- */
  const archPanel = document.createElement('section');
  archPanel.id = 'archPanel'; archPanel.className = 'panel-section hidden';
  $('selectionPanel').after(archPanel);

  function numField(label, value, { min, max, step = .05, key, unit = 'm' }) {
    const lab = document.createElement('label'), input = document.createElement('input');
    lab.textContent = `${label}（${unit}）`;
    Object.assign(input, { type: 'number', min, max, step, value: round(value, 2) });
    input.dataset.key = key;
    lab.append(input);
    return lab;
  }
  function renderArchPanel(it) {
    if (archPanel.contains(document.activeElement)) return; // 避免輸入中被重繪
    // 原「寬度／高度」欄位只作用於房間；其他物件改用建築屬性面板
    const sizeRow = $('itemWidth')?.closest('.field-row');
    if (sizeRow) sizeRow.hidden = !!it && it.type !== 'room';
    archPanel.innerHTML = '';
    archPanel.classList.toggle('hidden', !it);
    if (!it) return;
    const head = document.createElement('div'); head.className = 'section-title';
    const h3 = document.createElement('h3'); h3.textContent = '建築屬性';
    const tag = document.createElement('span');
    head.append(h3, tag); archPanel.append(head);
    const row = (...nodes) => { const d = document.createElement('div'); d.className = 'field-row'; d.append(...nodes); archPanel.append(d); return d; };

    if (it.type === 'door' || it.type === 'window') {
      const a = openingAttrs(it);
      tag.textContent = it.wallRef ? '● 已吸附牆面' : '○ 未吸附';
      tag.className = it.wallRef ? 'snap-on' : '';
      row(numField('開口寬度', a.width, { key: 'width', min: .3, max: 6 }), numField(it.type === 'door' ? '門高' : '窗高', a.height, { key: 'height', min: .3, max: 4 }));
      if (it.type === 'window') row(numField('窗台高度', a.sill, { key: 'sill', min: 0, max: 3 }), numField('旋轉角度', it.rotation || 0, { key: 'rotation', step: 15, unit: '°' }));
      else row(numField('旋轉角度', it.rotation || 0, { key: 'rotation', step: 15, unit: '°' }));
      rotateButtons();
      if (it.type === 'door' && ['single', 'double'].includes(kindOf(it))) doorDirectionButtons();
    } else if (it.type === 'furniture') {
      tag.textContent = it.wallRef ? '● 靠牆' : '';
      tag.className = it.wallRef ? 'snap-on' : '';
      if (RESIZABLE_FURNITURE.includes(it.name)) {
        const d = P.furnitureDims(it);
        row(numField('寬度', toM(d.w), { key: 'width', min: .1, max: 12, step: .05 }), numField('深度', toM(d.h), { key: 'height', min: .1, max: 12, step: .05 }));
      }
      row(numField('旋轉角度', it.rotation || 0, { key: 'rotation', step: 15, unit: '°' }));
      rotateButtons();
    } else if (it.type === 'wall') {
      tag.textContent = `長 ${toM(Math.hypot(it.x2 - it.x1, it.y2 - it.y1)).toFixed(2)} m`;
      row(numField('牆厚', wallThickness(it), { key: 'thickness', min: .05, max: 1, step: .05 }));
    } else if (it.type === 'room') {
      tag.textContent = `${P.getPoints(it).length} 個角點`;
      row(numField('天花板高度', it.ceiling ?? CEILING, { key: 'ceiling', min: 2, max: 8, step: .1 }));
      const tip = document.createElement('p'); tip.className = 'arch-tip';
      if (P.editingRoomId === it.id) {
        tip.textContent = '拖曳邊上的「＋」新增角點；右鍵角點或選取後按 Delete 刪除。';
        const del = document.createElement('button');
        del.className = 'mini-btn'; del.textContent = '刪除選取角點'; del.disabled = !(activeVertex?.id === it.id);
        del.onclick = () => activeVertex && deleteVertex(activeVertex.id, activeVertex.index);
        archPanel.append(tip, del);
      } else { tip.textContent = '雙擊房間進入角點編輯，可新增或刪除角點。'; archPanel.append(tip); }
    }

    function rotateButtons() {
      const wrap = document.createElement('div'); wrap.className = 'arch-actions';
      [['⟲ 90°', -90], ['⟳ 90°', 90]].forEach(([label, d]) => {
        const b = document.createElement('button'); b.className = 'mini-btn'; b.textContent = label;
        b.onclick = () => { const before = P.snapshot(); it.rotation = norm360((it.rotation || 0) + d); it.rotationManual = true; delete it.wallRef; P.commit('已旋轉', before); };
        wrap.append(b);
      });
      archPanel.append(wrap);
    }

    function doorDirectionButtons() {
      const wrap = document.createElement('div'); wrap.className = 'arch-actions door-actions';
      const swing = document.createElement('button'); swing.className = 'mini-btn';
      swing.textContent = it.swing === 'out' ? '目前外開・改為內開' : '目前內開・改為外開';
      swing.onclick = () => { const before = P.snapshot(); it.swing = it.swing === 'out' ? 'in' : 'out'; P.commit('門片方向已更新', before); };
      wrap.append(swing);
      if (kindOf(it) === 'single') {
        const hinge = document.createElement('button'); hinge.className = 'mini-btn';
        hinge.textContent = it.hinge === 'right' ? '鉸鏈在右・換到左側' : '鉸鏈在左・換到右側';
        hinge.onclick = () => { const before = P.snapshot(); it.hinge = it.hinge === 'right' ? 'left' : 'right'; P.commit('門片左右已更新', before); };
        wrap.append(hinge);
      }
      archPanel.append(wrap);
    }

    archPanel.querySelectorAll('input[data-key]').forEach(input => input.addEventListener('change', () => {
      const key = input.dataset.key, v = Number(input.value), min = input.min === '' ? -Infinity : +input.min, max = input.max === '' ? Infinity : +input.max;
      if (!Number.isFinite(v) || v < min || v > max) { P.toast(`請輸入 ${input.min || '−∞'}–${input.max || '∞'} 之間的數值`); input.blur(); P.render(); return; }
      const before = P.snapshot();
      if (key === 'rotation') { it.rotation = norm360(v); it.rotationManual = true; delete it.wallRef; }
      else it[key] = round(v, 3);
      if (it.type === 'window' && (key === 'sill' || key === 'height')) {
        const a = openingAttrs(it), room = byId(it.parentRoomId), ceil = room?.ceiling ?? CEILING;
        if (a.sill + a.height > ceil) P.toast(`提醒：窗台＋窗高 ${round(a.sill + a.height)} m 超過天花板 ${ceil} m`);
      }
      input.blur();
      P.commit('屬性已更新', before);
    }));
  }

  /* ---------------- JSON 圖面檔與專案庫 ---------------- */
  const ALLOWED = {
    room: ['id', 'type', 'x', 'y', 'w', 'h', 'points', 'name', 'color', 'ceiling'],
    wall: ['id', 'type', 'x1', 'y1', 'x2', 'y2', 'thickness', 'name', 'color'],
    door: ['id', 'type', 'kind', 'x', 'y', 'rotation', 'rotationManual', 'parentRoomId', 'wallRef', 'width', 'height', 'swing', 'hinge', 'flipped', 'name', 'color'],
    window: ['id', 'type', 'kind', 'x', 'y', 'rotation', 'rotationManual', 'parentRoomId', 'wallRef', 'width', 'height', 'sill', 'flipped', 'name', 'color'],
    furniture: ['id', 'type', 'name', 'x', 'y', 'rotation', 'rotationManual', 'parentRoomId', 'wallRef', 'width', 'height', 'color']
  };
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  function normalizeDrawing(raw) {
    const doc = Array.isArray(raw) ? { items: raw } : raw;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items)) throw new Error('檔案中找不到 items 陣列');
    if (doc.format && doc.format !== FORMAT) throw new Error('不是 Planhaus 圖面檔');
    if (doc.version > FORMAT_VERSION) throw new Error(`檔案版本 ${doc.version} 較新，請更新網站後再匯入`);
    const out = [], idMap = new Map();
    let skipped = 0;
    for (const src of doc.items) {
      const keys = src && ALLOWED[src.type];
      if (!keys) { skipped++; continue; }
      const it = {};
      keys.forEach(k => { if (src[k] !== undefined) it[k] = src[k]; });
      let ok = true;
      if (it.type === 'room') {
        if (Array.isArray(it.points)) {
          it.points = it.points.filter(p => p && finite(p.x) && finite(p.y)).map(p => ({ x: p.x, y: p.y }));
          if (it.points.length < 3) delete it.points;
        } else delete it.points;
        if (!it.points) ok = ['x', 'y', 'w', 'h'].every(k => finite(it[k])) && it.w > 0 && it.h > 0;
      } else if (it.type === 'wall') ok = ['x1', 'y1', 'x2', 'y2'].every(k => finite(it[k]));
      else {
        ok = finite(it.x) && finite(it.y);
        if (it.type === 'door') {
          if (!DOOR_KINDS.includes(it.kind)) it.kind = 'single';
          if (!['in', 'out'].includes(it.swing)) it.swing = 'in';
          if (!['left', 'right'].includes(it.hinge)) it.hinge = 'left';
        }
        if (it.type === 'window' && !WINDOW_KINDS.includes(it.kind)) it.kind = 'fixed';
        if (it.type === 'furniture' && !FURNITURE.includes(it.name)) ok = false;
        it.rotation = finite(it.rotation) ? norm360(it.rotation) : 0;
        if (it.wallRef && (typeof it.wallRef !== 'object' || !['wall', 'room'].includes(it.wallRef.kind))) delete it.wallRef;
        if (it.wallRef) it.wallRef = { kind: it.wallRef.kind, id: String(it.wallRef.id ?? ''), ...(finite(it.wallRef.edge) ? { edge: it.wallRef.edge } : {}) };
        if (it.rotationManual !== undefined) it.rotationManual = !!it.rotationManual;
        if (it.flipped !== undefined) it.flipped = !!it.flipped;
      }
      ['width', 'height', 'sill', 'thickness', 'ceiling'].forEach(k => { if (it[k] !== undefined && !(finite(it[k]) && it[k] >= 0 && it[k] < 100)) delete it[k]; });
      if (it.type !== 'furniture' && it.name !== undefined) it.name = String(it.name).slice(0, 60);
      if (it.color !== undefined && !/^#[0-9a-f]{6}$/i.test(it.color)) delete it.color;
      if (!ok) { skipped++; continue; }
      const oldId = typeof it.id === 'string' && it.id ? it.id : null;
      it.id = oldId && !idMap.has(oldId) ? oldId : P.uid() + out.length;
      if (oldId) idMap.set(oldId, it.id);
      out.push(it);
    }
    const ids = new Set(out.map(i => i.id));
    out.forEach(it => {
      if ('parentRoomId' in it) { const m = idMap.get(it.parentRoomId); it.parentRoomId = m && ids.has(m) ? m : null; }
      if (it.wallRef) { const m = idMap.get(it.wallRef.id); if (m && ids.has(m)) it.wallRef.id = m; else delete it.wallRef; }
      if (it.type === 'room') P.syncBounds(it);
    });
    if (!out.length && doc.items.length) throw new Error('檔案中沒有可辨識的圖面物件');
    return { state: { project: String(doc.project || '匯入的圖面').slice(0, 60), items: out }, skipped };
  }
  function serialize(state = P.state) {
    return { format: FORMAT, version: FORMAT_VERSION, app: '築間 Planhaus', project: state.project || '未命名專案', exportedAt: new Date().toISOString(), units: { pxPerMeter: PX }, items: state.items };
  }
  const fileSafe = s => (s || '房屋平面圖').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  function downloadJSON(state) {
    const blob = new Blob([JSON.stringify(serialize(state), null, 2)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileSafe(state.project) + '.planhaus.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    P.toast('JSON 圖面檔已匯出');
  }
  function readLibrary() {
    try { const v = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]'); return Array.isArray(v) ? v.filter(e => e && e.id && e.data) : []; } catch { return []; }
  }
  function writeLibrary(list) {
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(list)); return true; }
    catch { P.toast('瀏覽器儲存空間不足，請先匯出 JSON 或刪除舊專案'); return false; }
  }
  function saveToLibrary() {
    const name = (P.state.project || '').trim() || '未命名專案', list = readLibrary(), now = new Date().toISOString();
    const existing = list.find(e => e.name === name), data = JSON.parse(JSON.stringify({ project: name, items: P.state.items }));
    if (existing) Object.assign(existing, { savedAt: now, data }); else list.unshift({ id: P.uid(), name, savedAt: now, data });
    if (writeLibrary(list)) { P.toast(existing ? `已覆寫專案「${name}」` : `已儲存專案「${name}」`); refreshFileDialog(); }
  }

  // 檔案對話框
  const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json', hidden: true });
  document.body.append(fileInput);
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0]; fileInput.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { P.toast('檔案超過 5 MB'); return; }
    try {
      const { state, skipped } = normalizeDrawing(JSON.parse(await f.text()));
      P.loadState(state, '已匯入');
      closeFileDialog();
      P.toast(`已匯入「${state.project}」${skipped ? `，略過 ${skipped} 個無效物件` : ''}；可按復原還原`);
    } catch (err) { P.toast('匯入失敗：' + (err instanceof SyntaxError ? 'JSON 格式錯誤' : err.message)); }
  });

  const dialog = document.createElement('div');
  dialog.id = 'fileModal'; dialog.className = 'modal-backdrop hidden'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'fileModalTitle');
  dialog.innerHTML = `<div class="modal-card file-card">
      <span class="eyebrow">PLANHAUS · 圖面檔</span>
      <h2 id="fileModalTitle">圖面檔案</h2>
      <p>專案會以右上角的專案名稱儲存在此瀏覽器；匯出 JSON 可在其他裝置或瀏覽器開啟。</p>
      <div class="file-actions">
        <button class="primary-btn" data-act="save">儲存到專案庫 <span>Ctrl+S</span></button>
        <button class="secondary-btn" data-act="export">匯出 JSON</button>
        <button class="secondary-btn" data-act="import">匯入 JSON</button>
      </div>
      <div class="section-title"><h3>專案庫</h3><span id="libraryCount"></span></div>
      <div id="libraryList" class="library-list"></div>
      <div class="modal-actions"><button class="secondary-btn" data-act="close">關閉</button></div>
    </div>`;
  document.body.append(dialog);
  const fmtTime = iso => { try { return new Date(iso).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };
  function refreshFileDialog() {
    if (dialog.classList.contains('hidden')) return;
    const list = readLibrary(), box = dialog.querySelector('#libraryList');
    dialog.querySelector('#libraryCount').textContent = `${list.length} 個專案`;
    box.innerHTML = '';
    if (!list.length) { const p = document.createElement('p'); p.className = 'empty-list'; p.textContent = '尚未儲存任何專案'; box.append(p); return; }
    list.forEach(entry => {
      const row = document.createElement('div'); row.className = 'library-row';
      const info = document.createElement('div'), name = document.createElement('b'), meta = document.createElement('small');
      name.textContent = entry.name;
      const rooms = (entry.data.items || []).filter(i => i.type === 'room').length;
      meta.textContent = `${fmtTime(entry.savedAt)} · ${rooms} 房 · ${(entry.data.items || []).length} 物件`;
      info.append(name, meta);
      const acts = document.createElement('div'); acts.className = 'library-acts';
      const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'mini-btn ' + cls; b.textContent = label; b.onclick = fn; acts.append(b); return b; };
      mk('開啟', '', () => {
        try { const { state } = normalizeDrawing({ ...entry.data, project: entry.name }); P.loadState(state, '已開啟專案'); closeFileDialog(); P.toast(`已開啟「${entry.name}」；可按復原回到先前圖面`); }
        catch (err) { P.toast('無法開啟：' + err.message); }
      });
      mk('匯出', '', () => downloadJSON({ ...entry.data, project: entry.name }));
      const del = mk('刪除', 'danger-mini', () => {
        if (!del.dataset.confirm) { del.dataset.confirm = '1'; del.textContent = '確定刪除？'; setTimeout(() => { if (del.isConnected) { delete del.dataset.confirm; del.textContent = '刪除'; } }, 3000); return; }
        writeLibrary(readLibrary().filter(e => e.id !== entry.id)); P.toast(`已刪除「${entry.name}」`); refreshFileDialog();
      });
      row.append(info, acts); box.append(row);
    });
  }
  function openFileDialog() { dialog.classList.remove('hidden'); refreshFileDialog(); dialog.querySelector('[data-act="save"]').focus(); }
  function closeFileDialog() { dialog.classList.add('hidden'); }
  dialog.addEventListener('click', e => {
    if (e.target === dialog) return closeFileDialog();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'save') saveToLibrary();
    else if (act === 'export') downloadJSON(P.state);
    else if (act === 'import') fileInput.click();
    else if (act === 'close') closeFileDialog();
  });
  document.addEventListener('keydown', e => { if (dialog.classList.contains('hidden')) return; e.stopPropagation(); if (e.key === 'Escape') closeFileDialog(); }, true);
  $('fileBtn')?.addEventListener('click', openFileDialog);

  // 匯入檔案：拖放 JSON 到畫布
  const wrap = $('canvasWrap');
  wrap?.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); wrap.classList.add('drop-ready'); } });
  wrap?.addEventListener('dragleave', () => wrap.classList.remove('drop-ready'));
  wrap?.addEventListener('drop', e => {
    wrap.classList.remove('drop-ready');
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    const dt = new DataTransfer(); dt.items.add(f); fileInput.files = dt.files; fileInput.dispatchEvent(new Event('change'));
  });

  // 搬遷提示：舊網址（ChatGPT Sites）顯示新網址，並提醒先匯出 JSON（localStorage 不會跨網域）
  const CANONICAL_URL = 'https://seiseiart.github.io/planhaus/';
  if (/\.chatgpt\.site$/i.test(location.hostname) && /^https:\/\//.test(CANONICAL_URL)) {
    const bar = document.createElement('div'); bar.className = 'move-banner'; bar.setAttribute('role', 'status');
    const txt = document.createElement('span'); txt.textContent = '築間 Planhaus 已搬遷到新網址。請先「匯出 JSON」保存圖面，再到新網址匯入。';
    const exp = document.createElement('button'); exp.textContent = '匯出 JSON'; exp.onclick = () => downloadJSON(P.state);
    const go = document.createElement('a'); go.href = CANONICAL_URL; go.textContent = '前往新網址 ↗';
    bar.append(txt, exp, go); document.body.prepend(bar);
  }

  // 測試／除錯用
  window.PlanhausPro = { normalizeDrawing, serialize, readLibrary, saveToLibrary, openFileDialog, snapOpening, snapFurniture, deleteVertex, openingAttrs };

  P.render();
})();
