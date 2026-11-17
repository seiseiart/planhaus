/* 築間 Planhaus — 尺寸標註（Cloud）
 * 1. 繪製牆體／房間時即時顯示長度、寬度與深度
 * 2. 房間外框、牆段自動尺寸（即時計算，不寫入 JSON）
 * 3. 可保存的手動尺寸線：{ id, type:'dimension', a, b, offset, mode:'manual', label, aRef?, bRef? }
 *    aRef／bRef = { id, i }：端點吸附在房間角點（i＝角點序號）或牆端點（i＝0／1）時記錄，房間或牆移動後標註跟著更新
 * 依賴 app.js 的 window.Planhaus（hooks、render、commit…），不修改 app.js、selected 仍為單一 ID、不改 viewBox。
 * 使用：按「標註」或 M 進入手動標註；拖曳畫出尺寸線；拖曳線身調整偏移、拖曳端點改量測點；Delete 刪除；Esc 結束。
 */
(() => {
  const P = window.Planhaus;
  if (!P) return;
  const { svg, layer, el, $ } = P;
  const PX = 40, INK = '#17324d', DIM = '#b94e30';
  const items = () => P.state.items;
  const byId = id => items().find(i => i.id === id);
  const viewScale = () => P.view.w / 1200;
  const r2 = n => Math.round(n * 100) / 100;
  const fmt = px => (px / PX).toFixed(2) + ' m';
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v ? '1' : '0'); } catch {} } };

  // 自行載入樣式（若 index.html 已載入則略過）
  if (!document.querySelector('link[href$="features/dimensions.css"]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'features/dimensions.css'; document.head.append(link);
  }

  let showAuto = store.get('planhaus-dim-auto', true);
  let dimMode = false, draft = null, drag = null;

  /* ---------------- 幾何與繪製 ---------------- */
  function frame(a, b, offset) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const a2 = { x: a.x + nx * offset, y: a.y + ny * offset }, b2 = { x: b.x + nx * offset, y: b.y + ny * offset };
    let ang = Math.atan2(dy, dx) * 180 / Math.PI;
    if (ang > 90) ang -= 180; else if (ang <= -90) ang += 180; // 文字保持可讀方向
    return { len, ux, uy, nx, ny, a2, b2, mid: { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 }, ang };
  }
  /** 畫一條尺寸線（延伸線＋尺寸線＋45° 斜線端記號＋數字），回傳 <g> */
  function drawDim(a, b, offset, { cls = 'dim', text, color = DIM } = {}) {
    const f = frame(a, b, offset), g = el('g', { class: cls });
    const s = Math.sign(offset) || 1, ext = 4 * s, size = Math.max(9, Math.min(15, 11 * viewScale()));
    if (Math.abs(offset) > 1) {
      g.append(el('line', { x1: r2(a.x + f.nx * 2 * s), y1: r2(a.y + f.ny * 2 * s), x2: r2(f.a2.x + f.nx * ext), y2: r2(f.a2.y + f.ny * ext), stroke: color, 'stroke-width': .8, class: 'dim-ext' }),
        el('line', { x1: r2(b.x + f.nx * 2 * s), y1: r2(b.y + f.ny * 2 * s), x2: r2(f.b2.x + f.nx * ext), y2: r2(f.b2.y + f.ny * ext), stroke: color, 'stroke-width': .8, class: 'dim-ext' }));
    }
    g.append(el('line', { x1: r2(f.a2.x), y1: r2(f.a2.y), x2: r2(f.b2.x), y2: r2(f.b2.y), stroke: color, 'stroke-width': 1, class: 'dim-line' }));
    // 斜線端記號（建築圖常用）
    const tk = 4, tx = (f.ux + f.nx) * tk / Math.SQRT2, ty = (f.uy + f.ny) * tk / Math.SQRT2;
    for (const p of [f.a2, f.b2]) g.append(el('line', { x1: r2(p.x - tx), y1: r2(p.y - ty), x2: r2(p.x + tx), y2: r2(p.y + ty), stroke: color, 'stroke-width': 1.6, class: 'dim-tick' }));
    const t = el('text', { x: r2(f.mid.x), y: r2(f.mid.y), transform: `rotate(${r2(f.ang)} ${r2(f.mid.x)} ${r2(f.mid.y)})`, dy: -3, 'font-size': r2(size), 'font-weight': 700, fill: color, 'text-anchor': 'middle', 'paint-order': 'stroke', stroke: '#fdfcf7', 'stroke-width': 3, class: 'dim-text' });
    t.textContent = text ?? fmt(f.len);
    g.append(t);
    return g;
  }

  /* ---------------- 自動尺寸（不保存） ---------------- */
  const isRectRoom = pts => pts.length === 4 && pts.every((p, i) => { const q = pts[(i + 1) % 4]; return Math.abs(p.x - q.x) < .5 || Math.abs(p.y - q.y) < .5; });
  const roomStroke = () => { const n = layer.querySelector('.plan-room'); const v = n && parseFloat(getComputedStyle(n).strokeWidth); return v > 0 ? v : 6; };
  function autoDims() {
    const g = el('g', { class: 'dim-auto', 'pointer-events': 'none' }), seen = new Set(), gap = roomStroke() / 2 + 14 * Math.max(1, viewScale());
    const key = (a, b) => [a, b].map(p => `${Math.round(p.x)},${Math.round(p.y)}`).sort().join('|');
    for (const it of items()) {
      if (it.type === 'room') {
        const pts = P.getPoints(it), rect = isRectRoom(pts);
        pts.forEach((a, i) => {
          const b = pts[(i + 1) % pts.length], len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 20) return;
          if (rect) { // 矩形只標上緣（寬）與左緣（深）
            const top = Math.abs(a.y - b.y) < .5 && Math.min(a.y, b.y) <= Math.min(...pts.map(p => p.y)) + .5;
            const left = Math.abs(a.x - b.x) < .5 && Math.min(a.x, b.x) <= Math.min(...pts.map(p => p.x)) + .5;
            if (!top && !left) return;
          }
          const k = key(a, b); if (seen.has(k)) return; seen.add(k);
          // 朝房間外側偏移
          const f = frame(a, b, 1), probe = { x: (a.x + b.x) / 2 + f.nx * 4, y: (a.y + b.y) / 2 + f.ny * 4 };
          const out = P.pointInPoly(probe, pts) ? -1 : 1;
          g.append(drawDim(a, b, out * gap, { cls: 'dim dim-room' }));
        });
      } else if (it.type === 'wall') {
        const a = { x: it.x1, y: it.y1 }, b = { x: it.x2, y: it.y2 };
        if (Math.hypot(b.x - a.x, b.y - a.y) < 20) continue;
        const t = (it.thickness ?? .3) * PX;
        g.append(drawDim(a, b, -(t / 2 + 14 * Math.max(1, viewScale())), { cls: 'dim dim-wall' }));
      }
    }
    return g;
  }

  /* ---------------- 手動尺寸 ---------------- */
  function resolveRef(ref) {
    const host = ref && byId(ref.id);
    if (!host) return null;
    if (host.type === 'room') { const pts = P.getPoints(host); return pts[ref.i] ? { ...pts[ref.i] } : null; }
    if (host.type === 'wall') return ref.i ? { x: host.x2, y: host.y2 } : { x: host.x1, y: host.y1 };
    return null;
  }
  // 依參照更新端點（房間或牆移動、改尺寸後標註跟著動）
  function syncManual(d) {
    let changed = false;
    for (const k of ['a', 'b']) {
      const ref = d[k + 'Ref']; if (!ref) continue;
      const p = resolveRef(ref), q = p && { x: r2(p.x), y: r2(p.y) };
      if (!q) { delete d[k + 'Ref']; changed = true; }
      else if (q.x !== d[k].x || q.y !== d[k].y) { d[k] = q; changed = true; }
    }
    return changed;
  }
  // 端點吸附：房間角點、牆端點；否則對齊 0.25 m 格線（按住 Alt 不吸附）
  function snapPoint(raw, alt) {
    if (!alt) {
      const lim = 14 * viewScale();
      let best = null;
      for (const it of items()) {
        const cand = it.type === 'room' ? P.getPoints(it).map((p, i) => ({ p, i })) : it.type === 'wall' ? [{ p: { x: it.x1, y: it.y1 }, i: 0 }, { p: { x: it.x2, y: it.y2 }, i: 1 }] : [];
        for (const c of cand) { const d = Math.hypot(c.p.x - raw.x, c.p.y - raw.y); if (d <= lim && (!best || d < best.d)) best = { d, p: c.p, ref: { id: it.id, i: c.i } }; }
      }
      if (best) return { p: { x: r2(best.p.x), y: r2(best.p.y) }, ref: best.ref };
      return { p: { x: P.snap(raw.x, 10), y: P.snap(raw.y, 10) }, ref: null };
    }
    return { p: { x: r2(raw.x), y: r2(raw.y) }, ref: null };
  }
  function manualDims() {
    const g = el('g', { class: 'dim-manual-layer' });
    let changed = false;
    for (const d of items()) {
      if (d.type !== 'dimension') continue;
      if (syncManual(d)) changed = true;
      const sel = P.selected === d.id;
      const node = drawDim(d.a, d.b, d.offset ?? 0, { cls: 'dim dim-manual' + (sel ? ' selected-dim' : ''), text: d.label || undefined, color: sel ? '#e76f4c' : INK });
      node.setAttribute('data-dim-id', d.id);
      const f = frame(d.a, d.b, d.offset ?? 0);
      // 透明點擊範圍（觸控友善）
      node.prepend(el('line', { x1: f.a2.x, y1: f.a2.y, x2: f.b2.x, y2: f.b2.y, class: 'dim-hit', stroke: 'transparent', 'stroke-width': 22 }));
      node.addEventListener('pointerdown', e => onDimDown(e, d, 'offset'));
      g.append(node);
      if (sel) {
        for (const k of ['a', 'b']) {
          const h = el('circle', { cx: d[k].x, cy: d[k].y, r: 8, class: 'dim-handle pro-ui' });
          h.addEventListener('pointerdown', e => onDimDown(e, d, k));
          g.append(h);
        }
      }
    }
    // 房間／牆變動後端點已跟著更新：補存一次（不另增復原步驟）
    if (changed && !drag && !P.svg.classList.contains('dragging')) P.persist('已儲存');
    return g;
  }
  function onDimDown(e, d, part) {
    if (e.button && e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    if (P.tool === 'erase') { deleteDim(d.id); return; }
    P.selected = d.id; P.editingRoomId = null;
    drag = { id: d.id, part, start: P.rawPoint(e), offset: d.offset ?? 0, before: P.snapshot(), moved: false };
    try { svg.setPointerCapture(e.pointerId); } catch {}
    P.render();
  }
  function deleteDim(id) {
    const before = P.snapshot();
    P.state.items = items().filter(i => i.id !== id);
    if (P.selected === id) P.selected = null;
    P.commit('尺寸標註已刪除', before);
    P.toast('尺寸標註已刪除');
  }

  /* ---------------- 指標事件 ---------------- */
  // 標註模式：在捕獲階段攔截，避免點到房間時變成選取／拖曳房間
  svg.addEventListener('pointerdown', e => {
    if (!dimMode || (e.button && e.button !== 0)) return;
    if (e.target.closest?.('.dim-manual, .dim-handle')) return; // 交給標註本身
    e.stopPropagation(); e.preventDefault();
    const s = snapPoint(P.rawPoint(e), e.altKey);
    draft = { a: s.p, aRef: s.ref, b: s.p, bRef: null };
    try { svg.setPointerCapture(e.pointerId); } catch {}
  }, true);

  P.hooks.pointermove.push(e => {
    if (draft) {
      const s = snapPoint(P.rawPoint(e), e.altKey);
      let b = s.p;
      if (e.shiftKey) { const dx = Math.abs(b.x - draft.a.x), dy = Math.abs(b.y - draft.a.y); b = dx >= dy ? { x: b.x, y: draft.a.y } : { x: draft.a.x, y: b.y }; }
      draft.b = b; draft.bRef = e.shiftKey ? null : s.ref;
      P.preview.querySelector('.dim-draft')?.remove();
      if (Math.hypot(b.x - draft.a.x, b.y - draft.a.y) > 2) { const g = drawDim(draft.a, b, 0, { cls: 'dim dim-draft', color: INK }); P.preview.append(g); }
      return true;
    }
    if (drag) {
      const d = byId(drag.id), p = P.rawPoint(e);
      if (!d) return true;
      if (drag.part === 'offset') {
        const f = frame(d.a, d.b, 0), delta = (p.x - drag.start.x) * f.nx + (p.y - drag.start.y) * f.ny;
        const next = e.altKey ? r2(drag.offset + delta) : Math.round((drag.offset + delta) / 2) * 2;
        if (next !== d.offset) { d.offset = next; drag.moved = true; P.render(); }
      } else {
        const s = snapPoint(p, e.altKey);
        d[drag.part] = s.p;
        if (s.ref) d[drag.part + 'Ref'] = s.ref; else delete d[drag.part + 'Ref'];
        drag.moved = true; P.render();
      }
      return true;
    }
    // 即時尺寸：在 app.js 畫完預覽後補上長度（microtask 於預覽之後執行）
    if (['wall', 'room'].includes(P.tool)) queueMicrotask(liveLabels);
  });
  P.hooks.pointerup.push(() => {
    if (draft) {
      const d = draft; draft = null;
      P.preview.querySelector('.dim-draft')?.remove();
      if (Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) < 10) { P.toast('尺寸線太短，請拖曳畫出量測範圍'); return true; }
      const item = { type: 'dimension', a: d.a, b: d.b, offset: 20, mode: 'manual', label: null };
      if (d.aRef) item.aRef = d.aRef;
      if (d.bRef) item.bRef = d.bRef;
      P.addItem(item);
      P.selected = items().at(-1).id; P.render();
      P.toast(`已建立尺寸標註 ${fmt(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y))}`);
      return true;
    }
    if (drag) {
      const m = drag; drag = null;
      if (m.moved) { P.pushHistory(m.before); P.persist('尺寸標註已更新'); P.render(); }
      return true;
    }
  });

  // 繪製中的即時長度
  function liveLabels() {
    P.preview.querySelector('.dim-live')?.remove();
    const wall = P.preview.querySelector('line.plan-wall.preview'), room = P.preview.querySelector('rect.plan-room.preview');
    const g = el('g', { class: 'dim-live', 'pointer-events': 'none' });
    if (wall) {
      const a = { x: +wall.getAttribute('x1'), y: +wall.getAttribute('y1') }, b = { x: +wall.getAttribute('x2'), y: +wall.getAttribute('y2') };
      if (Math.hypot(b.x - a.x, b.y - a.y) > 2) g.append(drawDim(a, b, -18 * Math.max(1, viewScale()), { cls: 'dim dim-live-line', color: INK }));
    }
    if (room) {
      const x = +room.getAttribute('x'), y = +room.getAttribute('y'), w = +room.getAttribute('width'), h = +room.getAttribute('height');
      const o = 16 * Math.max(1, viewScale());
      if (w > 2) g.append(drawDim({ x, y }, { x: x + w, y }, -o, { cls: 'dim dim-live-line', color: INK }));
      if (h > 2) g.append(drawDim({ x, y }, { x, y: y + h }, o, { cls: 'dim dim-live-line', color: INK }));
    }
    if (g.childNodes.length) P.preview.append(g);
  }

  /* ---------------- 繪製進圖層 ---------------- */
  P.hooks.afterRender.push(() => {
    layer.querySelectorAll(':scope > .dim-auto, :scope > .dim-manual-layer').forEach(n => n.remove());
    const before = layer.querySelector(':scope > .pro-ui');
    if (showAuto) layer.insertBefore(autoDims(), before);
    layer.insertBefore(manualDims(), before);
    updatePanel();
  });

  /* ---------------- 鍵盤 ---------------- */
  P.hooks.keydown.push(e => {
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (key === 'm') { setDimMode(!dimMode); return true; }
    if (e.key === 'Escape' && dimMode) { setDimMode(false); return true; }
    const sel = byId(P.selected);
    if (sel?.type === 'dimension' && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); deleteDim(sel.id); return true; }
  });

  /* ---------------- 畫布工具列（尺寸顯示／手動標註） ---------------- */
  const bar = document.createElement('div');
  bar.className = 'dim-toolbar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '尺寸標註');
  bar.innerHTML = '<button type="button" data-dim="auto" aria-pressed="false" title="顯示／隱藏自動尺寸">尺寸</button><button type="button" data-dim="manual" aria-pressed="false" title="手動標註（M）">標註</button>';
  ($('canvasWrap') || svg.parentElement).append(bar);
  const btnAuto = bar.querySelector('[data-dim="auto"]'), btnManual = bar.querySelector('[data-dim="manual"]');
  btnAuto.onclick = () => { showAuto = !showAuto; store.set('planhaus-dim-auto', showAuto); syncBar(); P.render(); P.toast(showAuto ? '已顯示自動尺寸' : '已隱藏自動尺寸'); };
  btnManual.onclick = () => setDimMode(!dimMode);
  function syncBar() { btnAuto.setAttribute('aria-pressed', String(showAuto)); btnManual.setAttribute('aria-pressed', String(dimMode)); svg.classList.toggle('dim-mode', dimMode); }
  function setDimMode(on) {
    dimMode = on;
    if (on && P.tool !== 'select') P.setTool('select');
    draft = null; P.preview.querySelector('.dim-draft')?.remove();
    syncBar();
    P.toast(on ? '標註模式：拖曳畫出尺寸線，Esc 結束' : '已結束標註模式');
  }
  // 切換到其他繪圖工具時結束標註模式
  document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => { if (dimMode && b.dataset.tool !== 'select') { dimMode = false; syncBar(); } }));
  syncBar();

  /* ---------------- 右側面板：選取尺寸線時 ---------------- */
  const panel = document.createElement('section');
  panel.id = 'dimPanel'; panel.className = 'panel-section hidden';
  panel.innerHTML = `<div class="section-title"><h3>尺寸標註</h3><button type="button" data-act="delete">刪除</button></div>
    <p class="dim-panel-len"></p>
    <label>自訂文字（留空顯示實際長度）<input data-key="label" maxlength="40" placeholder="例：3.60 m"></label>
    <label>偏移距離（m）<input data-key="offset" type="number" step="0.05"></label>`;
  ($('selectionPanel') || document.body).after(panel);
  panel.querySelector('[data-act="delete"]').onclick = () => { const d = byId(P.selected); if (d?.type === 'dimension') deleteDim(d.id); };
  panel.querySelectorAll('input').forEach(input => input.addEventListener('change', () => {
    const d = byId(P.selected); if (d?.type !== 'dimension') return;
    const before = P.snapshot();
    if (input.dataset.key === 'label') d.label = input.value.trim().slice(0, 40) || null;
    else { const v = Number(input.value); if (!Number.isFinite(v)) return; d.offset = r2(v * PX); }
    input.blur();
    P.commit('尺寸標註已更新', before);
  }));
  function updatePanel() {
    const d = byId(P.selected), on = d?.type === 'dimension';
    panel.classList.toggle('hidden', !on);
    if (on) {
      $('selectionPanel')?.classList.add('hidden');
      $('archPanel')?.classList.add('hidden');
      if (!panel.contains(document.activeElement)) {
        panel.querySelector('.dim-panel-len').textContent = `實際長度 ${fmt(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y))}` + (d.aRef || d.bRef ? '・已連結房間／牆' : '');
        panel.querySelector('[data-key="label"]').value = d.label || '';
        panel.querySelector('[data-key="offset"]').value = ((d.offset ?? 0) / PX).toFixed(2);
      }
    }
  }

  window.PlanhausDimensions = {
    get showAuto() { return showAuto; }, setShowAuto(v) { showAuto = !!v; store.set('planhaus-dim-auto', showAuto); syncBar(); P.render(); },
    get dimMode() { return dimMode; }, setDimMode, drawDim, frame, snapPoint, deleteDim
  };
  P.render();
})();
