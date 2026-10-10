/* ============================================================
   app.js — Bootstrap, UI, estado, historial, atajos
   Editor de Imagenes JPB
   ============================================================ */

import {
  initCanvas, setTool, zoom, zoomFit, zoom100,
  doRotate, doFlip, doResize, doCrop, cropToSelection,
  getMainCanvas, clearShapeSelection, commitFloating,
  getActiveSelection
} from './canvas.js';

import {
  initTools, setPrimaryColor, setSecondaryColor, renderPalette
} from './tools.js';

import {
  openFileDialog, openFromFile, saveImage, buildSaveModal,
  handleFileHandlerLaunch, handleSharedFile
} from './io.js';

/* ============================================================
   TAMAÑOS DE HOJA
   ============================================================ */
const SHEET_SIZES = {
  'MediaCarta':       { w: 21.59, h: 13.97, label: 'Media Carta 21.59 × 13.97 cm (8.5" × 5.5")' },
  'Carta':            { w: 21.59, h: 27.94, label: 'Carta (Letter) 21.59 × 27.94 cm (8.5" × 11")' },
  'CartaHorizontal':  { w: 27.94, h: 21.59, label: 'Carta Horizontal 27.94 × 21.59 cm (11" × 8.5")' },
  'Oficio':           { w: 21.59, h: 35.56, label: 'Oficio / Legal 21.59 × 35.56 cm (8.5" × 14")' },
  'A4':               { w: 21,    h: 29.7,  label: 'A4 21 × 29.7 cm (8.27" × 11.69")' },
  'A4Horizontal':     { w: 29.7,  h: 21,    label: 'A4 Horizontal 29.7 × 21 cm' },
  'DobleCarta':       { w: 43.18, h: 27.94, label: 'Doble Carta 43.18 × 27.94 cm (17" × 11")' },
  'Tabloide':         { w: 27.94, h: 43.18, label: 'Tabloide 27.94 × 43.18 cm (11" × 17")' },
  'FotoInfantil':     { w: 2.5,   h: 3.0,   label: 'Foto infantil 2.5 × 3.0 cm' },
  'FotoPostal':       { w: 10.2,  h: 15.2,  label: 'Foto Postal 10.2 × 15.2 cm (4" × 6")' },
  'Foto5x7':          { w: 12.7,  h: 17.8,  label: '12.7 × 17.8 cm (5" × 7")' },
  'Foto6x8':          { w: 15.24, h: 20.32, label: '15.24 × 20.32 cm (6" × 8")' },
  'Foto8x10':         { w: 20.32, h: 25.4,  label: '20.32 × 25.4 cm (8" × 10")' }
};

const CM_TO_PX = 37.795;
const cmToPx = (cm) => Math.round(cm * CM_TO_PX);

/* ============================================================
   ESTADO
   ============================================================ */
export const state = {
  fileName: 'Sin título',
  fileType: 'image/png',
  originalBuffer: null,
  dirty: false,
  tool: 'pencil',
  primary: '#000000',
  secondary: '#ffffff',
  strokeSize: 4,
  opacity: 1,
  strokeStyle: 'solid',
  shapeFill: 'none',
  fontFamily: 'system-ui',
  fontSize: 24,
  fontBold: false,
  fontItalic: false,
  fontUnderline: false,
  zoom: 1,
  history: [],
  historyIndex: -1,
  historyMax: 40,
  transparentBg: false,
  lastByGroup: {
    select: 'select-rect',
    pencil: 'pencil',
    shape:  'shape-rect',
    rotate: 'rotate-right',
    flip:   'flip-h'
  }
};

/* ============================================================
   DOM — Referencias (todas defensivas, sin error si faltan)
   ============================================================ */
