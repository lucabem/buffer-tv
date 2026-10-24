#!/bin/bash
# Compila y lanza la aplicación
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -d node_modules ] || [ ! -x node_modules/.bin/electron ]; then
  echo "[!] Faltan dependencias. Ejecuta ./install.sh primero"
  exit 1
fi

npm run build >/dev/null
exec ./node_modules/.bin/electron .
