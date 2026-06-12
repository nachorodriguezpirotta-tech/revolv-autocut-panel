#!/bin/bash
# Instalador del panel "Revolv AutoCut" para Premiere Pro (Mac).
# Doble click y listo. Después reiniciá Premiere.

set -e
cd "$(dirname "$0")"

DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.revolv.autocut"

echo "✂️  Instalando Revolv AutoCut…"
mkdir -p "$DEST"
rm -rf "$DEST/CSXS" "$DEST/js" "$DEST/jsx" "$DEST/helper" "$DEST/index.html"
cp -R CSXS js jsx helper index.html "$DEST/"

# Habilitar paneles sin firma (modo developer) para todas las versiones de CEP
for v in 9 10 11 12; do
  defaults write com.adobe.CSXS.$v PlayerDebugMode 1 2>/dev/null || true
done
killall cfprefsd 2>/dev/null || true

# Dependencia de detección (faster-whisper). Si ya está, no hace nada.
if ! /usr/bin/python3 -c "import faster_whisper" 2>/dev/null; then
  echo "📦 Instalando faster-whisper (una sola vez)…"
  /usr/bin/python3 -m pip install --user faster-whisper || true
fi

# ffmpeg: si no está en ningún lado, bajar build estática a ~/bin
if ! command -v ffmpeg >/dev/null 2>&1 && [ ! -x "$HOME/bin/ffmpeg" ] \
   && [ ! -x /opt/homebrew/bin/ffmpeg ] && [ ! -x /usr/local/bin/ffmpeg ]; then
  echo "📦 Descargando ffmpeg (una sola vez, ~25MB)…"
  mkdir -p "$HOME/bin"
  curl -L -o /tmp/ffmpeg.zip "https://evermeet.cx/ffmpeg/getrelease/zip" \
    && unzip -o -q /tmp/ffmpeg.zip -d "$HOME/bin" \
    && chmod +x "$HOME/bin/ffmpeg" \
    && xattr -d com.apple.quarantine "$HOME/bin/ffmpeg" 2>/dev/null
  rm -f /tmp/ffmpeg.zip
  if [ -x "$HOME/bin/ffmpeg" ]; then
    echo "   ffmpeg instalado en ~/bin/ffmpeg ✓"
  else
    echo "   ⚠️ No pude bajar ffmpeg — instalalo a mano (brew install ffmpeg)"
  fi
fi

echo ""
echo "✅ Listo."
echo "1. Cerrá y volvé a abrir Premiere Pro"
echo "2. Menú: Window (Ventana) → Extensions (Extensiones) → Revolv AutoCut"
echo ""
read -p "Apretá Enter para cerrar…"
