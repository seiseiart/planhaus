/* 築間 Planhaus — 家具尺寸（Cloud）
 * 所有家具可改寬度（width）與深度（height，單位 m，沿用 app.js furnitureDims(item) 的欄位）。
 * 1. 選取家具時出現右下角縮放控制點：拖曳調整寬深，對角固定（靠牆的背面維持貼牆）；0.05 m 對齊，Alt 自由
 * 2. 右側「建築屬性」面板加入常用尺寸（例：單人床、雙人床、三人沙發）
 * 3. planhaus-pro.js 只對櫃體、結構柱顯示寬深欄位；其他家具由本模組補上同樣的欄位與 W×D 標註（不修改 pro.js，避免衝突）
 * 依賴 window.Planhaus 與 planhaus-pro.js 的 #archPanel；不修改 app.js。
 */
(() => {
  const P = window.Planhaus;
  if (!P) return;
  const { svg, layer, el } = P;
  const PX = 40, STEP = 2, MIN = 4; // 0.05 m、最小 0.1 m
  const byId = id => P.state.items.find(i => i.id === id);
  const r3 = n => Math.round(n * 1000) / 1000;

  // 常用尺寸（寬 × 深，m）
  const PRESETS = {
    bed: [['單人', .9, 1.9], ['單人加大', 1.05, 1.9], ['雙人', 1.5, 1.9], ['雙人加大', 1.8, 1.9]],
    sofa: [['單人', .9, .9], ['雙人', 1.6, .9], ['三人', 2.1, .9]],
    table: [['2 人', .8, .8], ['4 人', 1.2, .8], ['6 人', 1.6, .9]],
    desk: [['1.2 m', 1.2, .6], ['1.4 m', 1.4, .7]],
    island: [['1.8 m', 1.8, .9], ['2.4 m', 2.4, 1]],
    bathtub: [['1.5 m', 1.5, .75], ['1.7 m', 1.7, .75]],
    toilet: [['標準', .4, .7]],
    sink: [['單槽', .6, .45], ['雙槽', 1.2, .5]],
    cabinet: [['矮櫃', 1.2, .45], ['衣櫃', 1.8, .6], ['高櫃', .6, .6]],
    column: [['40 cm', .4, .4], ['60 cm', .6, .6], ['80 cm', .8, .8]],
    stairs: [['直梯', 1, 3], ['寬梯', 1.2, 3.6]],
    plant: [['小', .4, .4], ['大', .8, .8]]
  };

  let resize = null;
  function corner(it) {
    const d = P.furnitureDims(it), r = (it.rotation || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const lx = d.w / 2, ly = d.h / 2;
    return { x: it.x + lx * c - ly * s, y: it.y + lx * s + ly * c, d, c, s };
  }
  P.hooks.afterRender.push(() => {
    const it = byId(P.selected);
    if (it?.type === 'furniture') {
      const k = corner(it), g = el('g', { class: 'pro-ui fsize-ui' });
      const h = el('rect', { x: k.x - 7, y: k.y - 7, width: 14, height: 14, rx: 3, class: 'fsize-handle', transform: `rotate(${it.rotation || 0} ${k.x} ${k.y})` });
      const hit = el('circle', { cx: k.x, cy: k.y, r: 18, class: 'fsize-hit' });
      const title = el('title'); title.textContent = '拖曳調整寬度與深度（0.05 m 對齊，Alt 自由）';
      g.append(hit, h, title);
      g.addEventListener('pointerdown', e => {
        if (e.button && e.button !== 0) return;
        e.stopPropagation(); e.preventDefault();
        const d = P.furnitureDims(it);
        resize = { id: it.id, before: P.snapshot(), w0: d.w, h0: d.h, moved: false };
        try { svg.setPointerCapture(e.pointerId); } catch {}
      });
      // pro.js 未標註尺寸的家具，補上 W×D 標註
      if (!layer.querySelector('.rotate-ui .arch-annot')) {
        const d = k.d, L = d.h / 2 + 20, t = el('text', { x: it.x - k.s * L, y: it.y + k.c * L + 4, class: 'arch-annot pro-ui' });
        t.textContent = `W${(d.w / PX).toFixed(2)} × D${(d.h / PX).toFixed(2)}`;
        g.append(t);
      }
      layer.append(g);
      addSizeFields(it);
      addPresets(it);
    }
  });
  P.hooks.pointermove.push(e => {
    if (!resize) return;
    const it = byId(resize.id); if (!it) return true;
    const p = P.rawPoint(e), r = (it.rotation || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    // 對角（左上，本地 -w/2,-h/2）固定
    const d0 = P.furnitureDims(it), ax = it.x + (-d0.w / 2) * c - (-d0.h / 2) * s, ay = it.y + (-d0.w / 2) * s + (-d0.h / 2) * c;
    const vx = p.x - ax, vy = p.y - ay;
    let w = vx * c + vy * s, h = -vx * s + vy * c;
    if (!e.altKey) { w = Math.round(w / STEP) * STEP; h = Math.round(h / STEP) * STEP; }
    w = Math.max(MIN, w); h = Math.max(MIN, h);
    it.width = r3(w / PX); it.height = r3(h / PX);
    it.x = r3(ax + (w / 2) * c - (h / 2) * s); it.y = r3(ay + (w / 2) * s + (h / 2) * c);
    resize.moved = true;
    P.render();
    return true;
  });
  P.hooks.pointerup.push(() => {
    if (!resize) return;
    const m = resize; resize = null;
    if (m.moved) { P.pushHistory(m.before); P.persist('家具尺寸已更新'); P.render(); }
    return true;
  });

  // 寬度／深度欄位（若 pro.js 已提供則不重複）
  function addSizeFields(it) {
    const panel = document.getElementById('archPanel');
    if (!panel || panel.querySelector('input[data-key="width"]') || panel.contains(document.activeElement)) return;
    const d = P.furnitureDims(it), row = document.createElement('div'); row.className = 'field-row fsize-fields';
    [['寬度', 'width', d.w], ['深度', 'height', d.h]].forEach(([label, key, px]) => {
      const lab = document.createElement('label'), input = document.createElement('input');
      lab.textContent = `${label}（m）`;
      Object.assign(input, { type: 'number', min: .1, max: 12, step: .05, value: r3(px / PX) });
      input.dataset.fsize = key;
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (!(v >= .1 && v <= 12)) { P.toast('請輸入 0.1–12 之間的數值'); input.blur(); P.render(); return; }
        const cur = P.furnitureDims(it);
        input.blur();
        applySize(it, key === 'width' ? v : cur.w / PX, key === 'height' ? v : cur.h / PX);
      });
      lab.append(input); row.append(lab);
    });
    const head = panel.querySelector('.section-title');
    head ? head.after(row) : panel.prepend(row);
  }

  function addPresets(it) {
    const panel = document.getElementById('archPanel');
    const list = PRESETS[it.name];
    if (!panel || !list || panel.querySelector('.fsize-presets')) return;
    const wrap = document.createElement('div'); wrap.className = 'fsize-presets';
    const label = document.createElement('span'); label.textContent = '常用尺寸'; wrap.append(label);
    const d = P.furnitureDims(it);
    list.forEach(([name, w, h]) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mini-btn';
      b.textContent = `${name} ${w}×${h}`;
      if (Math.abs(d.w - w * PX) < .5 && Math.abs(d.h - h * PX) < .5) b.classList.add('active');
      b.onclick = () => applySize(it, w, h);
      wrap.append(b);
    });
    panel.append(wrap);
  }
  // 套用尺寸：以左上角為基準（與拖曳一致，靠牆背面不動）
  function applySize(it, w, h) {
    const before = P.snapshot(), d0 = P.furnitureDims(it), r = (it.rotation || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const ax = it.x + (-d0.w / 2) * c - (-d0.h / 2) * s, ay = it.y + (-d0.w / 2) * s + (-d0.h / 2) * c, W = w * PX, H = h * PX;
    it.width = w; it.height = h;
    it.x = r3(ax + (W / 2) * c - (H / 2) * s); it.y = r3(ay + (W / 2) * s + (H / 2) * c);
    P.commit('家具尺寸已更新', before);
  }

  const css = document.createElement('style');
  css.id = 'planhaus-furniture-size-style';
  css.textContent = `.fsize-handle{fill:#fff;stroke:#e76f4c;stroke-width:2.5;pointer-events:none;filter:url(#shadow)}
.fsize-hit{fill:transparent;cursor:nwse-resize}
#archPanel .fsize-presets{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:center}
#archPanel .fsize-presets span{width:100%;font-size:11px;color:#7d8d8f}
#archPanel .fsize-presets .mini-btn{height:auto;min-height:32px}
#archPanel .fsize-presets .mini-btn.active{border-color:#d86c4a;background:#fff0e9;color:#a5432d}
@media (pointer:coarse){.fsize-hit{r:24}#archPanel .fsize-presets .mini-btn{min-height:44px}}`;
  document.head.append(css);

  window.PlanhausFurnitureSize = { PRESETS, applySize };
  P.render();
})();
