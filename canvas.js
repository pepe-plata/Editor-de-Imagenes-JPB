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

  // Pinch: referencia FIJA al iniciar el gesto
  pinchStartDist: 0,
  pinchStartZoom: 1,
  pinchAnchorX: 0,
  pinchAnchorY: 0,

  // Estado del gesto (solo zoom)
  pinchLastDist: 0,

  // Scroll (pan) con 1 dedo
  scrollPanning: false,
  scrollPanPointerId: null,
  scrollPanStartX: 0,
  scrollPanStartY: 0,
  scrollPanStartScrollX: 0,
  scrollPanStartScrollY: 0,
  scrollPanMoved: false,

  firstTouchTimer: null,
  spacePanning: false,
  panning: false,
  panPointerId: null,
  panStartX: 0, panStartY: 0,
  panStartScrollX: 0, panStartScrollY: 0,

  selection: null,
  floating: null,
  lastShape: null,
  textBox: null,

  pickerActive: false,
  pickerPointerId: null,

  // Redimensión por handles (extender área tipo Paint)
  resizeSession: null
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

  els.canvasScroll.style.touchAction = 'none';
  els.canvasScroll.addEventListener('pointerdown', onPointerDown);
  els.canvasScroll.addEventListener('pointermove', onPointerMove);
  els.canvasScroll.addEventListener('pointerup',   onPointerUp);
  els.canvasScroll.addEventListener('pointercancel', onPointerUp);

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
  if (!tool.startsWith('select') && !tool.startsWith('shape-')) clearShapeSelection();
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

  draw.pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });

  // Si es touch y hay 1 dedo: no decidimos aún — puede ser pan con 1 dedo, o pinch con 2
  if (draw.pointers.size === 2) {
    // Cambiamos a modo pinch: cancelamos cualquier pan con 1 dedo o trazo
    clearTimeout(draw.firstTouchTimer);
    cancelScrollPan();
    draw.twoFingerActive = true;
    abortDrawing();
    startPinch();
    return;
  }
  if (draw.twoFingerActive) return;

  if (draw.spacePanning) { startPan(e); return; }

  // ✅ 1 dedo sobre touch fuera de cualquier herramienta de dibujo → puede ser pan
  // Pero si es sobre el canvas y hay herramienta activa, iniciamos trazo (con delay en touch).
  if (e.pointerType === 'touch') {
    // Todavía no decidimos: esperamos 90ms por si entra un 2º dedo.
    // Al mismo tiempo, dejamos la puerta abierta para convertirlo en pan.
    draw.firstTouchTimer = setTimeout(() => {
      // Pasado el delay, decidimos: si es sobre el canvas, es trazo; si es fuera, es pan.
      const onCanvas = isPointerOnCanvas(e);
      if (onCanvas && needsDrawingTool()) {
        beginStroke(e);
      } else {
        startScrollPan(e);
      }
    }, 90);
  } else {
    // Mouse / pen: comportamiento directo
    if (isPointerOnCanvas(e) || state.tool !== 'picker') {
      // ✅ Clic fuera del canvas también dibuja (como si fuera dentro)
      beginStroke(e);
    } else {
      beginStroke(e);
    }
  }
}

function onPointerMove(e) {
  const rec = draw.pointers.get(e.pointerId);
  if (rec) { rec.x = e.clientX; rec.y = e.clientY; }

  if (draw.pickerActive && e.pointerId === draw.pickerPointerId) {
    updatePickerContinuo(e);
    return;
  }

  if (draw.resizeSession) {
    updateHandleResize(e);
    return;
  }

  if (draw.scrollPanning && e.pointerId === draw.scrollPanPointerId) {
    updateScrollPan(e);
    return;
  }

  if (draw.panning && e.pointerId === draw.panPointerId) { updatePan(e); return; }
  if (draw.twoFingerActive && draw.pointers.size >= 2) { updatePinch(); return; }
  if (!draw.active) return;

  const { x, y } = getCanvasCoords(e.clientX, e.clientY);
  continueStroke(x, y, e);
}

