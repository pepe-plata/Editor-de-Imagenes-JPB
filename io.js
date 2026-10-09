/* ============================================================
   io.js — Carga, guardado, EXIF, formatos
   Editor de Imagenes JPB
   ============================================================ */

import { state, els, setStatus, pushHistory, markDirty, closeModal, syncWrapSize, updateFooterInfo } from './app.js';
import { zoomFit, clearShapeSelection, commitFloating } from './canvas.js';

/* ============================================================
   ABRIR
   ============================================================ */
export function openFileDialog() {
  els.fileInput.click();
}

export async function openFromFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    setStatus('Archivo no soportado');
    return;
  }
  setStatus(`Abriendo ${file.name}…`);

  try { commitFloating(); } catch (e) {}
  try { clearShapeSelection(); } catch (e) {}

  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (e) {
    setStatus('Error al leer el archivo');
    return;
  }

  const blob = new Blob([buffer], { type: file.type });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);

    const canvas  = document.getElementById('mainCanvas');
    const overlay = document.getElementById('overlayCanvas');

    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    overlay.width  = img.naturalWidth;
    overlay.height = img.naturalHeight;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ✅ Determinar transparencia por tipo MIME
    const hasAlpha = file.type === 'image/png' ||
                     file.type === 'image/webp' ||
                     file.type === 'image/gif' ||
                     file.type === 'image/svg+xml';

    state.transparentBg = hasAlpha;

    if (!hasAlpha) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.drawImage(img, 0, 0);

    state.originalBuffer = buffer;
    state.fileType = file.type;
    state.fileName = file.name || generateFileName(file.type);
    state.history = [];
    state.historyIndex = -1;

    els.fileName.value = state.fileName;

    syncWrapSize();

    els.canvasWrap.style.transform = 'scale(1)';
    state.zoom = 1;
    els.canvasScroll.scrollLeft = 0;
    els.canvasScroll.scrollTop = 0;

    pushHistory();
    markDirty(false);
    updateFooterInfo();
    zoomFit();

    setStatus(`Abierto: ${state.fileName} (${img.naturalWidth} × ${img.naturalHeight})`);
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    setStatus('Error al cargar la imagen');
  };

  img.src = url;
}

function generateFileName(mime) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return `foto_${stamp}.${ext}`;
}

/* ============================================================
   GUARDAR
   ============================================================ */
export function buildSaveModal() {
  const formatSel    = document.getElementById('saveFormat');
  const qualityField = document.getElementById('qualityField');
  const qualityRange = document.getElementById('saveQuality');
  const qualityVal   = document.getElementById('qualityVal');
  const exifField    = document.getElementById('exifField');
  const saveName     = document.getElementById('saveName');
  const preview      = document.getElementById('savePreview');

  const base = state.fileName.replace(/\.[^.]+$/, '') || 'imagen';
  saveName.value = base;

  const updateVisibility = () => {
    const fmt = formatSel.value;
    qualityField.hidden = fmt !== 'image/jpeg' && fmt !== 'image/webp';
    exifField.hidden = fmt !== 'image/jpeg';
    preview.textContent = `${saveName.value}.${extFromMime(fmt)}`;
  };

  formatSel.onchange = updateVisibility;
  saveName.oninput = updateVisibility;
  qualityRange.oninput = () => { qualityVal.textContent = qualityRange.value; };
  updateVisibility();

  const confirm = document.getElementById('btnSaveConfirm');
  confirm.onclick = async () => {
    try { commitFloating(); } catch (e) {}
    const format = formatSel.value;
    const quality = Number(qualityRange.value) / 100;
    const name = `${saveName.value}.${extFromMime(format)}`;
    const exif = document.getElementById('saveExif').checked;
    await saveImage({ format, quality, name, preserveExif: exif });
    closeModal(els.modalSave);
  };
}

function extFromMime(mime) {
  return {
    'image/png': 'png', 'image/jpeg': 'jpg',
    'image/webp': 'webp', 'image/bmp': 'bmp'
  }[mime] || 'png';
}

