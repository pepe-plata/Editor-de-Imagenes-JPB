/* ============================================================
   tools.js — Paleta, relleno, cuentagotas, figuras
   Editor de Imagenes JPB
   ============================================================ */

import { state, els } from './app.js';

export function initTools() {}

/* ─── Colores ──────────────────────────────────────────────── */
export function setPrimaryColor(color) {
  state.primary = color;
  if (els.colorPrimary) els.colorPrimary.value = color;
}
export function setSecondaryColor(color) {
  state.secondary = color;
  if (els.colorSecondary) els.colorSecondary.value = color;
}

export function addPaletteColor(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  renderPalette();
}

export function renderPalette() {}

/* ─── Cuentagotas ──────────────────────────────────────────── */
export function pickColor(ctx, x, y) {
  try {
    const data = ctx.getImageData(x, y, 1, 1).data;
    const r = data[0].toString(16).padStart(2, '0');
    const g = data[1].toString(16).padStart(2, '0');
    const b = data[2].toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  } catch (e) { return null; }
}

/* ─── Flood fill (bote de pintura) ─────────────────────────── */
export function floodFill(ctx, x, y, hexColor, width, height) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const target = getPixel(data, x, y, width);
  const fill = hexToRgb(hexColor);
  if (colorsEqual(target, fill, 0)) return;

  // ✅ Tolerancia configurable desde el slider derecho (por defecto 0)
  const tolerance = Number(state.tolerance) || 0;
  const stack = [[x, y]];
  const visited = new Uint8Array(width * height);

  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
    const idx = cy * width + cx;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const px = getPixel(data, cx, cy, width);
    if (!colorsEqual(px, target, tolerance)) continue;
    setPixel(data, cx, cy, width, fill);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  ctx.putImageData(imgData, 0, 0);
}

function getPixel(data, x, y, width) {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}
function setPixel(data, x, y, width, [r, g, b, a = 255]) {
  const i = (y * width + x) * 4;
  data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
}
function colorsEqual(a, b, tol) {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol &&
         Math.abs(a[2] - b[2]) <= tol && Math.abs(a[3] - b[3]) <= tol;
}
export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/* ─── Figuras ──────────────────────────────────────────────── */
export function drawShape(ctx, tool, x0, y0, x1, y1, opts) {
  const { stroke, fill, lineWidth } = opts;
  const w = x1 - x0, h = y1 - y0;
  const rx = Math.min(x0, x1), ry = Math.min(y0, y1);
  const rw = Math.abs(w), rh = Math.abs(h);

  ctx.beginPath();

  switch (tool) {
    case 'shape-line':
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      break;

    case 'shape-arrow': {
      const angle = Math.atan2(h, w);
      const headLen = Math.max(12, lineWidth * 4);
      const tipX = x1, tipY = y1;
      const backX = tipX - headLen * Math.cos(angle);
      const backY = tipY - headLen * Math.sin(angle);
      ctx.moveTo(x0, y0); ctx.lineTo(backX, backY);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - headLen * Math.cos(angle - Math.PI / 7),
                 tipY - headLen * Math.sin(angle - Math.PI / 7));
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - headLen * Math.cos(angle + Math.PI / 7),
                 tipY - headLen * Math.sin(angle + Math.PI / 7));
      break;
    }

    case 'shape-rect':
      ctx.rect(rx, ry, rw, rh);
      break;

    case 'shape-rounded': {
      const r = Math.min(20, rw * 0.15, rh * 0.15);
      roundRectPath(ctx, rx, ry, rw, rh, r);
      break;
    }

    case 'shape-square': {
      const size = Math.max(rw, rh);
      const sx = w < 0 ? x0 - size : x0;
      const sy = h < 0 ? y0 - size : y0;
      ctx.rect(sx, sy, size, size);
      break;
    }

    case 'shape-circle': {
      const r = Math.max(rw, rh) / 2;
      const cx = rx + rw / 2;
      const cy = ry + rh / 2;
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    }

    case 'shape-ellipse':
      ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
      break;

    case 'shape-triangle':
      ctx.moveTo(rx + rw / 2, ry);
      ctx.lineTo(rx + rw, ry + rh);
      ctx.lineTo(rx, ry + rh);
      ctx.closePath();
      break;

    case 'shape-star':
      starPath(ctx, rx + rw / 2, ry + rh / 2, Math.min(rw, rh) / 2, 5);
      break;

    case 'shape-callout': {
      const tailH = Math.min(20, rh * 0.2);
      ctx.rect(rx, ry, rw, rh - tailH);
      ctx.moveTo(rx + rw * 0.2, ry + rh - tailH);
      ctx.lineTo(rx + rw * 0.15, ry + rh);
      ctx.lineTo(rx + rw * 0.35, ry + rh - tailH);
      break;
    }

    case 'shape-callout-oval': {
      ctx.ellipse(rx + rw / 2, ry + rh * 0.4, rw / 2, rh * 0.4, 0, 0, Math.PI * 2);
      ctx.moveTo(rx + rw * 0.3, ry + rh * 0.72);
      ctx.lineTo(rx + rw * 0.25, ry + rh);
      ctx.lineTo(rx + rw * 0.5, ry + rh * 0.75);
      break;
    }

    default: return;
  }

  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function starPath(ctx, cx, cy, outerR, points) {
  const innerR = outerR * 0.4;
  const step = Math.PI / points;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = i * step - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function getShapeFromTool(tool) {
  if (!tool.startsWith('shape-')) return null;
  return tool.replace('shape-', '');
}

/* ─── Transformaciones ─────────────────────────────────────── */
export function applyTransformToCanvas(canvas, op, params = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').drawImage(canvas, 0, 0);

  switch (op) {
    case 'rotate': {
      const dir = params.dir || 1;
      canvas.width = h; canvas.height = w;
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(dir * Math.PI / 2);
      ctx.drawImage(tmp, -w / 2, -h / 2);
      ctx.restore();
      break;
    }
    case 'flip': {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      if (params.axis === 'h') { ctx.translate(w, 0); ctx.scale(-1, 1); }
      else                     { ctx.translate(0, h); ctx.scale(1, -1); }
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
      break;
    }
    case 'resize': {
      canvas.width = params.w; canvas.height = params.h;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tmp, 0, 0, params.w, params.h);
      break;
    }
  }
}

export function updateFooterInfo() {}