function onPointerUp(e) {
  clearTimeout(draw.firstTouchTimer);

  if (draw.pickerActive && e.pointerId === draw.pickerPointerId) {
    endPickerContinuo();
    draw.pointers.delete(e.pointerId);
    return;
  }

  if (draw.resizeSession) {
    endHandleResize();
    draw.pointers.delete(e.pointerId);
    return;
  }

  if (draw.scrollPanning && e.pointerId === draw.scrollPanPointerId) {
    endScrollPan();
    draw.pointers.delete(e.pointerId);
    return;
  }

  draw.pointers.delete(e.pointerId);

  if (draw.panning && e.pointerId === draw.panPointerId) { endPan(); return; }
  if (draw.twoFingerActive && draw.pointers.size < 2) {
    draw.twoFingerActive = false;
    resetGestureState();
    return;
  }
  if (draw.active) endStroke();
}

/* ─── Determinar si la herramienta activa dibuja o no ─── */
function needsDrawingTool() {
  const t = state.tool;
  return t === 'pencil' || t === 'brush' || t === 'eraser' ||
         t === 'fill' || t === 'picker' || t === 'text' ||
         t.startsWith('select') || t.startsWith('shape-');
}

function isPointerOnCanvas(e) {
  const rect = overlayCanvas.getBoundingClientRect();
  return e.clientX >= rect.left && e.clientX <= rect.right &&
         e.clientY >= rect.top  && e.clientY <= rect.bottom;
}

/* ─── Pan con espacio ─────────────────────────────────────── */
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

/* ─── Scroll con 1 dedo (pan táctil) ─────────────────────── */
function startScrollPan(e) {
  draw.scrollPanning = true;
  draw.scrollPanPointerId = e.pointerId;
  draw.scrollPanStartX = e.clientX;
  draw.scrollPanStartY = e.clientY;
  draw.scrollPanStartScrollX = els.canvasScroll.scrollLeft;
  draw.scrollPanStartScrollY = els.canvasScroll.scrollTop;
  draw.scrollPanMoved = false;
  els.canvasScroll.setPointerCapture?.(e.pointerId);
}

function updateScrollPan(e) {
  const dx = e.clientX - draw.scrollPanStartX;
  const dy = e.clientY - draw.scrollPanStartY;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) draw.scrollPanMoved = true;
  els.canvasScroll.scrollLeft = draw.scrollPanStartScrollX - dx;
  els.canvasScroll.scrollTop  = draw.scrollPanStartScrollY - dy;
}

function endScrollPan() {
  draw.scrollPanning = false;
  draw.scrollPanPointerId = null;
  draw.scrollPanMoved = false;
}

function cancelScrollPan() {
  if (!draw.scrollPanning) return;
  draw.scrollPanning = false;
  draw.scrollPanPointerId = null;
  draw.scrollPanMoved = false;
}

/* ============================================================
   PINCH — SOLO ZOOM (sin pan simultáneo)
   ============================================================ */
function resetGestureState() {
  draw.pinchStartDist = 0;
  draw.pinchStartZoom = state.zoom;
  draw.pinchLastDist = 0;
}

function startPinch() {
  const pts = [...draw.pointers.values()];
  if (pts.length < 2) return;

  const [a, b] = pts;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;

  draw.pinchStartDist = dist;
  draw.pinchStartZoom = state.zoom;
  draw.pinchAnchorX = midX;
  draw.pinchAnchorY = midY;
  draw.pinchLastDist = dist;
}

function updatePinch() {
  const pts = [...draw.pointers.values()];
  if (pts.length < 2) return;

  const [a, b] = pts;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  if (draw.pinchStartDist < 4) return;

  const scale = dist / draw.pinchStartDist;
  const newZoom = Math.max(0.05, Math.min(20, draw.pinchStartZoom * scale));

  // ✅ El ancla queda FIJA al punto inicial del pinch
  applyZoomAnchored(newZoom, draw.pinchAnchorX, draw.pinchAnchorY);
}

/**
 * Zoom anclado a un punto fijo de la pantalla.
 */
function applyZoomAnchored(newZoom, anchorClientX, anchorClientY) {
  const scroll = els.canvasScroll;
  const rect = scroll.getBoundingClientRect();

  const sx = (anchorClientX - rect.left) + scroll.scrollLeft;
  const sy = (anchorClientY - rect.top)  + scroll.scrollTop;

  const oldZoom = state.zoom;
  const ratio = newZoom / oldZoom;
  state.zoom = newZoom;

  els.canvasWrap.style.transformOrigin = '0 0';
  els.canvasWrap.style.transform = `scale(${newZoom})`;
  els.canvasWrap.style.width  = `${mainCanvas.width}px`;
  els.canvasWrap.style.height = `${mainCanvas.height}px`;

  scroll.scrollLeft = sx * ratio - (anchorClientX - rect.left);
  scroll.scrollTop  = sy * ratio - (anchorClientY - rect.top);

  scaleHandles(newZoom);
  updateTextToolbarScale(newZoom);
  document.getElementById('stZoom').textContent = Math.round(newZoom * 100) + '%';
}

