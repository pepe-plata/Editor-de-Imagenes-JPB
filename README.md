# 🎨 Editor de Imagenes JPB

PWA de edición de imágenes tipo **MS Paint**, optimizada para **Android** y **Windows**.
Sin frameworks. HTML + CSS + JavaScript puro (vanilla).

---

## ✨ Características

- 🖌️ **Herramientas**: lápiz, pincel, goma, relleno (bote), cuentagotas, texto, selección (rectangular y lazo).
- 🔷 **Figuras**: línea, flecha, rectángulo, cuadrado, círculo, elipse, triángulo, estrella, globo de texto rectangular y ovalado.
- 🔄 **Transformaciones**: rotar ±90°, voltear H/V, redimensionar por píxeles o %, recortar a la selección.
- 🎨 **Paleta de colores** personalizable con añadir color propio.
- 📝 **Texto** configurable: fuente, tamaño, negrita, cursiva, subrayado.
- 📂 **Archivos**: abrir, guardar, nuevo lienzo, drag & drop, pegar desde portapapeles.
- 💾 **Formatos**: PNG, JPG, WebP, BMP (24-bit).
- ↩️ **Historial**: deshacer / rehacer (Ctrl+Z / Ctrl+Y).
- 🔍 **Zoom** con rueda / pinch y **pan** con espacio+drag / dos dedos.
- 📏 **Handles** de redimensión (8) visibles en el lienzo.
- 🌗 **Tema claro y oscuro** con persistencia.
- 📱 **PWA instalable** con *Share Target* y *File Handlers*.
- 🚫 **Sin dependencias externas**.

---

## 🚀 Instalación y uso

### 1. Servir los archivos
La PWA **necesita servirse por HTTP/HTTPS** (Service Worker no funciona en `file://`).

Opciones rápidas:
```bash
# Python
python -m http.server 8080

# Node
npx serve .

# PHP
php -S localhost:8080