export async function saveImage({ format, quality = 0.92, name, preserveExif = true }) {
  const canvas = document.getElementById('mainCanvas');
  let blob;

  if (format === 'image/bmp') {
    blob = canvasToBMP(canvas);
  } else {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, format, quality));
  }

  if (!blob) { setStatus('Error al exportar'); return; }

  if (format === 'image/jpeg' && preserveExif && state.originalBuffer && state.fileType === 'image/jpeg') {
    try { blob = await injectExif(blob, state.originalBuffer); }
    catch (e) { console.warn('No se pudo preservar EXIF:', e); }
  }

  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: format, accept: { [format]: ['.' + extFromMime(format)] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus(`Guardado: ${name} (${formatBytes(blob.size)})`);
      markDirty(false);
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') { setStatus('Guardado cancelado'); return; }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  setStatus(`Descargado: ${name} (${formatBytes(blob.size)})`);
  markDirty(false);
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(2) + ' MB';
}

/* ============================================================
   BMP ENCODER
   ============================================================ */
function canvasToBMP(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const pixelArraySize = rowSize * h;
  const fileSize = 54 + pixelArraySize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  view.setUint8(0, 0x42); view.setUint8(1, 0x4D);
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true);
  view.setUint32(10, 54, true);

  view.setUint32(14, 40, true);
  view.setInt32(18, w, true);
  view.setInt32(22, h, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(30, 0, true);
  view.setUint32(34, pixelArraySize, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  view.setUint32(46, 0, true);
  view.setUint32(50, 0, true);

  const padding = rowSize - w * 3;
  let offset = 54;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      view.setUint8(offset++, data[i + 2]);
      view.setUint8(offset++, data[i + 1]);
      view.setUint8(offset++, data[i]);
    }
    for (let p = 0; p < padding; p++) view.setUint8(offset++, 0);
  }
  return new Blob([buffer], { type: 'image/bmp' });
}

/* ============================================================
   EXIF
   ============================================================ */
function injectExif(newJpegBlob, originalBuffer) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const newBuf = new Uint8Array(reader.result);
      const origBuf = new Uint8Array(originalBuffer);

      const exifSegment = extractApp1Segment(origBuf);
      if (!exifSegment) { resolve(newJpegBlob); return; }

      const out = new Uint8Array(2 + exifSegment.length + (newBuf.length - 2));
      out.set(newBuf.subarray(0, 2), 0);
      out.set(exifSegment, 2);
      out.set(newBuf.subarray(2), 2 + exifSegment.length);

      resolve(new Blob([out], { type: 'image/jpeg' }));
    };
    reader.readAsArrayBuffer(newJpegBlob);
  });
}

function extractApp1Segment(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let pos = 2;
  while (pos < buf.length - 1) {
    if (buf[pos] !== 0xFF) break;
    let marker = buf[pos + 1];
    while (marker === 0xFF) { pos++; marker = buf[pos + 1]; }
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
      pos += 2; continue;
    }
    const len = (buf[pos + 2] << 8) | buf[pos + 3];
    if (len < 2 || pos + 2 + len > buf.length) break;
    if (marker === 0xE1 && len >= 8) {
      const sig = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
      if (sig === 'Exif') return buf.subarray(pos, pos + 2 + len);
    }
    if (marker === 0xDA) break;
    pos += 2 + len;
  }
  return null;
}

/* ============================================================
   SHARE TARGET / FILE HANDLERS
   ============================================================ */
export async function handleFileHandlerLaunch() {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(async (launchParams) => {
    if (!launchParams.files || !launchParams.files.length) return;
    const handle = launchParams.files[0];
    try {
      const file = await handle.getFile();
      await openFromFile(file);
    } catch (e) { console.warn('No se pudo leer el archivo lanzado', e); }
  });
}

export async function handleSharedFile() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('shared') !== '1') return;
    const id = params.get('id');
    if (!id) return;
    const mod = await import('./db.js');
    const rec = await mod.getBlob(id);
    if (rec && rec.blob) {
      const file = new File([rec.blob], rec.name || 'compartido.png', { type: rec.blob.type });
      await openFromFile(file);
    }
    history.replaceState({}, '', location.pathname);
  } catch (e) {}
}