/* ============================================================
   CUENTAGOTAS CONTINUO
   ============================================================ */
function startPickerContinuo(e) {
  draw.pickerActive = true;
  draw.pickerPointerId = e.pointerId;
  overlayCanvas.setPointerCapture?.(e.pointerId);
  updatePickerContinuo(e);
}

function updatePickerContinuo(e) {
  const { x, y } = getCanvasCoords(e.clientX, e.clientY);
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= mainCanvas.width || py >= mainCanvas.height) return;

  const color = pickColor(mainCtx, px, py);
  if (color) {
    state.primary = color;
    const input = document.getElementById('colorPrimary');
    const swatch = document.getElementById('colorBtnSwatch');
    if (input) input.value = color;
    if (swatch) swatch.style.background = color;
    setStatus(`Color: ${color}`);
  }
}

function endPickerContinuo() {
  draw.pickerActive = false;
  draw.pickerPointerId = null;
  setStatus(`Color elegido: ${state.primary}`);
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
    startPickerContinuo(e);
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
  if (tool === 'select-wand') {
    magicWandSelect(x, y);
    draw.active = false;
    return;
  }
  if (tool.startsWith('select')) { beginSelection(x, y); return; }
  if (tool === 'eraser') mainCtx.globalCompositeOperation = 'destination-out';
  if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') drawDot(mainCtx, x, y);
}

function continueStroke(x, y, e) {
  const tool = state.tool;
  if (tool.startsWith('select') && tool !== 'select-wand') { updateSelection(x, y); return; }
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
  if (tool.startsWith('select') && tool !== 'select-wand') { finishSelection(); draw.active = false; return; }
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
   VARITA MÁGICA
   ============================================================
   Selecciona una región contigua similar al color donde se hizo clic
   y la convierte en un flotante.
   ============================================================ */
function magicWandSelect(x, y) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= mainCanvas.width || py >= mainCanvas.height) return;

  const img = mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height);
  const data = img.data;
  const W = img.width, H = img.height;

  const target = getPixel(data, px, py, W);
  const tolerance = 30;

  const mask = new Uint8Array(W * H);
  const stack = [[px, py]];
  let minX = W, minY = H, maxX = 0, maxY = 0;
  let count = 0;

  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
    const idx = cy * W + cx;
    if (mask[idx]) continue;
    const p = getPixel(data, cx, cy, W);
    if (!colorsEqual(p, target, tolerance)) continue;

    mask[idx] = 1;
    count++;
    if (cx < minX) minX = cx;
    if (cy < minY) minY = cy;
    if (cx > maxX) maxX = cx;
    if (cy > maxY) maxY = cy;

    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }

  if (count < 4) {
    setStatus('No hay región seleccionable');
    return;
  }

  const rw = maxX - minX + 1;
  const rh = maxY - minY + 1;

  // Construir un canvas con solo los píxeles enmascarados
  floatingCanvas.width = rw;
  floatingCanvas.height = rh;
  floatingCtx.clearRect(0, 0, rw, rh);
  const fdata = floatingCtx.createImageData(rw, rh);
  const fbytes = fdata.data;

  for (let yy = 0; yy < rh; yy++) {
    for (let xx = 0; xx < rw; xx++) {
      const srcIdx = (minY + yy) * W + (minX + xx);
      if (mask[srcIdx]) {
        const dstIdx = (yy * rw + xx) * 4;
        const s = srcIdx * 4;
        fbytes[dstIdx]     = data[s];
        fbytes[dstIdx + 1] = data[s + 1];
        fbytes[dstIdx + 2] = data[s + 2];
        fbytes[dstIdx + 3] = data[s + 3];
      }
    }
  }
  floatingCtx.putImageData(fdata, 0, 0);

  // Borrar la región del canvas original
  for (let yy = 0; yy < rh; yy++) {
    for (let xx = 0; xx < rw; xx++) {
      const srcIdx = (minY + yy) * W + (minX + xx);
      if (mask[srcIdx]) {
        const s = srcIdx * 4;
        data[s] = 0; data[s + 1] = 0; data[s + 2] = 0; data[s + 3] = 0;
      }
    }
  }
  mainCtx.putImageData(img, 0, 0);

  // Redibujar los píxeles borrados con blanco si no es transparente
  if (!state.transparentBg) {
    mainCtx.save();
    mainCtx.globalCompositeOperation = 'destination-over';
    mainCtx.fillStyle = '#ffffff';
    mainCtx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
    mainCtx.restore();
  }

  draw.floating = {
    x: minX, y: minY, w: rw, h: rh, rotation: 0, source: 'selection'
  };
  renderFloating();
  pushHistory(); markDirty();
  setStatus(`Varita mágica: ${count} px seleccionados`);
}

