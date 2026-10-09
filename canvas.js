/* ============================================================
   canvas.js — Dibujo, herramientas, figuras, selección, texto
   Editor de Imagenes JPB
   ============================================================ */

import { state, els, setStatus, pushHistory, markDirty, syncWrapSize, updateFooterInfo } from './app.js';
import { floodFill, pickColor, drawShape } from './tools.js';

let mainCanvas, overlayCanvas, mainCtx, overlayCtx;
let floatingCanvas, floatingCtx, floatingLayer, floatRect;

const draw = {
  active: false,
  startX: 0, startY: 0,
  lastX: 0, lastY: 0,
  pointers: new Map(),
  twoFingerActive: false,
  pinchStartDist: 0,
  pinchStartZoom: 1,
  panStartX: 0, panStartY: 0,
  panStartScrollX: 0, panStartScrollY: 0,
  firstTouchTimer: null,
  spacePanning: false,
  panning: false,
  panPointerId: null,

  selection: null,
  floating: null,
  lastShape: null,
  textBox: null
};

/* ============================================================
   INIT
   ============================================================ */
export function initCanvas() {
  mainCanvas     = document.getElementById('mainCanvas');
  overlayCanvas  = document.getElementById('overlayCanvas');
  floatingCanvas = document.getElementById('floatingCanvas');
  floatingLayer  = document.getElementById('floatingLayer');
  floatRect      = document.getElementById('floatRect');

  mainCtx       = mainCanvas.getContext('2d', { willReadFrequently: true });
  overlayCtx    = overlayCanvas.getContext('2d');
  floatingCtx   = floatingCanvas.getContext('2d', { willReadFrequently: true });

  mainCanvas.width = 600;
  mainCanvas.height = 800;
  overlayCanvas.width = 600;
  overlayCanvas.height = 800;

  syncWrapSize();

  overlayCanvas.style.pointerEvents = 'auto';
  overlayCanvas.style.touchAction = 'none';
  overlayCanvas.addEventListener('pointerdown', onPointerDown);
  overlayCanvas.addEventListener('pointermove', onPointerMove);
  overlayCanvas.addEventListener('pointerup',   onPointerUp);
  overlayCanvas.addEventListener('pointercancel', onPointerUp);

  els.canvasScroll.addEventListener('wheel', onWheel, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !draw.spacePanning) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      draw.spacePanning = true;
      els.canvasWrap.dataset.cursor = 'pan';
      e.preventDefault();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      draw.spacePanning = false;
      els.canvasWrap.dataset.cursor = state.tool;
    }
  });

  initHandles();
  initShapeHandles();
  initFloatHandles();
  initTextEditor();

  let lastTap = 0;
  overlayCanvas.addEventListener('touchend', (e) => {
    if (e.touches.length > 0) return;
    const now = Date.now();
    if (now - lastTap < 300) {
      if (state.zoom < 1.5) zoom100(); else zoomFit();
      lastTap = 0;
    } else {
      lastTap = now;
    }
  });
}

export function getMainCanvas()    { return mainCanvas; }
export function getOverlayCanvas() { return overlayCanvas; }
export function getZoom()          { return state.zoom; }

export function getActiveSelection() {
  if (draw.floating && draw.floating.source === 'selection') {
    return {
      rect: {
        x: Math.round(draw.floating.x),
        y: Math.round(draw.floating.y),
        w: Math.round(draw.floating.w),
        h: Math.round(draw.floating.h)
      },
      floating: true
    };
  }
  if (draw.selection) {
    const { x0, y0, x1, y1 } = draw.selection;
    const rx = Math.round(Math.min(x0, x1));
    const ry = Math.round(Math.min(y0, y1));
    const rw = Math.round(Math.abs(x1 - x0));
    const rh = Math.round(Math.abs(y1 - y0));
    if (rw > 1 && rh > 1) return { rect: { x: rx, y: ry, w: rw, h: rh }, floating: false };
  }
  return null;
}

/* ============================================================
   HERRAMIENTA
   ============================================================ */
export function setTool(tool) {
  state.tool = tool;
  els.canvasWrap.dataset.cursor = tool;
  if (!tool.startsWith('shape-')) clearShapeSelection();
  if (tool !== 'text') commitTextBox();
}

/* ============================================================
   COORDENADAS
   ============================================================ */
function getCanvasCoords(clientX, clientY) {
  const rect = overlayCanvas.getBoundingClientRect();
  const scaleX = overlayCanvas.width  / rect.width;
  const scaleY = overlayCanvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top)  * scaleY
  };
}

/* ============================================================
   POINTERS
   ============================================================ */
function onPointerDown(e) {
  if (draw.textBox && !draw.textBox.committed) {
    const editor = els.textEditor;
    if (editor && !editor.contains(e.target)) {
      commitTextBox();
    } else {
      return;
    }
  }

  overlayCanvas.setPointerCapture?.(e.pointerId);
  draw.pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });

  if (draw.spacePanning) { startPan(e); return; }

  if (draw.pointers.size === 2) {
    clearTimeout(draw.firstTouchTimer);
    draw.twoFingerActive = true;
    abortDrawing();
    startPinch();
    return;
  }
  if (draw.twoFingerActive) return;

  if (e.pointerType === 'touch') {
    draw.firstTouchTimer = setTimeout(() => beginStroke(e), 90);
  } else {
    beginStroke(e);
  }
}

function onPointerMove(e) {
  const rec = draw.pointers.get(e.pointerId);
  if (rec) { rec.x = e.clientX; rec.y = e.clientY; }

  if (draw.panning && e.pointerId === draw.panPointerId) { updatePan(e); return; }
  if (draw.twoFingerActive && draw.pointers.size >= 2) { updatePinch(); return; }
  if (!draw.active) return;

  const { x, y } = getCanvasCoords(e.clientX, e.clientY);
  continueStroke(x, y, e);
}

