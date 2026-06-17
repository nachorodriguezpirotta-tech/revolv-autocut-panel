#!/bin/bash
# Instalador de Revolv AutoCut para Mac — vía Terminal (no se "daña" como el .command).
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/nachorodriguezpirotta-tech/revolv-autocut-panel/main/install.sh | bash

set -e

REPO_ZIP="https://codeload.github.com/nachorodriguezpirotta-tech/revolv-autocut-panel/zip/refs/heads/main"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.revolv.autocut"
TMP="$(mktemp -d)"

echo "✂️  Instalando Revolv AutoCut…"

# 1. Bajar el panel desde GitHub (siempre la última versión)
echo "⬇️  Descargando panel…"
curl -fsSL -o "$TMP/panel.zip" "$REPO_ZIP"
unzip -q -o "$TMP/panel.zip" -d "$TMP"
SRC="$TMP/revolv-autocut-panel-main"

# 2. Copiar a la carpeta de extensiones de Premiere
mkdir -p "$DEST"
rm -rf "$DEST/CSXS" "$DEST/js" "$DEST/jsx" "$DEST/helper" "$DEST/index.html" "$DEST/version.json"
cp -R "$SRC/CSXS" "$SRC/js" "$SRC/jsx" "$SRC/helper" "$SRC/index.html" "$SRC/version.json" "$DEST/"

# 3. Habilitar paneles sin firma (modo developer)
for v in 9 10 11 12; do
  defaults write com.adobe.CSXS.$v PlayerDebugMode 1 2>/dev/null || true
done
killall cfprefsd 2>/dev/null || true

# 4. faster-whisper (detección de palabras)
if ! /usr/bin/python3 -c "import faster_whisper" 2>/dev/null; then
  echo "📦 Instalando faster-whisper (una sola vez)…"
  /usr/bin/python3 -m pip install --user faster-whisper >/dev/null 2>&1 || \
    /usr/bin/python3 -m pip install --user --break-system-packages faster-whisper >/dev/null 2>&1 || true
fi

# 5. ffmpeg (si no está, el panel igual lo baja solo al primer uso)
if ! command -v ffmpeg >/dev/null 2>&1 && [ ! -x "$HOME/bin/ffmpeg" ] \
   && [ ! -x /opt/homebrew/bin/ffmpeg ] && [ ! -x /usr/local/bin/ffmpeg ]; then
  echo "📦 Descargando ffmpeg (una sola vez)…"
  mkdir -p "$HOME/bin"
  curl -fsSL -o "$TMP/ffmpeg.zip" "https://evermeet.cx/ffmpeg/getrelease/zip" \
    && unzip -o -q "$TMP/ffmpeg.zip" -d "$HOME/bin" \
    && chmod +x "$HOME/bin/ffmpeg" \
    && xattr -d com.apple.quarantine "$HOME/bin/ffmpeg" 2>/dev/null || true
fi

rm -rf "$TMP"

echo ""
echo "✅ Listo."
echo "1. Cerrá y volvé a abrir Premiere Pro"
echo "2. Window (Ventana) → Extensions → Revolv AutoCut"