function getPixel(data, x, y, width) {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}
function colorsEqual(a, b, tol) {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol &&
         Math.abs(a[2] - b[2]) <= tol && Math.abs(a[3] - b[3]) <= tol;
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
   SELECCIÓN RECTANGULAR / LAZO
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

  const drag = document.getElementById('teDragHandle');
  if (drag) {
    drag.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onTextEditorDrag(e);
    });
  }

  const toolbar = document.getElementById('textToolbar');
  toolbar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, label')) return;
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
  els.teNoBg.checked = true;
  applyTextStyles();
  updateTextToolbarScale(state.zoom);
  els.teText.focus();
  setStatus('Editor de texto: escribe y pulsa ✓ o haz clic fuera');
}

/** Mantiene la barra del editor al mismo tamaño visual (contrarresta el zoom). */
function updateTextToolbarScale(zoom) {
  const tb = document.getElementById('textToolbar');
  if (!tb) return;
  const z = Math.max(0.05, Math.min(20, zoom || 1));
  tb.style.transform = `scale(${1 / z})`;
  tb.style.transformOrigin = 'bottom left';
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
  const zoom = state.zoom || 1;

  const move = (ev) => {
    tb.x = Math.max(-tb.w + 40, Math.min(mainCanvas.width - 40, ox + (ev.clientX - startX) / zoom));
    tb.y = Math.max(-20, Math.min(mainCanvas.height - 20, oy + (ev.clientY - startY) / zoom));
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
  const zoom = state.zoom || 1;

  const move = (ev) => {
    const dx = (ev.clientX - startX) / zoom;
    const dy = (ev.clientY - startY) / zoom;

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
   HANDLES DEL CANVAS — EXTENDER/CONTRAR ÁREA (tipo Paint W10)
   ============================================================
   Al arrastrar un handle:
     - E: crece por la derecha → ancho crece
     - W: crece por la izquierda → ancho crece y contenido se desplaza a la derecha
     - S: crece por abajo → alto crece
     - N: crece por arriba → alto crece y contenido se desplaza hacia abajo
   NO se reescala la imagen, solo se extiende o contrae el "papel".
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
  const startClientX = e.clientX;
  const startClientY = e.clientY;
  const zoomVal = state.zoom || 1;

  const startW = mainCanvas.width;
  const startH = mainCanvas.height;

  // Snapshot del contenido actual
  const tmp = document.createElement('canvas');
  tmp.width = startW;
  tmp.height = startH;
  tmp.getContext('2d').drawImage(mainCanvas, 0, 0);

  draw.resizeSession = {
    dir,
    startClientX,
    startClientY,
    startW,
    startH,
    tmp,
    zoomVal,
    lastW: startW,
    lastH: startH,
    offsetX: 0,
    offsetY: 0
  };
}

function updateHandleResize(ev) {
  const s = draw.resizeSession;
  if (!s) return;

  const dxCanvas = Math.round((ev.clientX - s.startClientX) / s.zoomVal);
  const dyCanvas = Math.round((ev.clientY - s.startClientY) / s.zoomVal);

  let newW = s.startW;
  let newH = s.startH;
  let offX = 0;
  let offY = 0;

  // ✅ Redimensión del LADO correspondiente (tipo Paint W10):
  // E: ancho += dx, contenido anclado a la izquierda
  if (s.dir.includes('e')) {
    newW = Math.max(1, s.startW + dxCanvas);
    offX = 0;
  }
  // W: ancho -= dx, contenido desplazado hacia la derecha si crece
  if (s.dir.includes('w')) {
    newW = Math.max(1, s.startW - dxCanvas);
    offX = s.startW - newW; // si crece (newW > startW), offX < 0 → NO
    // Realmente: si newW > startW, offX debe ser > 0 para empujar el contenido a la derecha
    // Ej: startW=600, newW=700 → offX=100.
    // Pero aquí dxCanvas es negativo (dedo va a la izq) → newW=600-(-100)=700 → offX=600-700=-100.
    // Corregimos: offX = newW - startW (positivo si crece)
    offX = newW - s.startW;
  }
  // S: alto += dy
  if (s.dir.includes('s')) {
    newH = Math.max(1, s.startH + dyCanvas);
    offY = 0;
  }
  // N: alto -= dy, contenido desplazado si crece
  if (s.dir.includes('n')) {
    newH = Math.max(1, s.startH - dyCanvas);
    offY = newH - s.startH;
  }

  // Simplificación: si es 'nw', 'ne', 'sw', 'se' se combinan ambos.
  // Cuando crece por W o N, el offset es negativo en realidad porque el contenido
  // se dibuja desde (0,0) pero queremos que se vea desplazado al crecer hacia arriba/izq.
  // Corregimos:
  if (s.dir.includes('w')) offX = Math.max(0, s.startW - newW) === 0 ? (newW - s.startW) : (newW - s.startW);
  if (s.dir.includes('n')) offY = newH - s.startH;

  // En realidad la fórmula correcta es:
  // Si newW > startW (creció): el contenido debe desplazarse a la derecha → offX = newW - startW
  // Si newW < startW (encogió): el contenido se recorta por la izquierda → offX = newW - startW (negativo)
  // Y para E/S, offX/offY = 0 (anclado a la izquierda/arriba)
  if (s.dir === 'w' || s.dir === 'nw' || s.dir === 'sw') {
    offX = newW - s.startW;
  }
  if (s.dir === 'n' || s.dir === 'nw' || s.dir === 'ne') {
    offY = newH - s.startH;
  }

  if (newW === s.lastW && newH === s.lastH && offX === s.offsetX && offY === s.offsetY) {
    return;
  }

  mainCanvas.width = newW;
  mainCanvas.height = newH;
  overlayCanvas.width = newW;
  overlayCanvas.height = newH;

  if (!state.transparentBg) {
    mainCtx.fillStyle = '#ffffff';
    mainCtx.fillRect(0, 0, newW, newH);
  } else {
    mainCtx.clearRect(0, 0, newW, newH);
  }

  mainCtx.drawImage(s.tmp, offX, offY);

  s.lastW = newW;
  s.lastH = newH;
  s.offsetX = offX;
  s.offsetY = offY;

  els.canvasWrap.style.width  = `${newW}px`;
  els.canvasWrap.style.height = `${newH}px`;

  updateFooterInfo();
}

function endHandleResize() {
  const s = draw.resizeSession;
  if (!s) return;
  draw.resizeSession = null;
  if (s.lastW === s.startW && s.lastH === s.startH) return;
  pushHistory();
  markDirty();
  updateFooterInfo();
  setStatus(`Área del lienzo: ${s.lastW} × ${s.lastH} px`);
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
  updateTextToolbarScale(newZoom);
  document.getElementById('stZoom').textContent = Math.round(newZoom * 100) + '%';
}

/**
 * Los handles mantienen su tamaño VISUAL en pantalla, sin importar el zoom.
 * Se aplica scale(1/z) exacto (sin límites) para lograrlo.
 */
function scaleHandles(z) {
  const inv = 1 / (z || 1);
  els.handles.querySelectorAll('.handle').forEach((h) => {
    h.style.transform = `scale(${inv})`;
  });
  document.querySelectorAll('.shape-handle').forEach((h) => {
    h.style.transform = `scale(${inv})`;
  });
  document.querySelectorAll('.float-handle').forEach((h) => {
    h.style.transform = `scale(${inv})`;
  });
  document.querySelectorAll('.te-float-handle').forEach((h) => {
    h.style.transform = `scale(${inv})`;
  });
  els.canvasWrap.classList.toggle('show-handles', z < 5);
}

export function zoom(factor, centerX, centerY) {
  const rect = els.canvasScroll.getBoundingClientRect();
  // ✅ Si no se especifica centro, usar el centro del ÁREA VISIBLE
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
  updateTextToolbarScale(1);
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