function onPointerUp(e) {
  clearTimeout(draw.firstTouchTimer);
  draw.pointers.delete(e.pointerId);

  if (draw.panning && e.pointerId === draw.panPointerId) { endPan(); return; }
  if (draw.twoFingerActive && draw.pointers.size < 2) { draw.twoFingerActive = false; return; }
  if (draw.active) endStroke();
}

/* ─── Pan ─────────────────────────────────────────────────── */
function startPan(e) {
  draw.panning = true;
  draw.panPointerId = e.pointerId;
  draw.panStartX = e.clientX;
  draw.panStartY = e.clientY;
  draw.panStartScrollX = els.canvasScroll.scrollLeft;
  draw.panStartScrollY = els.canvasScroll.scrollTop;
  els.canvasWrap.classList.add('panning');
}
function updatePan(e) {
  const dx = e.clientX - draw.panStartX;
  const dy = e.clientY - draw.panStartY;
  els.canvasScroll.scrollLeft = draw.panStartScrollX - dx;
  els.canvasScroll.scrollTop  = draw.panStartScrollY - dy;
}
function endPan() {
  draw.panning = false;
  draw.panPointerId = null;
  els.canvasWrap.classList.remove('panning');
}

/* ─── Pinch ───────────────────────────────────────────────── */
function startPinch() {
  const pts = [...draw.pointers.values()];
  if (pts.length < 2) return;
  const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  draw.pinchStartDist = dist;
  draw.pinchStartZoom = state.zoom;
  draw.panStartX = (pts[0].x + pts[1].x) / 2;
  draw.panStartY = (pts[0].y + pts[1].y) / 2;
  draw.panStartScrollX = els.canvasScroll.scrollLeft;
  draw.panStartScrollY = els.canvasScroll.scrollTop;
}
function updatePinch() {
  const pts = [...draw.pointers.values()];
  if (pts.length < 2) return;
  const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  const cx = (pts[0].x + pts[1].x) / 2;
  const cy = (pts[0].y + pts[1].y) / 2;
  const scale = dist / draw.pinchStartDist;
  const newZoom = Math.max(0.05, Math.min(20, draw.pinchStartZoom * scale));
  applyZoom(newZoom, cx, cy);
  const dx = cx - draw.panStartX;
  const dy = cy - draw.panStartY;
  els.canvasScroll.scrollLeft = draw.panStartScrollX - dx;
  els.canvasScroll.scrollTop  = draw.panStartScrollY - dy;
}

/* ============================================================
   TRAZOS
   ============================================================ */
function beginStroke(e) {
  if (draw.twoFingerActive) return;

  if (draw.floating) {
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);
    if (!isPointInFloating(x, y)) {
      commitFloating();
    } else {
      return;
    }
  }

  if (draw.lastShape && els.shapeHandles && !els.shapeHandles.hidden) {
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);
    if (isPointInLastShape(x, y)) {
      startShapeDrag(e);
      return;
    } else {
      clearShapeSelection();
      return;
    }
  }

  const { x, y } = getCanvasCoords(e.clientX, e.clientY);
  const tool = state.tool;

  draw.active = true;
  draw.startX = x; draw.startY = y;
  draw.lastX = x;  draw.lastY = y;

  if (tool === 'picker') {
    const color = pickColor(mainCtx, Math.round(x), Math.round(y));
    if (color) {
      state.primary = color;
      const input = document.getElementById('colorPrimary');
      const swatch = document.getElementById('colorBtnSwatch');
      if (input) input.value = color;
      if (swatch) swatch.style.background = color;
      setStatus(`Color elegido: ${color}`);
    }
    draw.active = false;
    return;
  }
  if (tool === 'fill') {
    floodFill(mainCtx, Math.round(x), Math.round(y), state.secondary, mainCanvas.width, mainCanvas.height);
    pushHistory(); markDirty();
    draw.active = false;
    return;
  }
  if (tool === 'text') {
    createTextBox(x, y);
    draw.active = false;
    return;
  }
  if (tool.startsWith('select')) { beginSelection(x, y); return; }
  if (tool === 'eraser') mainCtx.globalCompositeOperation = 'destination-out';
  if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') drawDot(mainCtx, x, y);
}

function continueStroke(x, y, e) {
  const tool = state.tool;
  if (tool.startsWith('select')) { updateSelection(x, y); return; }
  if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') {
    interpolateLine(draw.lastX, draw.lastY, x, y, (px, py) => drawDot(mainCtx, px, py));
    draw.lastX = x; draw.lastY = y;
    return;
  }
  if (tool.startsWith('shape-')) {
    draw.lastX = x; draw.lastY = y;
    drawShapePreview(draw.startX, draw.startY, x, y, tool);
    return;
  }
}

function endStroke() {
  const tool = state.tool;
  if (tool.startsWith('select')) { finishSelection(); draw.active = false; return; }
  if (tool.startsWith('shape-')) {
    commitShape(draw.startX, draw.startY, draw.lastX, draw.lastY, tool);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    pushHistory(); markDirty();
    showShapeHandles(draw.startX, draw.startY, draw.lastX, draw.lastY, tool);
  }
  if (tool === 'eraser') mainCtx.globalCompositeOperation = 'source-over';
  if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') { pushHistory(); markDirty(); }
  draw.active = false;
}

