#!/bin/bash
# Instalación de BufferTV (Electron + TypeScript)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

command -v node >/dev/null || { echo "❌ Node.js no está instalado (macOS: brew install node · Linux: usa tu gestor de paquetes)"; exit 1; }

if command -v ffmpeg >/dev/null && command -v ffplay >/dev/null && command -v ffprobe >/dev/null; then
  echo "✓ ffmpeg ya está instalado (ffmpeg, ffplay, ffprobe)"
elif [ "$(uname -s)" = "Darwin" ]; then
  command -v brew >/dev/null || { echo "❌ Homebrew no está instalado: https://brew.sh"; exit 1; }
  echo "📥 Instalando ffmpeg (incluye ffplay y ffprobe)..."
  brew install ffmpeg
else
  echo "❌ Falta ffmpeg con ffplay y ffprobe. Instálalo con tu gestor de paquetes:"
  echo "   Debian/Ubuntu: sudo apt install ffmpeg"
  echo "   Fedora:        sudo dnf install ffmpeg   (puede requerir RPM Fusion)"
  echo "   Arch:          sudo pacman -S ffmpeg"
  exit 1
fi

echo "📦 Instalando dependencias (incluye el binario de Electron)..."
# npm 11 no ejecuta scripts de instalación por defecto; Electron necesita el suyo.
npm install
npm rebuild electron esbuild >/dev/null 2>&1 || true
[ -x node_modules/.bin/electron ] || node node_modules/electron/install.js

echo "🏗  Compilando..."
npm run build
echo "✨ Listo. Ejecuta ./run.sh"