export const els = {
  splash:         document.getElementById('splash'),
  fileName:       document.getElementById('fileNameInput'),
  btnOpen:        document.getElementById('btnOpen'),
  btnNew:         document.getElementById('btnNew'),
  btnSave:        document.getElementById('btnSave'),
  btnUndo:        document.getElementById('btnUndo'),
  btnRedo:        document.getElementById('btnRedo'),
  btnCopy:        document.getElementById('btnCopy'),
  btnPaste:       document.getElementById('btnPaste'),
  btnTheme:       document.getElementById('btnTheme'),
  btnHelp:        document.getElementById('btnHelp'),
  toolbar:        document.getElementById('toolbar'),
  colorMenu:      document.getElementById('colorMenu'),
  colorMenuGrid:  document.getElementById('colorMenuGrid'),
  colorBtnSwatch: document.getElementById('colorBtnSwatch'),
  colorPrimary:   document.getElementById('colorPrimary'),
  colorSecondary: document.getElementById('colorSecondary'),
  colorCustom:    document.getElementById('colorCustom'),
  colorCustomAdd: document.getElementById('colorCustomAdd'),
  brushSlider:    document.getElementById('brushSlider'),
  brushSizeRange: document.getElementById('brushSizeRange'),
  brushSizeValue: document.getElementById('brushSizeValue'),
  canvasArea:     document.getElementById('canvasArea'),
  canvasScroll:   document.getElementById('canvasScroll'),
  canvasCenter:   document.getElementById('canvasCenter'),
  canvasWrap:     document.getElementById('canvasWrap'),
  handles:        document.getElementById('handles'),
  shapeHandles:   document.getElementById('shapeHandles'),
  floatingLayer:  document.getElementById('floatingLayer'),
  fileInput:      document.getElementById('fileInput'),
  textInput:      document.getElementById('textInput'),

  textEditor:     document.getElementById('textEditor'),
  teText:         document.getElementById('teText'),
  teFont:         document.getElementById('teFont'),
  teSize:         document.getElementById('teSize'),
  teBold:         document.getElementById('teBold'),
  teItalic:       document.getElementById('teItalic'),
  teUnderline:    document.getElementById('teUnderline'),
  teColor:        document.getElementById('teColor'),
  teBg:           document.getElementById('teBg'),
  teNoBg:         document.getElementById('teNoBg'),
  teEmoji:        document.getElementById('teEmoji'),
  teOk:           document.getElementById('teOk'),
  teCancel:       document.getElementById('teCancel'),

  emojiPicker:    document.getElementById('emojiPicker'),
  emojiTabs:      document.getElementById('emojiTabs'),
  emojiGrid:      document.getElementById('emojiGrid'),

  stDim:          document.getElementById('stDim'),
  stSize:         document.getElementById('stSize'),
  stZoom:         document.getElementById('stZoom'),
  stMsg:          document.getElementById('stMsg'),

  modalSave:      document.getElementById('modalSave'),
  modalResize:    document.getElementById('modalResize'),
  modalNew:       document.getElementById('modalNew'),
  modalHelp:      document.getElementById('modalHelp')
};

/* ============================================================
   UTILIDADES
   ============================================================ */
export function setStatus(msg) {
  if (els.stMsg) els.stMsg.textContent = msg || '';
}

export function openModal(modal) {
  const el = typeof modal === 'string' ? document.getElementById(modal) : modal;
  if (!el) return;
  el.hidden = false;
  document.body.style.overflow = 'hidden';
}

export function closeModal(modal) {
  const el = typeof modal === 'string' ? document.getElementById(modal) : modal;
  if (!el) return;
  el.hidden = true;
  document.body.style.overflow = '';
}

export function closeAllModals() {
  document.querySelectorAll('.modal:not([hidden])').forEach((m) => (m.hidden = true));
  document.body.style.overflow = '';
}

export function markDirty(flag = true) {
  state.dirty = flag;
  updateWindowTitle();
  updateUndoRedoButtons();
}

function updateWindowTitle() {
  const prefix = state.dirty ? '● ' : '';
  document.title = `${prefix}${state.fileName} — Editor JPB`;
}

export function updateUndoRedoButtons() {
  if (els.btnUndo) els.btnUndo.disabled = state.historyIndex <= 0;
  if (els.btnRedo) els.btnRedo.disabled = state.historyIndex >= state.history.length - 1;
}

/* ============================================================
   HISTORIAL
   ============================================================ */
export function pushHistory() {
  const canvas = getMainCanvas();
  if (!canvas || !canvas.width) return;

  let snapshot;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch (e) {
    snapshot = { dataURL: canvas.toDataURL(), w: canvas.width, h: canvas.height };
  }

  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push({
    snapshot,
    w: canvas.width,
    h: canvas.height,
    fileName: state.fileName,
    transparentBg: state.transparentBg
  });

  if (state.history.length > state.historyMax) {
    state.history.shift();
  } else {
    state.historyIndex++;
  }
  updateUndoRedoButtons();
}

export function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  restoreFromHistory();
  setStatus('Deshecho');
}

export function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  restoreFromHistory();
  setStatus('Rehecho');
}

function restoreFromHistory() {
  const entry = state.history[state.historyIndex];
  if (!entry) return;

  const canvas = getMainCanvas();
  const overlay = document.getElementById('overlayCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (canvas.width !== entry.w || canvas.height !== entry.h) {
    canvas.width = entry.w;
    canvas.height = entry.h;
    if (overlay) {
      overlay.width = entry.w;
      overlay.height = entry.h;
    }
  }

  if (entry.snapshot instanceof ImageData) {
    ctx.putImageData(entry.snapshot, 0, 0);
  } else if (entry.snapshot && entry.snapshot.dataURL) {
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = entry.snapshot.dataURL;
  }

  if (typeof entry.transparentBg === 'boolean') {
    state.transparentBg = entry.transparentBg;
  }

  syncWrapSize();
  updateFooterInfo();
  updateUndoRedoButtons();
}

