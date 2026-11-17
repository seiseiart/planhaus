/* Planhaus portable SVG/PNG export and print-to-PDF workflow. */
(() => {
  const P = window.Planhaus;
  if (!P) return;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const styleProps = [
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'stroke-opacity', 'opacity', 'font-family', 'font-size',
    'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'paint-order'
  ];

  function safeName(value) {
    return (value || '房屋平面圖').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  }

  function portableSvg() {
    const originals = [P.svg, ...P.svg.querySelectorAll('*')];
    const copy = P.svg.cloneNode(true);
    const clones = [copy, ...copy.querySelectorAll('*')];
    originals.forEach((node, index) => {
      const target = clones[index];
      if (!target || !(node instanceof Element)) return;
      const computed = getComputedStyle(node);
      const inline = styleProps.map(prop => `${prop}:${computed.getPropertyValue(prop)}`).join(';');
      target.setAttribute('style', inline);
    });
    copy.querySelector('#previewLayer')?.remove();
    copy.querySelectorAll('.vertex-handle,.edge-handle,.rotate-ui,.pro-ui,.opening-hit').forEach(node => node.remove());
    copy.querySelectorAll('.selected,.shape-editing').forEach(node => node.classList.remove('selected', 'shape-editing'));
    copy.setAttribute('xmlns', SVG_NS);
    copy.setAttribute('viewBox', '0 0 1200 760');
    copy.setAttribute('width', '1200');
    copy.setAttribute('height', '760');
    const background = document.createElementNS(SVG_NS, 'rect');
    background.setAttribute('x', '0'); background.setAttribute('y', '0');
    background.setAttribute('width', '1200'); background.setAttribute('height', '760');
    background.setAttribute('fill', '#fdfcf7');
    const defs = copy.querySelector('defs');
    if (defs?.nextSibling) copy.insertBefore(background, defs.nextSibling);
    else copy.prepend(background);
    return copy;
  }

  function serialize() {
    return new XMLSerializer().serializeToString(portableSvg());
  }

  function download(blob, extension) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${safeName(P.state.project)}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1200);
  }

  function exportSvg() {
    download(new Blob([serialize()], { type: 'image/svg+xml;charset=utf-8' }), 'svg');
    P.toast('已匯出可攜式 SVG');
  }

  async function exportPng() {
    const source = serialize();
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = 2400; canvas.height = 1520;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fdfcf7'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG 產生失敗');
    download(blob, 'png');
    P.toast('已匯出高解析 PNG');
  }

  function printPdf() {
    const win = window.open('', '_blank', 'popup');
    if (!win) { P.toast('瀏覽器封鎖了列印視窗'); return; }
    win.opener = null;
    const title = String(P.state.project || '房屋平面圖').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
    win.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${title}</title><style>@page{size:A4 landscape;margin:10mm}html,body{margin:0;background:#fff;font-family:sans-serif}main{display:grid;gap:5mm}h1{margin:0;font-size:16pt;color:#17324d}svg{display:block;width:100%;height:auto;max-height:170mm}</style></head><body><main><h1>${title}</h1>${serialize()}</main><script>addEventListener('load',()=>{setTimeout(()=>{print();},120)})<\/script></body></html>`);
    win.document.close();
  }

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop export-modal hidden';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'exportModalTitle');
  modal.innerHTML = `<div class="modal-card export-card">
    <span class="eyebrow">PLANHAUS · 輸出</span>
    <h2 id="exportModalTitle">匯出圖面</h2>
    <p>輸出的 SVG 會內嵌目前樣式；PNG 為 2400 × 1520；列印可在瀏覽器選擇「另存為 PDF」。</p>
    <div class="export-options">
      <button class="primary-btn" data-export="svg">匯出 SVG</button>
      <button class="secondary-btn" data-export="png">匯出 PNG</button>
      <button class="secondary-btn" data-export="pdf">列印／儲存 PDF</button>
    </div>
    <div class="modal-actions"><button class="secondary-btn" data-export="close">關閉</button></div>
  </div>`;
  document.body.append(modal);

  function close() { modal.classList.add('hidden'); }
  modal.addEventListener('click', async event => {
    if (event.target === modal) return close();
    const action = event.target.closest('[data-export]')?.dataset.export;
    if (!action) return;
    try {
      if (action === 'svg') exportSvg();
      else if (action === 'png') await exportPng();
      else if (action === 'pdf') printPdf();
      else if (action === 'close') return close();
      close();
    } catch (error) {
      P.toast('輸出失敗：' + error.message);
    }
  });

  document.querySelector('#exportBtn').onclick = () => {
    modal.classList.remove('hidden');
    modal.querySelector('[data-export="svg"]').focus();
  };
})();
