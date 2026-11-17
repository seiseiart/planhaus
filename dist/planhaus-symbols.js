/* 築間 Planhaus — 建築平面圖例（依國內常用門窗、樓梯、電梯、坡道圖例繪製）
 * 圖形以「本地座標」繪製：開口中心為原點，牆沿 x 軸，+y 為開啟側。
 * 沿用 Codex 的資料模型：門 swing('in'|'out')、hinge('left'|'right')；窗 flipped（app.js 已轉 180°）。
 * 單開門的 x,y 是鉸鏈點（hinge left → 開口在 [0,w]，right → [-w,0]），其他開口 x,y 為中心。
 * 線色、線寬寫在屬性上，匯出 SVG 也會保留。
 */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const INK = '#17324d', CORE = '#b9c2c1', BG = '#fdfcf7';
  function el(tag, attrs = {}) { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v !== undefined) n.setAttribute(k, v); return n; }
  const thin = { stroke: INK, 'stroke-width': 1.1, fill: 'none' };
  const mid = { stroke: INK, 'stroke-width': 1.6, fill: 'none' };
  const leaf = { stroke: INK, 'stroke-width': 2.6, 'stroke-linecap': 'butt', fill: 'none' };
  const L = (x1, y1, x2, y2, a = thin) => el('line', { x1, y1, x2, y2, ...a });
  const Pth = (d, a = thin) => el('path', { d, ...a });
  const R = (x, y, w, h, a = thin) => el('rect', { x, y, width: w, height: h, ...a });
  const f = n => Math.round(n * 100) / 100;

  // 門扇：鉸鏈在 (hx,0)，門扇長 len 朝 dir(+1=+y / -1=-y) 開，弧線回到 (hx - side*len, 0)
  function swingLeaf(hx, len, side, dir = 1, dashed = false) {
    const tipY = dir * len, endX = hx - side * len;
    // side=+1：鉸鏈在右端，弧線向左；SVG y 向下，角度遞增＝順時針
    const sweep = (side > 0) === (dir > 0) ? 1 : 0;
    const da = dashed ? { 'stroke-dasharray': '4 3' } : {};
    return [
      L(hx, 0, hx, f(tipY), { ...leaf, ...da }),
      Pth(`M ${hx} ${f(tipY)} A ${f(len)} ${f(len)} 0 0 ${sweep} ${f(endX)} 0`, { ...thin, ...da })
    ];
  }
  function arrow(x1, y, x2) {
    const d = Math.sign(x2 - x1) || 1;
    return [L(x1, y, x2, y), Pth(`M ${x2 - d * 5} ${y - 3} L ${x2} ${y} L ${x2 - d * 5} ${y + 3}`)];
  }

  const DOOR_SWING = new Set(['single', 'mother', 'double', 'swing']);

  /** 開口圖例。w=開口寬(px)、t=牆厚(px)、flip=鉸鏈在 +x 端 */
  function opening(it, w, t) {
    const h = w / 2, ht = t / 2, kind = it.kind || (it.type === 'door' ? 'single' : 'fixed');
    const s = it.hinge === 'right' ? 1 : -1; // 鉸鏈端：-1 = 左(-x)、+1 = 右(+x)
    const out = [];
    // 牆體開口：以底色遮住牆，並補上兩側牆端線
    out.push(R(-h, -ht - .6, w, t + 1.2, { fill: BG, stroke: 'none', class: 'opening-gap' }));
    out.push(L(-h, -ht, -h, ht, mid), L(h, -ht, h, ht, mid));
    // 與 app.js 相同的開口標記（供驗證與其他模組辨識），本身不可見
    out.push(el('line', { x1: -h, y1: 0, x2: h, y2: 0, class: 'plan-opening-cut', style: 'display:none' }));

    if (it.type === 'door') {
      switch (kind) {
        case 'single': out.push(...swingLeaf(s * h, w, s)); break;
        case 'mother': { const a = w * 2 / 3, b = w - a; out.push(...swingLeaf(s * h, a, s), ...swingLeaf(-s * h, b, -s)); break; }
        case 'double': out.push(...swingLeaf(-h, h, -1), ...swingLeaf(h, h, 1)); break;
        case 'swing': out.push(...swingLeaf(-h, h, -1), ...swingLeaf(h, h, 1), ...swingLeaf(-h, h, -1, -1, true), ...swingLeaf(h, h, 1, -1, true)); break;
        case 'sliding': // 單拉門：門片偏一側，箭頭為滑動方向（往鉸鏈端）
          out.push(R(-h, f(ht * .15), w, 3, { ...mid, fill: '#fff' }), ...arrow(-s * h * .5, f(ht + 7), s * h * .5)); break;
        case 'doublesliding': // 雙拉門（對開）
          out.push(L(-h, 0, -2, 0, leaf), L(2, 0, h, 0, leaf), el('circle', { cx: 0, cy: 0, r: 1.8, fill: INK })); break;
        case 'bypass': { // 雙向拉門：兩片錯開
          const pw = w * .55;
          out.push(R(-h, f(-ht * .3 - 1.5), f(pw), 3, { ...mid, fill: '#fff' }), R(f(h - pw), f(ht * .3 - 1.5), f(pw), 3, { ...mid, fill: '#fff' }),
            ...arrow(-h * .1, f(ht + 7), -h * .7), ...arrow(h * .1, f(ht + 7), h * .7)); break;
        }
        case 'pocket': // 拉進門：門片收入牆內（虛線）
          out.push(R(-h, -1.5, w, 3, { ...mid, fill: '#fff' }), L(s * h, 0, f(s * (h + w * .9)), 0, { ...mid, stroke: '#fff', 'stroke-width': 2.4 }),
            L(s * h, 0, f(s * (h + w * .9)), 0, { ...thin, 'stroke-dasharray': '3 2' })); break;
        case 'folding': { const n = 4, a = Math.min(9, w * .12); let d = `M ${-h} 0`; for (let i = 1; i <= n; i++) d += ` L ${f(-h + (w * (i - .5)) / n)} ${f(a)} L ${f(-h + (w * i) / n)} 0`; out.push(Pth(d, mid)); break; }
        case 'revolving': { const r = h, k = r * .7071; out.push(el('circle', { cx: 0, cy: 0, r: f(r), ...mid, fill: '#fff' }), L(f(-k), f(-k), f(k), f(k), mid), L(f(-k), f(k), f(k), f(-k), mid)); break; }
        case 'rolling': out.push(L(-h, 0, h, 0, { ...thin, 'stroke-dasharray': '7 3 1.5 3' })); break;
        case 'curtain': { let d = `M ${-h} 0`; const n = Math.max(4, Math.round(w / 8)); for (let i = 0; i < n; i++) d += ` q ${f(w / n / 2)} ${i % 2 ? 4 : -4} ${f(w / n)} 0`; out.push(Pth(d)); break; }
        case 'entry': { const y = -ht - 6; out.push(Pth(`M -6 ${f(y - 7)} L 6 ${f(y - 7)} L 0 ${f(y)} Z`, { ...thin, fill: '#fff' }), L(-3.5, f(y - 4.5), 3.5, f(y - 4.5))); break; }
      }
    } else {
      out.push(L(-h, -ht, h, -ht), L(-h, ht, h, ht)); // 窗框
      switch (kind) {
        case 'opening': break; // 牆開窗：僅開口
        case 'fixed': out.push(L(-h, -1.2, h, -1.2), L(-h, 1.2, h, 1.2)); break;
        case 'slider': out.push(L(-h, -1.6, f(h * .1), -1.6, mid), L(f(-h * .1), 1.6, h, 1.6, mid)); break;
        case 'louver': out.push(L(-h, 0, h, 0, { ...mid, 'stroke-dasharray': '3 2' })); break;
        case 'casement': out.push(L(-h, 0, h, 0), ...swingLeaf(s * h, w, s, -1).map(n => { n.setAttribute('transform', `translate(0 ${-ht})`); return n; })); break;
        case 'screen': out.push(L(-h, 0, h, 0), L(-h, f(-ht - 3), h, f(-ht - 3), { ...thin, 'stroke-dasharray': '2 2' })); break;
        case 'bay': { const d = Math.min(26, w * .3); out.push(L(-h, 0, h, 0), Pth(`M ${-h} ${-ht} L ${f(-h + d)} ${f(-ht - d)} L ${f(h - d)} ${f(-ht - d)} L ${h} ${-ht}`, mid)); break; }
      }
    }
    // 透明點擊範圍
    const swingDepth = it.type === 'door' && DOOR_SWING.has(kind) ? (kind === 'single' ? w : kind === 'mother' ? w * 2 / 3 : h) : ht + 8;
    const top = it.type === 'door' && kind === 'swing' ? -h : Math.min(-18, -ht - 10);
    out.push(R(-h, f(top), w, f(Math.max(18, swingDepth) - top), { fill: 'transparent', stroke: 'none', class: 'opening-hit' }));
    return out;
  }
  // 選取標註所在深度（本地 y）
  function annotDepth(it, w, t) {
    const kind = it.kind || 'single';
    if (it.type === 'door' && DOOR_SWING.has(kind)) return (kind === 'single' ? w : kind === 'mother' ? w * 2 / 3 : w / 2) + 14;
    return t / 2 + 18;
  }

  /** 特殊設施：樓梯、電梯、坡道（其他家具回傳 null 沿用原繪製） */
  function facility(name, d) {
    const w = d.w, h = d.h, x0 = -w / 2, y0 = -h / 2, out = [];
    if (name === 'stairs') {
      out.push(R(x0, y0, w, h, { ...mid, fill: '#fff' }));
      const n = 10; for (let i = 1; i < n; i++) out.push(L(x0, f(y0 + (h * i) / n), -x0, f(y0 + (h * i) / n)));
      out.push(L(0, f(-y0 - 6), 0, f(y0 + 8), mid), Pth(`M -4 ${f(y0 + 14)} L 0 ${f(y0 + 7)} L 4 ${f(y0 + 14)}`, mid), el('circle', { cx: 0, cy: f(-y0 - 6), r: 2, fill: INK }));
      const t = el('text', { x: f(w / 4), y: f(-y0 - 5), 'font-size': 8, 'font-weight': 700, fill: INK, 'text-anchor': 'middle' }); t.textContent = 'UP'; out.push(t);
    } else if (name === 'elevator') {
      const m = 6;
      out.push(R(x0, y0, w, h, { ...leaf, fill: '#fff' }), R(x0 + m, y0 + m, w - 2 * m, h - 2 * m - 4, mid),
        L(x0 + m, y0 + m, -x0 - m, -y0 - m - 4), L(-x0 - m, y0 + m, x0 + m, -y0 - m - 4), L(f(-w / 4), -y0, f(w / 4), -y0, { stroke: '#fff', 'stroke-width': 3 }));
    } else if (name === 'ramp') {
      out.push(R(x0, y0, w, h, { ...mid, fill: '#fff' }), el('circle', { cx: x0 + 8, cy: 0, r: 2.4, fill: INK }), L(x0 + 8, 0, -x0 - 8, 0, mid), Pth(`M ${-x0 - 16} -5 L ${-x0 - 8} 0 L ${-x0 - 16} 5`, mid));
    } else return null;
    return out;
  }

  /** 牆體帶：外框深色粗線＋內部淺灰（類似圖例的雙線填灰） */
  function wallBand(points, t, closed, selected) {
    const pts = points.map(p => `${f(p.x)},${f(p.y)}`).join(' ');
    const tag = closed ? 'polygon' : 'polyline';
    const common = { points: pts, fill: 'none', 'stroke-linejoin': 'miter', 'stroke-linecap': 'square', 'pointer-events': 'none' };
    return [el(tag, { ...common, stroke: selected ? '#e76f4c' : INK, 'stroke-width': f(t) }), el(tag, { ...common, stroke: CORE, 'stroke-width': f(Math.max(1, t - 2.6)) })];
  }

  /** 依 Codex 資料模型產生開口圖形群組（放進 app.js 已旋轉的節點內，使用世界座標） */
  function openingGroup(it, w, t) {
    const single = it.type === 'door' && (it.kind || 'single') === 'single';
    const cx = single ? (it.hinge === 'right' ? -w / 2 : w / 2) : 0;
    const sy = it.type === 'door' && it.swing === 'out' ? -1 : 1;
    const g = el('g', { transform: `translate(${f(it.x + cx)} ${f(it.y)}) scale(1 ${sy})` });
    g.append(...opening(it, w, t));
    return g;
  }
  // 開口中心在本地 x 的位移（單開門以鉸鏈為原點）
  const centerOffset = (it, w) => it.type === 'door' && (it.kind || 'single') === 'single' ? (it.hinge === 'right' ? -w / 2 : w / 2) : 0;

  // 圖例專用樣式（不改 styles.css）：選取時改成橘色、取消 .selected 繼承的虛線
  const css = document.createElement('style');
  css.id = 'planhaus-symbols-style';
  css.textContent = `.plan-symbol{cursor:move}.plan-symbol.selected{stroke-dasharray:none}
.plan-symbol.selected line,.plan-symbol.selected path,.plan-symbol.selected circle,.plan-symbol.selected polyline{stroke:#d86c4a}
.plan-symbol.selected .opening-gap{stroke:none!important}.room-wall-core{pointer-events:none}`;
  document.head.append(css);

  window.PlanhausSymbols = { opening, openingGroup, centerOffset, annotDepth, facility, wallBand, el, INK, DOOR_SWING };
})();