/* ============================================================
   SINCRONIZAR WRAP
   ============================================================ */
export function syncWrapSize() {
  const canvas = getMainCanvas();
  if (!canvas || !els.canvasWrap) return;
  els.canvasWrap.style.width  = `${canvas.width}px`;
  els.canvasWrap.style.height = `${canvas.height}px`;
}

/* ============================================================
   FOOTER
   ============================================================ */
export function updateFooterInfo() {
  const canvas = getMainCanvas();
  if (!canvas) return;
  if (els.stDim)  els.stDim.textContent = `${canvas.width} × ${canvas.height} px`;
  const approx = Math.round(canvas.width * canvas.height * 4 / 1024);
  if (els.stSize) {
    els.stSize.textContent = approx > 1024
      ? `~${(approx / 1024).toFixed(1)} MB`
      : `~${approx} KB`;
  }
  if (els.stZoom) els.stZoom.textContent = Math.round(state.zoom * 100) + '%';
}

/* ============================================================
   TEMA
   ============================================================ */
export function toggleTheme() {
  const root = document.documentElement;
  const current = root.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('jpb-theme', next); } catch (e) {}
  setStatus(next === 'dark' ? 'Tema oscuro' : 'Tema claro');
}

/* ============================================================
   MENÚS FLOTANTES (long-press 500 ms)
   ============================================================ */
const LONG_PRESS_MS = 500;

function closeAllMenus() {
  document.querySelectorAll('.tool-menu').forEach((m) => m.hidden = true);
  if (els.colorMenu) els.colorMenu.hidden = true;
}

