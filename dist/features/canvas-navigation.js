/* Planhaus canvas navigation: middle/Space pan and two-finger pinch. */
(() => {
  const P = window.Planhaus;
  if (!P) return;
  const { svg } = P;
  let spaceHeld = false;
  let mousePan = null;
  let pinch = null;
  const touches = new Map();
  const suppressedTouches = new Set();

  const isInput = target => target?.closest?.('input,textarea,select,button,[contenteditable="true"]');
  const isCanvasSurface = target => target === svg || target?.id === 'gridRect';
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const center = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function setPanCursor(on) {
    svg.classList.toggle('canvas-pan-ready', on);
  }

  document.addEventListener('keydown', event => {
    if (event.code !== 'Space' || isInput(event.target) || isInput(document.activeElement)) return;
    event.preventDefault();
    spaceHeld = true;
    setPanCursor(true);
  }, true);

  document.addEventListener('keyup', event => {
    if (event.code !== 'Space') return;
    spaceHeld = false;
    if (!mousePan) setPanCursor(false);
  }, true);

  window.addEventListener('blur', () => {
    spaceHeld = false;
    mousePan = null;
    pinch = null;
    touches.clear();
    suppressedTouches.clear();
    setPanCursor(false);
  });

  svg.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY, surface: isCanvasSurface(event.target) });
      const candidates = [...touches.entries()].filter(([, point]) => point.surface);
      if (candidates.length === 2) {
        const [[idA, a], [idB, b]] = candidates;
        const c = center(a, b);
        pinch = {
          ids: [idA, idB],
          distance: Math.max(1, distance(a, b)),
          anchor: P.screenToPlan(c.x, c.y),
          view: { ...P.view }
        };
        suppressedTouches.add(idA);
        suppressedTouches.add(idB);
        P.cancelInteraction();
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }

    const wantsPan = event.button === 1 || (event.button === 0 && spaceHeld);
    if (!wantsPan) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    mousePan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      view: { ...P.view }
    };
    try { svg.setPointerCapture(event.pointerId); } catch {}
    setPanCursor(true);
  }, true);

  svg.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' && touches.has(event.pointerId)) {
      const current = touches.get(event.pointerId);
      touches.set(event.pointerId, { ...current, x: event.clientX, y: event.clientY });
      if (pinch) {
        const [a, b] = pinch.ids.map(id => touches.get(id));
        if (a && b) {
          const c = center(a, b), scale = distance(a, b) / pinch.distance;
          const w = Math.max(300, Math.min(3000, pinch.view.w / scale));
          const h = w * 760 / 1200;
          const current = P.screenToPlan(c.x, c.y);
          const rx = (current.x - P.view.x) / P.view.w;
          const ry = (current.y - P.view.y) / P.view.h;
          P.setView({ x: pinch.anchor.x - rx * w, y: pinch.anchor.y - ry * h, w, h });
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (suppressedTouches.has(event.pointerId)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }

    if (!mousePan || event.pointerId !== mousePan.pointerId) return;
    const box = svg.getBoundingClientRect();
    const dx = (event.clientX - mousePan.x) * mousePan.view.w / box.width;
    const dy = (event.clientY - mousePan.y) * mousePan.view.h / box.height;
    P.setView({ x: mousePan.view.x - dx, y: mousePan.view.y - dy });
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  function endPointer(event) {
    if (event.pointerType === 'touch') {
      touches.delete(event.pointerId);
      if (pinch?.ids.includes(event.pointerId)) pinch = null;
      if (suppressedTouches.has(event.pointerId)) {
        suppressedTouches.delete(event.pointerId);
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (!mousePan || event.pointerId !== mousePan.pointerId) return;
    mousePan = null;
    if (!spaceHeld) setPanCursor(false);
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  svg.addEventListener('pointerup', endPointer, true);
  svg.addEventListener('pointercancel', endPointer, true);
})();