function abortDrawing() {
  if (!draw.active) return;
  draw.active = false;
  mainCtx.globalCompositeOperation = 'source-over';
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

/* ============================================================
   DIBUJO
   ============================================================ */
function drawDot(ctx, x, y) {
  const tool = state.tool;
  const size = tool === 'eraser' ? Math.max(4, state.strokeSize * 2) : state.strokeSize;
  ctx.globalAlpha = state.opacity;

  if (tool === 'pencil') {
    ctx.fillStyle = state.primary;
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (tool === 'brush') {
    const g = ctx.createRadialGradient(x, y, 0, x, y, size);
    g.addColorStop(0, hexToRgba(state.primary, 1));
    g.addColorStop(0.7, hexToRgba(state.primary, 0.7));
    g.addColorStop(1, hexToRgba(state.primary, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  } else if (tool === 'eraser') {
    if (!state.transparentBg) {
      mainCtx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = state.secondary;
    }
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function interpolateLine(x0, y0, x1, y1, cb) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(1, state.strokeSize / 3);
  const steps = Math.max(1, Math.floor(dist / step));
  for (let i = 1; i <= steps; i++) cb(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
}

/* ============================================================
   FIGURAS
   ============================================================ */
function drawShapePreview(x0, y0, x1, y1, tool) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  const ctx = overlayCtx;
  ctx.save();
  ctx.globalAlpha = state.opacity;
  ctx.strokeStyle = state.primary;
  ctx.fillStyle = state.secondary;
  ctx.lineWidth = state.strokeSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (state.strokeStyle === 'dashed') ctx.setLineDash([state.strokeSize * 3, state.strokeSize * 2]);
  if (state.strokeStyle === 'dotted') ctx.setLineDash([state.strokeSize, state.strokeSize * 2]);
  drawShape(ctx, tool, x0, y0, x1, y1, {
    stroke: state.primary,
    fill: state.shapeFill === 'solid' ? state.secondary : null,
    lineWidth: state.strokeSize
  });
  ctx.restore();
}

function commitShape(x0, y0, x1, y1, tool) {
  mainCtx.save();
  mainCtx.globalAlpha = state.opacity;
  mainCtx.strokeStyle = state.primary;
  mainCtx.fillStyle = state.secondary;
  mainCtx.lineWidth = state.strokeSize;
  mainCtx.lineCap = 'round';
  mainCtx.lineJoin = 'round';
  if (state.strokeStyle === 'dashed') mainCtx.setLineDash([state.strokeSize * 3, state.strokeSize * 2]);
  if (state.strokeStyle === 'dotted') mainCtx.setLineDash([state.strokeSize, state.strokeSize * 2]);
  drawShape(mainCtx, tool, x0, y0, x1, y1, {
    stroke: state.primary,
    fill: state.shapeFill === 'solid' ? state.secondary : null,
    lineWidth: state.strokeSize
  });
  mainCtx.restore();
}

/* ============================================================
   HANDLES DE FIGURA
   ============================================================ */
function initShapeHandles() {
  const container = document.getElementById('shapeHandles');
  if (!container) return;
  container.querySelectorAll('.shape-handle').forEach((h) => {
    h.addEventListener('pointerdown', onShapeHandleDown);
  });
  container.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('shape-handle')) return;
    startShapeDrag(e);
  });
}

function isPointInLastShape(x, y) {
  const sh = draw.lastShape;
  if (!sh) return false;
  let px = x, py = y;
  if (sh.rotation) {
    const cx = sh.x + sh.w / 2;
    const cy = sh.y + sh.h / 2;
    const cos = Math.cos(-sh.rotation);
    const sin = Math.sin(-sh.rotation);
    const dx = x - cx, dy = y - cy;
    px = cx + (dx * cos - dy * sin);
    py = cy + (dx * sin + dy * cos);
  }
  return px >= sh.x && px <= sh.x + sh.w && py >= sh.y && py <= sh.y + sh.h;
}

function startShapeDrag(e) {
  const sh = draw.lastShape;
  if (!sh) return;

  e.preventDefault();
  e.stopPropagation();

  const startClientX = e.clientX;
  const startClientY = e.clientY;
  const origX = sh.x;
  const origY = sh.y;
  const zoom = state.zoom || 1;

  const move = (ev) => {
    sh.x = Math.round(origX + (ev.clientX - startClientX) / zoom);
    sh.y = Math.round(origY + (ev.clientY - startClientY) / zoom);
    renderShapeHandles();
    previewShapeOnOverlay();
  };

  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    redrawLastShape();
    updateCurrentHistoryEntry();
    markDirty();
    renderShapeHandles();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function showShapeHandles(x0, y0, x1, y1, tool) {
  const rx = Math.min(x0, x1);
  const ry = Math.min(y0, y1);
  const rw = Math.abs(x1 - x0);
  const rh = Math.abs(y1 - y0);
  if (rw < 3 || rh < 3) return;

  const beforeSnapshot = getSnapshotBeforeCurrentShape();
  draw.lastShape = { x: rx, y: ry, w: rw, h: rh, rotation: 0, tool, beforeSnapshot };
  renderShapeHandles();
}

function getSnapshotBeforeCurrentShape() {
  const idx = state.historyIndex;
  if (idx >= 1) {
    const prev = state.history[idx - 1];
    if (prev) {
      if (prev.snapshot instanceof ImageData) {
        return new ImageData(new Uint8ClampedArray(prev.snapshot.data), prev.snapshot.width, prev.snapshot.height);
      } else if (prev.snapshot && prev.snapshot.dataURL) {
        return { dataURL: prev.snapshot.dataURL, w: prev.w, h: prev.h };
      }
    }
  }
  return null;
}

function renderShapeHandles() {
  const sh = draw.lastShape;
  const container = document.getElementById('shapeHandles');
  if (!container) return;
  if (!sh) { container.hidden = true; return; }
  container.hidden = false;
  container.style.left = `${sh.x}px`;
  container.style.top = `${sh.y}px`;
  container.style.width = `${sh.w}px`;
  container.style.height = `${sh.h}px`;
  container.style.transform = sh.rotation ? `rotate(${sh.rotation}rad)` : '';
  container.style.transformOrigin = 'center center';
}

export function clearShapeSelection() {
  draw.lastShape = null;
  const sh = document.getElementById('shapeHandles');
  if (sh) { sh.hidden = true; sh.style.transform = ''; }
}

function redrawLastShape() {
  const sh = draw.lastShape;
  if (!sh) return;
  if (sh.beforeSnapshot instanceof ImageData) {
    mainCtx.putImageData(sh.beforeSnapshot, 0, 0);
  } else if (sh.beforeSnapshot && sh.beforeSnapshot.dataURL) {
    const img = new Image();
    img.onload = () => {
      mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
      if (!state.transparentBg) {
        mainCtx.fillStyle = '#ffffff';
        mainCtx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
      }
      mainCtx.drawImage(img, 0, 0);
      drawLastShapeOnMain();
    };
    img.src = sh.beforeSnapshot.dataURL;
    return;
  }
  drawLastShapeOnMain();
}

function drawLastShapeOnMain() {
  const sh = draw.lastShape;
  if (!sh) return;
  mainCtx.save();
  if (sh.rotation) {
    const cx = sh.x + sh.w / 2;
    const cy = sh.y + sh.h / 2;
    mainCtx.translate(cx, cy);
    mainCtx.rotate(sh.rotation);
    mainCtx.translate(-cx, -cy);
  }
  mainCtx.globalAlpha = state.opacity;
  mainCtx.strokeStyle = state.primary;
  mainCtx.fillStyle = state.secondary;
  mainCtx.lineWidth = state.strokeSize;
  mainCtx.lineCap = 'round';
  mainCtx.lineJoin = 'round';
  if (state.strokeStyle === 'dashed') mainCtx.setLineDash([state.strokeSize * 3, state.strokeSize * 2]);
  if (state.strokeStyle === 'dotted') mainCtx.setLineDash([state.strokeSize, state.strokeSize * 2]);
  drawShape(mainCtx, sh.tool, sh.x, sh.y, sh.x + sh.w, sh.y + sh.h, {
    stroke: state.primary,
    fill: state.shapeFill === 'solid' ? state.secondary : null,
    lineWidth: state.strokeSize
  });
  mainCtx.restore();
}

function previewShapeOnOverlay() {
  const sh = draw.lastShape;
  if (!sh) return;
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  overlayCtx.save();
  if (sh.rotation) {
    const cx = sh.x + sh.w / 2;
    const cy = sh.y + sh.h / 2;
    overlayCtx.translate(cx, cy);
    overlayCtx.rotate(sh.rotation);
    overlayCtx.translate(-cx, -cy);
  }
  overlayCtx.globalAlpha = state.opacity;
  overlayCtx.strokeStyle = state.primary;
  overlayCtx.fillStyle = state.secondary;
  overlayCtx.lineWidth = state.strokeSize;
  overlayCtx.lineCap = 'round';
  overlayCtx.lineJoin = 'round';
  if (state.strokeStyle === 'dashed') overlayCtx.setLineDash([state.strokeSize * 3, state.strokeSize * 2]);
  if (state.strokeStyle === 'dotted') overlayCtx.setLineDash([state.strokeSize, state.strokeSize * 2]);
  drawShape(overlayCtx, sh.tool, sh.x, sh.y, sh.x + sh.w, sh.y + sh.h, {
    stroke: state.primary,
    fill: state.shapeFill === 'solid' ? state.secondary : null,
    lineWidth: state.strokeSize
  });
  overlayCtx.restore();
}

function onShapeHandleDown(e) {
  const sh = draw.lastShape;
  if (!sh) return;
  e.preventDefault();
  e.stopPropagation();
  const dir = e.currentTarget.dataset.sh;
  const startClientX = e.clientX, startClientY = e.clientY;
  const orig = { x: sh.x, y: sh.y, w: sh.w, h: sh.h, rotation: sh.rotation };
  const zoom = state.zoom || 1;

  const move = (ev) => {
    const dx = (ev.clientX - startClientX) / zoom;
    const dy = (ev.clientY - startClientY) / zoom;

    if (dir === 'rotate') {
      const rect = overlayCanvas.getBoundingClientRect();
      const cxCanvas = (orig.x + orig.w / 2) * zoom + rect.left;
      const cyCanvas = (orig.y + orig.h / 2) * zoom + rect.top;
      const angle = Math.atan2(ev.clientY - cyCanvas, ev.clientX - cxCanvas);
      sh.rotation = angle + Math.PI / 2;
    } else {
      let nx = orig.x, ny = orig.y, nw = orig.w, nh = orig.h;
      if (dir.includes('e')) nw = Math.max(8, orig.w + dx);
      if (dir.includes('w')) { nx = orig.x + dx; nw = Math.max(8, orig.w - dx); }
      if (dir.includes('s')) nh = Math.max(8, orig.h + dy);
      if (dir.includes('n')) { ny = orig.y + dy; nh = Math.max(8, orig.h - dy); }
      sh.x = Math.round(nx); sh.y = Math.round(ny);
      sh.w = Math.round(nw); sh.h = Math.round(nh);
    }
    renderShapeHandles();
    previewShapeOnOverlay();
  };

  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    redrawLastShape();
    updateCurrentHistoryEntry();
    markDirty();
    renderShapeHandles();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function updateCurrentHistoryEntry() {
  const entry = state.history[state.historyIndex];
  if (!entry) return;
  try {
    entry.snapshot = mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height);
  } catch (e) {
    entry.snapshot = { dataURL: mainCanvas.toDataURL(), w: mainCanvas.width, h: mainCanvas.height };
  }
}

/* ============================================================
   SELECCIÓN
   ============================================================ */
function beginSelection(x, y) {
  if (draw.floating) commitFloating();
  draw.selection = { x0: x, y0: y, x1: x, y1: y, lasso: state.tool === 'select-lasso' ? [{ x, y }] : null };
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function updateSelection(x, y) {
  if (!draw.selection) return;
  draw.selection.x1 = x;
  draw.selection.y1 = y;
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (state.tool === 'select-lasso') {
    if (!draw.selection.lasso) draw.selection.lasso = [];
    draw.selection.lasso.push({ x, y });
    overlayCtx.save();
    overlayCtx.strokeStyle = '#4f46e5';
    overlayCtx.lineWidth = 1.5;
    overlayCtx.setLineDash([6, 4]);
    overlayCtx.beginPath();
    const L = draw.selection.lasso;
    overlayCtx.moveTo(L[0].x, L[0].y);
    for (const pt of L) overlayCtx.lineTo(pt.x, pt.y);
    overlayCtx.closePath();
    overlayCtx.stroke();
    overlayCtx.restore();
  } else {
    const { x0, y0, x1, y1 } = draw.selection;
    const rx = Math.min(x0, x1), ry = Math.min(y0, y1);
    const rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
    overlayCtx.save();
    overlayCtx.strokeStyle = '#4f46e5';
    overlayCtx.lineWidth = 1.5;
    overlayCtx.setLineDash([6, 4]);
    overlayCtx.strokeRect(rx, ry, rw, rh);
    overlayCtx.fillStyle = 'rgba(79,70,229,0.08)';
    overlayCtx.fillRect(rx, ry, rw, rh);
    overlayCtx.restore();
  }
}

function finishSelection() {
  if (!draw.selection) return;
  const { x0, y0, x1, y1 } = draw.selection;
  const rx = Math.round(Math.min(x0, x1));
  const ry = Math.round(Math.min(y0, y1));
  const rw = Math.round(Math.abs(x1 - x0));
  const rh = Math.round(Math.abs(y1 - y0));
  if (rw < 3 || rh < 3) {
    draw.selection = null;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    return;
  }

  const data = mainCtx.getImageData(rx, ry, rw, rh);
  floatingCanvas.width = rw;
  floatingCanvas.height = rh;
  floatingCtx.clearRect(0, 0, rw, rh);
  floatingCtx.putImageData(data, 0, 0);

  if (state.transparentBg) {
    mainCtx.clearRect(rx, ry, rw, rh);
  } else {
    mainCtx.fillStyle = '#ffffff';
    mainCtx.fillRect(rx, ry, rw, rh);
  }

  draw.floating = { x: rx, y: ry, w: rw, h: rh, rotation: 0, source: 'selection' };
  renderFloating();
  pushHistory(); markDirty();

  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  draw.selection = null;
  setStatus(`Selección flotante: ${rw} × ${rh} px`);
}

/* ============================================================
   PEGAR COMO FLOTANTE
   ============================================================ */
export async function pasteAsFloating(blob) {
  try {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (draw.floating) commitFloating();

      const maxW = mainCanvas.width * 0.7;
      const maxH = mainCanvas.height * 0.7;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxW) { h = h * (maxW / w); w = maxW; }
      if (h > maxH) { w = w * (maxH / h); h = maxH; }

      floatingCanvas.width = Math.round(w);
      floatingCanvas.height = Math.round(h);
      floatingCtx.clearRect(0, 0, w, h);
      floatingCtx.drawImage(img, 0, 0, w, h);

      const x = Math.round((mainCanvas.width - w) / 2);
      const y = Math.round((mainCanvas.height - h) / 2);

      draw.floating = { x, y, w: Math.round(w), h: Math.round(h), rotation: 0, source: 'paste' };
      renderFloating();
      setStatus(`Pegado: ${Math.round(w)} × ${Math.round(h)} px`);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus('No se pudo pegar la imagen');
    };
    img.src = url;
  } catch (e) {
    setStatus('Error al pegar');
  }
}

/* ============================================================
   FLOTANTE
   ============================================================ */
function renderFloating() {
  if (!draw.floating) {
    floatingLayer.hidden = true;
    return;
  }
  const f = draw.floating;
  floatingLayer.hidden = false;
  floatingLayer.style.left = `${f.x}px`;
  floatingLayer.style.top  = `${f.y}px`;
  floatingLayer.style.width  = `${f.w}px`;
  floatingLayer.style.height = `${f.h}px`;
  floatingLayer.style.transform = f.rotation ? `rotate(${f.rotation}rad)` : '';
  floatingLayer.style.transformOrigin = 'center center';

  if (floatingCanvas.width !== Math.round(f.w) || floatingCanvas.height !== Math.round(f.h)) {
    const tmp = document.createElement('canvas');
    tmp.width = floatingCanvas.width;
    tmp.height = floatingCanvas.height;
    tmp.getContext('2d').drawImage(floatingCanvas, 0, 0);
    floatingCanvas.width = Math.round(f.w);
    floatingCanvas.height = Math.round(f.h);
    floatingCtx.clearRect(0, 0, f.w, f.h);
    floatingCtx.drawImage(tmp, 0, 0, f.w, f.h);
  }

  floatRect.style.width  = `${f.w}px`;
  floatRect.style.height = `${f.h}px`;
  floatRect.style.left = '0';
  floatRect.style.top  = '0';
}

function isPointInFloating(x, y) {
  const f = draw.floating;
  if (!f) return false;
  return x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h;
}

export function commitFloating() {
  if (!draw.floating) return;
  const f = draw.floating;

  mainCtx.save();
  if (f.rotation) {
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    mainCtx.translate(cx, cy);
    mainCtx.rotate(f.rotation);
    mainCtx.translate(-cx, -cy);
  }
  mainCtx.drawImage(floatingCanvas, f.x, f.y, f.w, f.h);
  mainCtx.restore();

  draw.floating = null;
  floatingLayer.hidden = true;
  floatingLayer.style.transform = '';
  pushHistory(); markDirty();
  setStatus('Selección fijada');
}

function initFloatHandles() {
  if (!floatRect) return;
  floatRect.querySelectorAll('.float-handle').forEach((h) => {
    h.addEventListener('pointerdown', onFloatHandleDown);
  });
  floatRect.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('float-handle')) return;
    onFloatDragMove(e);
  });
}