function positionMenu(menu, anchor) {
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 8}px`;
  const menuWidth = menu.offsetWidth || 220;
  let left = rect.left + rect.width / 2 - menuWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
  menu.style.left = `${left}px`;
}

function openMenuForButton(btn) {
  const menuId = btn.dataset.menu;
  if (!menuId) return;
  const menu = document.getElementById(menuId);
  if (!menu) return;

  closeAllMenus();
  const currentVal = btn.dataset.tool || btn.dataset.action;
  menu.querySelectorAll('.tool-menu-item').forEach((it) => {
    const v = it.dataset.tool || it.dataset.action;
    it.classList.toggle('active', v === currentVal);
  });
  menu.hidden = false;
  positionMenu(menu, btn);
}

function applyMenuSelection(menuItem, sourceBtn) {
  const tool = menuItem.dataset.tool;
  const action = menuItem.dataset.action;
  const iconSrc = menuItem.querySelector('img')?.src;
  const label = menuItem.querySelector('span')?.textContent || '';

  if (tool) {
    sourceBtn.dataset.tool = tool;
    delete sourceBtn.dataset.action;
    const img = sourceBtn.querySelector('img[data-icon]');
    if (img && iconSrc) img.src = iconSrc;
    const group = sourceBtn.dataset.menu.replace('menu', '').toLowerCase();
    state.lastByGroup[group] = tool;
    setTool(tool);
    updateActiveToolBtn(tool);
    setStatus(label.trim());
  } else if (action) {
    sourceBtn.dataset.action = action;
    delete sourceBtn.dataset.tool;
    const img = sourceBtn.querySelector('img[data-icon]');
    if (img && iconSrc) img.src = iconSrc;
    handleToolbarAction(action);
  }
}

function wireToolbar() {
  if (!els.toolbar) return;
  els.toolbar.querySelectorAll('.tb-btn').forEach((btn) => {
    let pressTimer = null;
    let longPressed = false;

    const startPress = () => {
      longPressed = false;
      pressTimer = setTimeout(() => {
        longPressed = true;
        if (btn.dataset.menu) openMenuForButton(btn);
      }, LONG_PRESS_MS);
    };
    const cancelPress = () => {
      clearTimeout(pressTimer);
      pressTimer = null;
    };

    btn.addEventListener('pointerdown', startPress);
    btn.addEventListener('pointerup', cancelPress);
    btn.addEventListener('pointerleave', cancelPress);
    btn.addEventListener('pointercancel', cancelPress);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (longPressed) { longPressed = false; return; }

      const action = btn.dataset.action;
      const tool = btn.dataset.tool;
      if (tool) {
        setTool(tool);
        updateActiveToolBtn(tool);
      } else if (action === 'color') {
        const wasOpen = els.colorMenu ? !els.colorMenu.hidden : false;
        closeAllMenus();
        if (!wasOpen && els.colorMenu) {
          els.colorMenu.hidden = false;
          positionMenu(els.colorMenu, btn);
        }
      } else if (action) {
        handleToolbarAction(action);
      }
    });
  });

  document.querySelectorAll('.tool-menu').forEach((menu) => {
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.tool-menu-item');
      if (!item) return;
      e.stopPropagation();
      const menuId = menu.id;
      const sourceBtn = els.toolbar.querySelector(`[data-menu="${menuId}"]`);
      if (sourceBtn) applyMenuSelection(item, sourceBtn);
      closeAllMenus();
    });
  });

  document.addEventListener('click', (e) => {
    const inToolbar = els.toolbar && els.toolbar.contains(e.target);
    const inColor = els.colorMenu && els.colorMenu.contains(e.target);
    const inMenu = e.target.closest('.tool-menu');
    if (!inToolbar && !inColor && !inMenu) {
      closeAllMenus();
    }
  });

  window.addEventListener('resize', closeAllMenus);
  if (els.canvasScroll) {
    els.canvasScroll.addEventListener('scroll', closeAllMenus, { passive: true });
  }
}

function updateActiveToolBtn(tool) {
  if (!els.toolbar) return;
  els.toolbar.querySelectorAll('.tb-btn').forEach((b) => {
    const t = b.dataset.tool;
    b.classList.toggle('active', t === tool);
  });
  updateBrushSliderVisibility(tool);
}

function updateBrushSliderVisibility(tool) {
  if (!els.brushSlider) return;
  const needsSlider = ['pencil', 'brush', 'eraser', 'fill'].includes(tool)
                    || (tool && tool.startsWith('shape-'));
  els.brushSlider.hidden = !needsSlider;
}

/* ============================================================
   ACCIONES
   ============================================================ */
function handleToolbarAction(action) {
  switch (action) {
    case 'open':        openFileDialog(); break;
    case 'new':         openNewModal(); break;
    case 'save':        buildSaveModal(); openModal(els.modalSave); break;
    case 'rotate-left': doRotate(-1); pushHistory(); markDirty(); break;
    case 'rotate-right':doRotate(1);  pushHistory(); markDirty(); break;
    case 'flip-h':      doFlip('h');  pushHistory(); markDirty(); break;
    case 'flip-v':      doFlip('v');  pushHistory(); markDirty(); break;
    case 'resize':      openResizeModal(); break;
    case 'crop':        handleCrop(); break;
    case 'copy':        copySelection(); break;
    case 'paste':       pasteFromClipboard(); break;
    case 'zoom-in':     zoom(1.25); break;
    case 'zoom-out':    zoom(0.8);  break;
    case 'zoom-fit':    zoomFit(); setStatus('Ajustado a pantalla'); break;
    case 'undo':        undo(); break;
    case 'redo':        redo(); break;
  }
}

function handleCrop() {
  const sel = getActiveSelection();
  if (sel && !sel.floating) {
    cropToSelection(sel.rect);
    pushHistory(); markDirty();
    setStatus(`Recortado a ${sel.rect.w} × ${sel.rect.h} px`);
  } else {
    setStatus('No hay selección activa para recortar');
  }
}

async function copySelection() {
  const sel = getActiveSelection();
  let blob;

  if (sel && sel.rect && sel.rect.w > 1 && sel.rect.h > 1) {
    const canvas = getMainCanvas();
    if (sel.floating) {
      const floatingCanvas = document.getElementById('floatingCanvas');
      if (!floatingCanvas) return;
      blob = await new Promise((res) => floatingCanvas.toBlob(res, 'image/png'));
    } else {
      const tmp = document.createElement('canvas');
      tmp.width = sel.rect.w;
      tmp.height = sel.rect.h;
      tmp.getContext('2d').drawImage(
        canvas,
        sel.rect.x, sel.rect.y, sel.rect.w, sel.rect.h,
        0, 0, sel.rect.w, sel.rect.h
      );
      blob = await new Promise((res) => tmp.toBlob(res, 'image/png'));
    }
    setStatus(`Copiado: ${sel.rect.w} × ${sel.rect.h} px`);
  } else {
    const canvas = getMainCanvas();
    blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    setStatus('Canvas completo copiado');
  }

  if (!blob) return;

  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } else {
      setStatus('Copiado no soportado en este navegador');
    }
  } catch (e) {
    setStatus('No se pudo copiar');
  }
}

async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imgType = item.types.find((t) => t.startsWith('image/'));
      if (imgType) {
        const blob = await item.getType(imgType);
        const mod = await import('./canvas.js');
        if (typeof mod.pasteAsFloating === 'function') {
          await mod.pasteAsFloating(blob);
        }
        return;
      }
    }
    setStatus('No hay imagen en el portapapeles');
  } catch (e) {
    setStatus('Permiso de portapapeles denegado');
  }
}

/* ============================================================
   MENÚ DE COLOR
   ============================================================ */
const CLASSIC_COLORS = [
  '#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8',
  '#3f48cc', '#a349a4', '#ffffff', '#c3c3c3', '#b97aae', '#ffaec9', '#ffc90e', '#efe4b0',
  '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7', '#6b4423', '#7b68ee', '#ff69b4', '#00ced1'
];

function renderColorMenu() {
  if (!els.colorMenuGrid) return;
  els.colorMenuGrid.innerHTML = '';
  for (const color of CLASSIC_COLORS) {
    const sw = document.createElement('div');
    sw.className = 'color-swatch';
    sw.style.background = color;
    sw.title = color;
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      const activeTab = els.colorMenu
        ? els.colorMenu.querySelector('.color-tab.active')?.dataset.ctab
        : 'primary';
      if (activeTab === 'secondary') {
        setSecondaryColor(color);
      } else {
        setPrimaryColor(color);
        if (els.colorBtnSwatch) els.colorBtnSwatch.style.background = color;
      }
      syncColorUI();
    });
    els.colorMenuGrid.appendChild(sw);
  }
}

function syncColorUI() {
  if (els.colorPrimary) els.colorPrimary.value = state.primary;
  if (els.colorSecondary) els.colorSecondary.value = state.secondary;
  if (els.colorBtnSwatch) els.colorBtnSwatch.style.background = state.primary;
}

function wireColorMenu() {
  if (!els.colorMenu) return;

  const closeBtn = els.colorMenu.querySelector('[data-close-color]');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      els.colorMenu.hidden = true;
    });
  }

  els.colorMenu.querySelectorAll('.color-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      e.stopPropagation();
      const which = tab.dataset.ctab;
      els.colorMenu.querySelectorAll('.color-tab').forEach((t) => t.classList.toggle('active', t === tab));
      els.colorMenu.querySelectorAll('.color-tab-panel').forEach((p) =>
        p.classList.toggle('active', p.dataset.cpanel === which)
      );
    });
  });

  if (els.colorPrimary) {
    els.colorPrimary.addEventListener('input', () => {
      setPrimaryColor(els.colorPrimary.value);
      if (els.colorBtnSwatch) els.colorBtnSwatch.style.background = state.primary;
    });
  }
  if (els.colorSecondary) {
    els.colorSecondary.addEventListener('input', () => {
      setSecondaryColor(els.colorSecondary.value);
    });
  }

  if (els.colorCustomAdd) {
    els.colorCustomAdd.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = els.colorCustom ? els.colorCustom.value : '#000000';
      if (!CLASSIC_COLORS.includes(color)) CLASSIC_COLORS.unshift(color);
      const activeTab = els.colorMenu.querySelector('.color-tab.active')?.dataset.ctab;
      if (activeTab === 'secondary') {
        setSecondaryColor(color);
      } else {
        setPrimaryColor(color);
        if (els.colorBtnSwatch) els.colorBtnSwatch.style.background = color;
      }
      renderColorMenu();
      setStatus(`Color ${color} seleccionado`);
    });
  }

  els.colorMenu.addEventListener('click', (e) => e.stopPropagation());
}

/* ============================================================
   SLIDER VERTICAL
   ============================================================ */
function wireBrushSlider() {
  if (!els.brushSizeRange) return;
  els.brushSizeRange.addEventListener('input', () => {
    const v = Number(els.brushSizeRange.value);
    state.strokeSize = v;
    if (els.brushSizeValue) els.brushSizeValue.textContent = v;
  });
}

/* ============================================================
   MODALES
   ============================================================ */
function wireModalClosing() {
  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target.hasAttribute('data-close') || e.target.classList.contains('modal-backdrop')) {
        closeModal(modal);
      }
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const abierto = document.querySelector('.modal:not([hidden])');
      if (abierto) { closeModal(abierto); return; }
      commitFloating();
      clearShapeSelection();
      closeAllMenus();
    }
  });
}

function wireHelpTabs() {
  document.querySelectorAll('.modal .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const panel = tab.dataset.tab;
      const modal = tab.closest('.modal');
      if (!modal) return;
      modal.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      modal.querySelectorAll('.tab-panel').forEach((p) =>
        p.classList.toggle('active', p.dataset.panel === panel)
      );
    });
  });
}

/* ============================================================
   MODAL NUEVO
   ============================================================ */
function openNewModal() {
  const sel = document.getElementById('newPreset');
  if (sel && !sel.dataset.filled) {
    sel.innerHTML = '<option value="">— Personalizado —</option>';
    for (const [key, cfg] of Object.entries(SHEET_SIZES)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = cfg.label;
      sel.appendChild(opt);
    }
    sel.dataset.filled = '1';
  }
  const newW = document.getElementById('newW');
  const newH = document.getElementById('newH');
  const newT = document.getElementById('newTransparent');
  const hint = document.getElementById('newHint');
  if (newW) newW.value = 600;
  if (newH) newH.value = 800;
  if (newT) newT.checked = false;
  if (sel) sel.value = '';
  if (hint) hint.textContent = '600 × 800 px — tamaño por defecto';
  openModal(els.modalNew);
}

function wireNewModal() {
  const sel  = document.getElementById('newPreset');
  const wIn  = document.getElementById('newW');
  const hIn  = document.getElementById('newH');
  const hint = document.getElementById('newHint');

  if (sel) {
    sel.addEventListener('change', () => {
      const cfg = SHEET_SIZES[sel.value];
      if (!cfg) { if (hint) hint.textContent = 'Tamaño personalizado'; return; }
      const wpx = cmToPx(cfg.w);
      const hpx = cmToPx(cfg.h);
      if (wIn) wIn.value = wpx;
      if (hIn) hIn.value = hpx;
      if (hint) hint.textContent = `${cfg.label} → ${wpx} × ${hpx} px`;
    });
  }

  const btn = document.getElementById('btnNewConfirm');
  if (btn) {
    btn.addEventListener('click', () => {
      const w = Math.max(1, Number(wIn ? wIn.value : 600) || 600);
      const h = Math.max(1, Number(hIn ? hIn.value : 800) || 800);
      const transparent = document.getElementById('newTransparent')?.checked;
      createNewCanvas(w, h, transparent ? 'transparent' : 'white');
      closeModal(els.modalNew);
    });
  }
}

/* ============================================================
   NUEVO LIENZO
   ============================================================ */
export function createNewCanvas(w, h, bg = 'white') {
  const canvas = getMainCanvas();
  const overlay = document.getElementById('overlayCanvas');
  if (!canvas || !overlay) return;

  commitFloating();
  clearShapeSelection();

  canvas.width = w;
  canvas.height = h;
  overlay.width = w;
  overlay.height = h;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  if (bg === 'white') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }

  state.fileName = 'Sin título';
  state.originalBuffer = null;
  state.fileType = 'image/png';
  state.transparentBg = (bg === 'transparent');
  state.history = [];
  state.historyIndex = -1;
  state.zoom = 1;

  if (els.fileName) els.fileName.value = state.fileName;

  if (els.canvasWrap) {
    els.canvasWrap.style.transform = 'scale(1)';
    els.canvasWrap.style.transformOrigin = '0 0';
  }
  if (els.canvasScroll) {
    els.canvasScroll.scrollLeft = 0;
    els.canvasScroll.scrollTop = 0;
  }

  syncWrapSize();
  pushHistory();
  markDirty(false);
  updateFooterInfo();

  requestAnimationFrame(() => {
    zoomFit();
    setStatus(`Nuevo lienzo ${w} × ${h} px`);
  });
}

/* ============================================================
   MODAL RESIZE
   ============================================================ */
function openResizeModal() {
  const c = getMainCanvas();
  if (!c) return;
  const rw = document.getElementById('resizeW');
  const rh = document.getElementById('resizeH');
  const rp = document.getElementById('resizePct');
  if (rw) rw.value = c.width;
  if (rh) rh.value = c.height;
  if (rp) rp.value = 100;
  openModal(els.modalResize);
}

function wireResizeModal() {
  const wIn = document.getElementById('resizeW');
  const hIn = document.getElementById('resizeH');
  const ratio = document.getElementById('resizeRatio');
  const pct = document.getElementById('resizePct');
  const c = () => getMainCanvas();

  let baseW = 0, baseH = 0;
  const modal = els.modalResize;
  if (modal) {
    const obs = new MutationObserver(() => {
      if (!modal.hidden) {
        const canvas = c();
        if (canvas) {
          baseW = canvas.width;
          baseH = canvas.height;
        }
      }
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['hidden'] });
  }

  if (wIn) {
    wIn.addEventListener('input', () => {
      if (!ratio || !ratio.checked || !baseW || !baseH) return;
      const w = Number(wIn.value) || 0;
      if (hIn) hIn.value = Math.round(w * (baseH / baseW));
    });
  }
  if (hIn) {
    hIn.addEventListener('input', () => {
      if (!ratio || !ratio.checked || !baseW || !baseH) return;
      const h = Number(hIn.value) || 0;
      if (wIn) wIn.value = Math.round(h * (baseW / baseH));
    });
  }
  if (pct) {
    pct.addEventListener('input', () => {
      const p = Number(pct.value) || 100;
      if (wIn) wIn.value = Math.round(baseW * p / 100);
      if (hIn) hIn.value = Math.round(baseH * p / 100);
    });
  }

  const btn = document.getElementById('btnResizeConfirm');
  if (btn) {
    btn.addEventListener('click', () => {
      const w = Math.max(1, Number(wIn ? wIn.value : baseW) || baseW);
      const h = Math.max(1, Number(hIn ? hIn.value : baseH) || baseH);
      doResize(w, h);
      syncWrapSize();
      pushHistory(); markDirty();
      closeModal(els.modalResize);
      setStatus(`Redimensionado a ${w} × ${h} px`);
      requestAnimationFrame(() => zoomFit());
    });
  }
}

/* ============================================================
   ATAJOS
   ============================================================ */
function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
    if (typing) return;

    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); buildSaveModal(); openModal(els.modalSave); return; }
    if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); openFileDialog(); return; }
    if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); openNewModal(); return; }
    if (ctrl && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return; }
    if (ctrl && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteFromClipboard(); return; }

    if (!ctrl) {
      switch (e.key.toLowerCase()) {
        case 'p': activateTool('pencil'); break;
        case 'b': activateTool('brush'); break;
        case 'e': activateTool('eraser'); break;
        case 'f': activateTool('fill'); break;
        case 't': activateTool('text'); break;
        case 'i': activateTool('picker'); break;
        case 'w': activateTool('select-wand'); break;
        case '+': case '=': zoom(1.25); break;
        case '-': case '_': zoom(0.8); break;
        case '0': zoomFit(); break;
        case '1': zoom100(); break;
        case '[': changeBrushSize(-1); break;
        case ']': changeBrushSize(1); break;
      }
    }
  });
}

function activateTool(tool) {
  setTool(tool);
  updateActiveToolBtn(tool);
}

function changeBrushSize(delta) {
  const v = Math.max(1, Math.min(100, state.strokeSize + delta));
  if (els.brushSizeRange) {
    els.brushSizeRange.value = v;
    els.brushSizeRange.dispatchEvent(new Event('input'));
  }
}

/* ============================================================
   EMOJI PICKER
   ============================================================ */
const EMOJI_CATEGORIES = {
  'Caritas':    ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  'Gestos':     ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄','💋','🩸'],
  'Animales':   ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🪶','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔'],
  'Comida':     ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','🫖','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🧊'],
  'Objetos':    ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','🪤','🧱','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','🧿','💈','⚗️','🔭','🔬','🕳️','🩹','🩺','💊','💉','🩸','🧬','🦠','🧫','🧪','🌡️','🧹','🧺','🧻','🚽','🚰','🚿','🛁','🛀','🧼','🪥','🪒','🧽','🪣','🧴','🛎️','🔑','🗝️','🚪','🪑','🛋️','🛏️','🛌','🧸','🪆','🖼️','🪞','🪟','🛍️','🛒','🎁','🎈','🎏','🎀','🪄','🪅','🎊','🎉','🎎','🏮','🎐','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','🏷️','📪','📫','📬','📭','📮','📯','📜','📃','📄','📑','🧾','📊','📈','📉','🗒️','🗓️','📆','📅','🗑️','📇','🗃️','🗳️','🗄️','📋','📁','📂','🗂️','🗞️','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🧷','🔗','📎','🖇️','📐','📏','🧮','📌','📍','✂️','🖊️','🖋️','✒️','🖌️','🖍️','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓'],
  'Símbolos':   ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','⚧️','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗','✖️','♾️','💲','💱','™️','©️','®️','〰️','➰','➿','🔚','🔙','🔛','🔝','🔜','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫','🔈','🔇','🔉','🔊','🔔','🔕','📣','📢','👁️‍🗨️','💬','💭','🗯️','♠️','♣️','♥️','♦️','🃏','🎴','🀄','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚','🕛'],
  'Viajes':     ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🦯','🦽','🦼','🛴','🚲','🛵','🏍️','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🛰️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','⛽','🚧','🚦','🚥','🚏','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛱️','🏖️','🏝️','🏜️','🌋','⛰️','🏔️','🗻','🏕️','⛺','🏠','🏡','🏘️','🏚️','🏗️','🏭','🏢','🏬','🏣','🏤','🏥','🏦','🏨','🏪','🏫','🏩','💒','🏛️','⛪','🕌','🕍','🛕','🕋','⛩️','🛤️','🛣️','🗾','🎑','🏞️','🌅','🌄','🌠','🎇','🎆','🌇','🌆','🏙️','🌃','🌌','🌉','🌁'],
  'Naturaleza': ['🌍','🌎','🌏','🌐','🗺️','🧭','🏔️','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🏞️','🏟️','🏛️','🏗️','🏘️','🏚️','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🕋','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','♨️','🎠','🎡','🎢','💈','🎪','🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','🚊','🚝','🚞','🚋','🚌','🚍','🚎','🚏','🚐','🚑','🚒','🚓','🚔','🚕','🚖','🚗','🚘','🚙','🚚','🚛','🚜','🏎️','🏍️','🛵','🦯','🦽','🦼','🛺','🚲','🛴','🛹','🛼','🛣️','🛤️','🛢️','⛽','🚨','🚥','🚦','🛑','🚧','⚓','⛵','🛶','🚤','🛳️','⛴️','🛥️','🚢','✈️','🛩️','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛰️','🚀','🛸','🪐','🌠','🌌','⛱️','🌋','⛰️','🏔️','🗻','🏕️','🏖️','🏜️','🏝️','🏞️','🌅','🌄','🌇','🌆','🏙️','🌃','🌉','🌁']
};

function renderEmojiPicker() {
  if (!els.emojiTabs || !els.emojiGrid) return;
  els.emojiTabs.innerHTML = '';
  els.emojiGrid.innerHTML = '';
  const keys = Object.keys(EMOJI_CATEGORIES);
  keys.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.className = 'emoji-tab' + (i === 0 ? ' active' : '');
    btn.textContent = cat;
    btn.dataset.cat = cat;
    btn.addEventListener('click', () => {
      els.emojiTabs.querySelectorAll('.emoji-tab').forEach((t) => t.classList.toggle('active', t === btn));
      renderEmojiGrid(cat);
    });
    els.emojiTabs.appendChild(btn);
  });
  renderEmojiGrid(keys[0]);
}

function renderEmojiGrid(cat) {
  if (!els.emojiGrid) return;
  els.emojiGrid.innerHTML = '';
  for (const e of EMOJI_CATEGORIES[cat]) {
    const b = document.createElement('button');
    b.textContent = e;
    b.type = 'button';
    b.addEventListener('click', () => {
      insertEmojiIntoEditor(e);
      closeModal(els.emojiPicker);
    });
    els.emojiGrid.appendChild(b);
  }
}

function insertEmojiIntoEditor(emoji) {
  const editor = els.teText;
  if (!editor) return;
  editor.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    editor.textContent += emoji;
    return;
  }
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    editor.textContent += emoji;
    return;
  }
  range.deleteContents();
  const node = document.createTextNode(emoji);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function wireEmojiPicker() {
  if (!els.teEmoji) return;
  els.teEmoji.addEventListener('click', (e) => {
    e.stopPropagation();
    renderEmojiPicker();
    openModal(els.emojiPicker);
  });
}

/* ============================================================
   INIT
   ============================================================ */
async function init() {
  try {
    console.log('[JPB] ▶ Inicializando…');

    setTimeout(() => { if (els.splash) els.splash.classList.add('hide'); }, 2000);

    initCanvas();
    initTools();

    renderColorMenu();
    syncColorUI();
    renderPalette();
    updateFooterInfo();

    wireToolbar();
    wireColorMenu();
    wireBrushSlider();
    wireModalClosing();
    wireHelpTabs();
    wireNewModal();
    wireResizeModal();
    wireKeyboard();
    wireEmojiPicker();

    if (els.btnOpen)  els.btnOpen.addEventListener('click', () => openFileDialog());
    if (els.btnNew)   els.btnNew.addEventListener('click', () => openNewModal());
    if (els.btnSave)  els.btnSave.addEventListener('click', () => { buildSaveModal(); openModal(els.modalSave); });
    if (els.btnUndo)  els.btnUndo.addEventListener('click', undo);
    if (els.btnRedo)  els.btnRedo.addEventListener('click', redo);
    if (els.btnCopy)  els.btnCopy.addEventListener('click', copySelection);
    if (els.btnPaste) els.btnPaste.addEventListener('click', pasteFromClipboard);
    if (els.btnTheme) els.btnTheme.addEventListener('click', toggleTheme);
    if (els.btnHelp)  els.btnHelp.addEventListener('click', () => openModal(els.modalHelp));

    if (els.fileInput) {
      els.fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) await openFromFile(file);
        els.fileInput.value = '';
      });
    }

    if (els.canvasArea) {
      ['dragenter', 'dragover'].forEach((ev) =>
        els.canvasArea.addEventListener(ev, (e) => e.preventDefault())
      );
      els.canvasArea.addEventListener('drop', async (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) await openFromFile(file);
      });
    }

    document.addEventListener('paste', async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            const mod = await import('./canvas.js');
            if (typeof mod.pasteAsFloating === 'function') {
              await mod.pasteAsFloating(blob);
            }
          }
          return;
        }
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }

    await handleFileHandlerLaunch();
    await handleSharedFile();

    createNewCanvas(600, 800, 'white');
    activateTool('pencil');

    if (els.brushSizeRange) els.brushSizeRange.value = state.strokeSize;
    if (els.brushSizeValue) els.brushSizeValue.textContent = state.strokeSize;

    setStatus('Listo');
    console.log('[JPB] ✓ Listo');
  } catch (err) {
    console.error('[JPB] ✗ Error en init():', err);
    setStatus('Error al iniciar (ver consola)');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { SHEET_SIZES, cmToPx };