function onFloatDragMove(e) {
  const f = draw.floating;
  if (!f) return;
  e.preventDefault();
  e.stopPropagation();

  const startClientX = e.clientX, startClientY = e.clientY;
  const origX = f.x, origY = f.y;
  const zoom = state.zoom || 1;

  const move = (ev) => {
    f.x = Math.round(origX + (ev.clientX - startClientX) / zoom);
    f.y = Math.round(origY + (ev.clientY - startClientY) / zoom);
    renderFloating();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function onFloatHandleDown(e) {
  const f = draw.floating;
  if (!f) return;
  e.preventDefault();
  e.stopPropagation();

  const dir = e.currentTarget.dataset.fh;
  const startClientX = e.clientX, startClientY = e.clientY;
  const orig = { x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation };
  const zoom = state.zoom || 1;

  const move = (ev) => {
    const dx = (ev.clientX - startClientX) / zoom;
    const dy = (ev.clientY - startClientY) / zoom;

    if (dir === 'rotate') {
      const rect = floatingLayer.getBoundingClientRect();
      const cxClient = rect.left + rect.width / 2;
      const cyClient = rect.top  + rect.height / 2;
      const angle = Math.atan2(ev.clientY - cyClient, ev.clientX - cxClient);
      f.rotation = angle + Math.PI / 2;
    } else {
      let nx = orig.x, ny = orig.y, nw = orig.w, nh = orig.h;
      if (dir.includes('e')) nw = Math.max(8, orig.w + dx);
      if (dir.includes('w')) { nx = orig.x + dx; nw = Math.max(8, orig.w - dx); }
      if (dir.includes('s')) nh = Math.max(8, orig.h + dy);
      if (dir.includes('n')) { ny = orig.y + dy; nh = Math.max(8, orig.h - dy); }
      f.x = Math.round(nx); f.y = Math.round(ny);
      f.w = Math.round(nw); f.h = Math.round(nh);
    }
    renderFloating();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ============================================================
   EDITOR DE TEXTO FLOTANTE
   ============================================================ */
function initTextEditor() {
  const editor = els.textEditor;
  if (!editor) return;

  els.teFont.addEventListener('change', applyTextStyles);
  els.teSize.addEventListener('input', applyTextStyles);
  els.teBold.addEventListener('click', () => { els.teBold.classList.toggle('active'); applyTextStyles(); });
  els.teItalic.addEventListener('click', () => { els.teItalic.classList.toggle('active'); applyTextStyles(); });
  els.teUnderline.addEventListener('click', () => { els.teUnderline.classList.toggle('active'); applyTextStyles(); });
  els.teColor.addEventListener('input', applyTextStyles);
  els.teBg.addEventListener('input', () => { els.teNoBg.checked = false; applyTextStyles(); });
  els.teNoBg.addEventListener('change', applyTextStyles);

  els.teOk.addEventListener('click', (e) => { e.stopPropagation(); commitTextBox(); });
  els.teCancel.addEventListener('click', (e) => { e.stopPropagation(); cancelTextBox(); });

  editor.querySelectorAll('.te-float-handle').forEach((h) => {
    h.addEventListener('pointerdown', onTextHandleDown);
  });

  // ✅ Asa de arrastre dedicada (más confiable que arrastrar toda la barra)
  const drag = document.getElementById('teDragHandle');
  if (drag) {
    drag.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onTextEditorDrag(e);
    });
  }

  // También permitimos arrastrar desde la barra en zonas vacías (por si el asa no está visible)
  const toolbar = document.getElementById('textToolbar');
  toolbar.addEventListener('pointerdown', (e) => {
    // Ignoramos clicks en controles interactivos
    if (e.target.closest('button, input, select, label')) return;
    // Ignoramos si es el propio asa (ya lo maneja su propio listener)
    if (e.target.closest('#teDragHandle')) return;
    onTextEditorDrag(e);
  });

  editor.addEventListener('pointerdown', (e) => e.stopPropagation());
  editor.addEventListener('click', (e) => e.stopPropagation());
}

function createTextBox(x, y) {
  if (draw.textBox && !draw.textBox.committed) commitTextBox();

  const w = 320, h = 120;
  const cx = Math.max(0, Math.min(mainCanvas.width  - w, Math.round(x - w / 2)));
  const cy = Math.max(0, Math.min(mainCanvas.height - h, Math.round(y - h / 2)));

  draw.textBox = {
    x: cx, y: cy, w, h, rotation: 0, committed: false,
    html: '', styles: captureTextStyles()
  };

  const editor = els.textEditor;
  editor.hidden = false;
  editor.style.left = `${cx}px`;
  editor.style.top  = `${cy}px`;
  editor.style.width  = `${w}px`;
  editor.style.height = `${h}px`;
  editor.style.transform = '';

  els.teText.innerHTML = '';
  // ✅ Fondo transparente por defecto
  els.teNoBg.checked = true;
  applyTextStyles();
  els.teText.focus();
  setStatus('Editor de texto: escribe y pulsa ✓ o haz clic fuera');
}

function captureTextStyles() {
  return {
    fontFamily: els.teFont.value,
    fontSize:   Number(els.teSize.value) || 32,
    bold:       els.teBold.classList.contains('active'),
    italic:     els.teItalic.classList.contains('active'),
    underline:  els.teUnderline.classList.contains('active'),
    color:      els.teColor.value,
    background: els.teNoBg.checked ? null : els.teBg.value
  };
}

function applyTextStyles() {
  const t = els.teText;
  if (!t) return;
  const s = captureTextStyles();
  t.style.fontFamily = s.fontFamily;
  t.style.fontSize   = `${s.fontSize}px`;
  t.style.fontWeight = s.bold ? 'bold' : 'normal';
  t.style.fontStyle  = s.italic ? 'italic' : 'normal';
  t.style.textDecoration = s.underline ? 'underline' : 'none';
  t.style.color = s.color;
  // ✅ Fondo transparente cuando "Sin fondo" está activo
  t.style.background = s.background ? s.background : 'transparent';
  if (draw.textBox) draw.textBox.styles = s;
}

function onTextEditorDrag(e) {
  const tb = draw.textBox;
  if (!tb) return;
  e.preventDefault();
  e.stopPropagation();

  const startX = e.clientX, startY = e.clientY;
  const ox = tb.x, oy = tb.y;

  const move = (ev) => {
    tb.x = Math.max(-tb.w + 40, Math.min(mainCanvas.width - 40, ox + (ev.clientX - startX)));
    tb.y = Math.max(-20, Math.min(mainCanvas.height - 20, oy + (ev.clientY - startY)));
    updateTextEditorPosition();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function onTextHandleDown(e) {
  const tb = draw.textBox;
  if (!tb) return;
  e.preventDefault();
  e.stopPropagation();

  const dir = e.currentTarget.dataset.th;
  const startX = e.clientX, startY = e.clientY;
  const o = { x: tb.x, y: tb.y, w: tb.w, h: tb.h };

  const move = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;

    if (dir === 'se') {
      tb.w = Math.max(80, o.w + dx);
      tb.h = Math.max(60, o.h + dy);
    } else if (dir === 'sw') {
      tb.x = o.x + dx;
      tb.w = Math.max(80, o.w - dx);
      tb.h = Math.max(60, o.h + dy);
    } else if (dir === 'ne') {
      tb.y = o.y + dy;
      tb.w = Math.max(80, o.w + dx);
      tb.h = Math.max(60, o.h - dy);
    } else if (dir === 'nw') {
      tb.x = o.x + dx;
      tb.y = o.y + dy;
      tb.w = Math.max(80, o.w - dx);
      tb.h = Math.max(60, o.h - dy);
    }
    updateTextEditorPosition();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function updateTextEditorPosition() {
  const tb = draw.textBox;
  const editor = els.textEditor;
  if (!tb || !editor) return;
  editor.style.left = `${tb.x}px`;
  editor.style.top  = `${tb.y}px`;
  editor.style.width  = `${tb.w}px`;
  editor.style.height = `${tb.h}px`;
  editor.style.transform = tb.rotation ? `rotate(${tb.rotation}rad)` : '';
  editor.style.transformOrigin = 'center center';
}

export function commitTextBox() {
  const tb = draw.textBox;
  if (!tb || tb.committed) return;
  const text = els.teText.innerText.replace(/\u00A0/g, ' ');

  if (text.trim()) {
    const s = tb.styles || captureTextStyles();
    const lineHeight = s.fontSize * 1.25;
    const pad = 6;

    mainCtx.save();
    if (tb.rotation) {
      const cx = tb.x + tb.w / 2;
      const cy = tb.y + tb.h / 2;
      mainCtx.translate(cx, cy);
      mainCtx.rotate(tb.rotation);
      mainCtx.translate(-cx, -cy);
    }

    if (s.background) {
      mainCtx.fillStyle = s.background;
      mainCtx.fillRect(tb.x, tb.y, tb.w, tb.h);
    }

    mainCtx.font = `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${s.fontSize}px ${s.fontFamily}`;
    mainCtx.fillStyle = s.color;
    mainCtx.textBaseline = 'top';

    const lines = text.split('\n');
    lines.forEach((ln, i) => {
      const ty = tb.y + pad + i * lineHeight;
      mainCtx.fillText(ln, tb.x + pad, ty);
      if (s.underline) {
        const w = mainCtx.measureText(ln).width;
        mainCtx.fillRect(tb.x + pad, ty + s.fontSize * 1.05, w, 1.5);
      }
    });

    mainCtx.restore();
    pushHistory(); markDirty();
  }

  draw.textBox.committed = true;
  els.textEditor.hidden = true;
  draw.textBox = null;
  setStatus('Texto insertado');
}

function cancelTextBox() {
  if (!draw.textBox) return;
  draw.textBox.committed = true;
  els.textEditor.hidden = true;
  draw.textBox = null;
  setStatus('Texto cancelado');
}

/* ============================================================
   TRANSFORMACIONES
   ============================================================ */
export function doRotate(dir) {
  commitFloating();
  commitTextBox();
  clearShapeSelection();
  const w = mainCanvas.width, h = mainCanvas.height;
  const tmp = document.createElement('canvas');
  tmp.width = h; tmp.height = w;
  const tctx = tmp.getContext('2d');
  tctx.translate(h / 2, w / 2);
  tctx.rotate(dir * Math.PI / 2);
  tctx.drawImage(mainCanvas, -w / 2, -h / 2);

  mainCanvas.width = h; mainCanvas.height = w;
  overlayCanvas.width = h; overlayCanvas.height = w;
  mainCtx.drawImage(tmp, 0, 0);
  syncWrapSize(); updateFooterInfo();
  setStatus(`Rotado ${dir > 0 ? '90° →' : '90° ←'}`);
  requestAnimationFrame(() => zoomFit());
}

export function doFlip(axis) {
  commitFloating();
  commitTextBox();
  clearShapeSelection();
  const w = mainCanvas.width, h = mainCanvas.height;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').drawImage(mainCanvas, 0, 0);

  mainCtx.save();
  mainCtx.clearRect(0, 0, w, h);
  if (axis === 'h') { mainCtx.translate(w, 0); mainCtx.scale(-1, 1); }
  else              { mainCtx.translate(0, h); mainCtx.scale(1, -1); }
  mainCtx.drawImage(tmp, 0, 0);
  mainCtx.restore();
  setStatus(`Volteado ${axis === 'h' ? 'horizontal' : 'vertical'}`);
}

export function doResize(w, h) {
  commitFloating();
  commitTextBox();
  clearShapeSelection();
  const tmp = document.createElement('canvas');
  tmp.width = mainCanvas.width; tmp.height = mainCanvas.height;
  tmp.getContext('2d').drawImage(mainCanvas, 0, 0);

  mainCanvas.width = w; mainCanvas.height = h;
  overlayCanvas.width = w; overlayCanvas.height = h;

  mainCtx.imageSmoothingEnabled = true;
  mainCtx.imageSmoothingQuality = 'high';
  mainCtx.drawImage(tmp, 0, 0, w, h);
  syncWrapSize(); updateFooterInfo();
}

export function doCrop() {
  setStatus('Usa la herramienta de selección y luego el botón Recortar');
}

export function cropToSelection(rect) {
  commitFloating();
  clearShapeSelection();
  const { x, y, w, h } = rect;
  if (w < 1 || h < 1) return;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').drawImage(mainCanvas, x, y, w, h, 0, 0, w, h);

  mainCanvas.width = w; mainCanvas.height = h;
  overlayCanvas.width = w; overlayCanvas.height = h;
  mainCtx.drawImage(tmp, 0, 0);

  syncWrapSize(); updateFooterInfo();
  requestAnimationFrame(() => zoomFit());
}

/* ============================================================
   HANDLES DEL CANVAS
   ============================================================ */
function initHandles() {
  document.querySelectorAll('.handle').forEach((h) => {
    h.addEventListener('pointerdown', onHandleDown);
  });
}

function onHandleDown(e) {
  e.stopPropagation();
  e.preventDefault();
  const dir = e.currentTarget.dataset.handle;
  const startX = e.clientX, startY = e.clientY;
  const c = mainCanvas;
  const startW = c.width, startH = c.height;
  const zoomVal = state.zoom;

  const move = (ev) => {
    const dx = (ev.clientX - startX) / zoomVal;
    const dy = (ev.clientY - startY) / zoomVal;
    let nw = startW, nh = startH;
    if (dir.includes('e')) nw = Math.max(8, startW + dx);
    if (dir.includes('w')) nw = Math.max(8, startW - dx);
    if (dir.includes('s')) nh = Math.max(8, startH + dy);
    if (dir.includes('n')) nh = Math.max(8, startH - dy);
    els.canvasWrap.style.width  = `${nw}px`;
    els.canvasWrap.style.height = `${nh}px`;
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    const nw = parseFloat(els.canvasWrap.style.width)  || startW;
    const nh = parseFloat(els.canvasWrap.style.height) || startH;
    els.canvasWrap.style.width = ''; els.canvasWrap.style.height = '';
    if (Math.round(nw) !== startW || Math.round(nh) !== startH) {
      doResize(Math.round(nw), Math.round(nh));
      pushHistory(); markDirty();
      setStatus(`Redimensionado a ${Math.round(nw)} × ${Math.round(nh)} px`);
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ============================================================
   ZOOM
   ============================================================ */
function applyZoom(newZoom, centerClientX, centerClientY) {
  const scroll = els.canvasScroll;
  const rect = scroll.getBoundingClientRect();
  const sx = centerClientX - rect.left + scroll.scrollLeft;
  const sy = centerClientY - rect.top  + scroll.scrollTop;
  const ratio = newZoom / state.zoom;
  state.zoom = newZoom;

  els.canvasWrap.style.transformOrigin = '0 0';
  els.canvasWrap.style.transform = `scale(${newZoom})`;
  els.canvasWrap.style.width  = `${mainCanvas.width}px`;
  els.canvasWrap.style.height = `${mainCanvas.height}px`;

  scroll.scrollLeft = sx * ratio - (centerClientX - rect.left);
  scroll.scrollTop  = sy * ratio - (centerClientY - rect.top);

  scaleHandles(newZoom);
  document.getElementById('stZoom').textContent = Math.round(newZoom * 100) + '%';
}

function scaleHandles(z) {
  const scale = 1 / z;
  els.handles.querySelectorAll('.handle').forEach((h) => {
    h.style.transform = `scale(${Math.min(2, Math.max(0.5, scale))})`;
  });
  els.canvasWrap.classList.toggle('show-handles', z < 5);
}

export function zoom(factor, centerX, centerY) {
  const rect = els.canvasScroll.getBoundingClientRect();
  const cx = centerX ?? rect.left + rect.width / 2;
  const cy = centerY ?? rect.top + rect.height / 2;
  const newZoom = Math.max(0.05, Math.min(20, state.zoom * factor));
  applyZoom(newZoom, cx, cy);
}

export function zoomFit() {
  if (!mainCanvas.width || !mainCanvas.height) return;
  const scroll = els.canvasScroll;
  const rect = scroll.getBoundingClientRect();

  state.zoom = 1;
  els.canvasWrap.style.transform = 'scale(1)';
  els.canvasWrap.style.transformOrigin = '0 0';
  els.canvasWrap.style.width  = `${mainCanvas.width}px`;
  els.canvasWrap.style.height = `${mainCanvas.height}px`;

  const availW = rect.width  - 48;
  const availH = rect.height - 200;
  const scaleX = availW / mainCanvas.width;
  const scaleY = availH / mainCanvas.height;
  const z = Math.max(0.05, Math.min(20, Math.min(scaleX, scaleY)));

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  applyZoom(z, cx, cy);

  requestAnimationFrame(() => { scroll.scrollLeft = 0; scroll.scrollTop = 0; });
}

export function zoom100() {
  const rect = els.canvasScroll.getBoundingClientRect();
  applyZoom(1, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

export function zoomReset() {
  state.zoom = 1;
  els.canvasWrap.style.transform = 'scale(1)';
  els.canvasWrap.style.width  = `${mainCanvas.width}px`;
  els.canvasWrap.style.height = `${mainCanvas.height}px`;
  els.canvasScroll.scrollLeft = 0;
  els.canvasScroll.scrollTop  = 0;
  scaleHandles(1);
  document.getElementById('stZoom').textContent = '100%';
}

/* ============================================================
   RUEDA
   ============================================================ */
function onWheel(e) {
  e.preventDefault();
  if (e.shiftKey) els.canvasScroll.scrollLeft += e.deltaY;
  else if (e.altKey) els.canvasScroll.scrollTop += e.deltaY;
  else {
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoom(factor, e.clientX, e.clientY);
  }
}

/* ============================================================
   UTILIDADES
   ============================================================ */
function hexToRgba(hex, a = 1) {
  if (!hex.startsWith('#')) return `rgba(0,0,0,${a})`;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}