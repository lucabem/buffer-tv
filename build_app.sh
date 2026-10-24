#!/bin/bash
# Genera "BufferTV.app" en la raíz del proyecto: una app de
# escritorio de doble clic que lanza la GUI sin necesitar terminal.
#
# (Versión Electron: el .app lanza el binario de node_modules/ con el proyecto.)
#
# Enfoque anterior (Python): NO se usa py2app (es frágil para apps Tkinter con dependencias
# nativas de Tcl/Tk de Homebrew: hay que re-empaquetar librerías C y es
# fácil acabar con un .app que "compila" pero no arranca). En su lugar se
# genera un .app wrapper mínimo que simplemente activa el venv del
# proyecto y ejecuta app.py, igual que run.sh.
#
# Detalle importante descubierto durante el desarrollo de este script:
# en las versiones recientes de macOS, LaunchServices/Finder RECHAZA abrir
# un .app cuyo CFBundleExecutable sea directamente un script de shell (se
# registra con la marca interna "shell-script" y `open`/doble clic falla
# con LSOpenURLsWithCompletionHandler error -10669, aunque el script en sí
# funcione perfectamente si se ejecuta a mano). Por eso el ejecutable real
# del bundle es un pequeño binario Mach-O generado con `osacompile` (un
# applet de AppleScript compilado) que simplemente hace `do shell script`
# para invocar nuestro script de lanzamiento. Esto es 100% nativo de
# macOS (osacompile viene con el sistema), no añade dependencias, y es
# compatible con Finder/LaunchServices/Gatekeeper sin firmar con un
# certificado de pago (se firma ad-hoc).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="BufferTV"
APP_DIR="$SCRIPT_DIR/$APP_NAME.app"
BUNDLE_ID="com.lucabem.buffertv"
ICON_SRC="$SCRIPT_DIR/AppIcon.icns"
PROJECT_DIR="$SCRIPT_DIR"

if [ ! -x node_modules/.bin/electron ]; then
    echo "[!] No se encontraron dependencias (node_modules/). Ejecuta ./install.sh primero."
    exit 1
fi

# --- Script de lanzamiento real (lo que hace el doble clic) ---------------
# Vive dentro del propio .app (Contents/Resources/launch.sh). Hace lo mismo
# que run.sh: cd al proyecto y ejecutar venv/bin/python3 app.py. Los
# errores quedan en un log, porque al abrir desde Finder no hay terminal
# visible para verlos.
LAUNCH_SH_CONTENT=$(cat <<LAUNCH
#!/bin/bash
PROJECT_DIR="$PROJECT_DIR"
LOG_FILE="\$HOME/Library/Logs/BufferTV.log"
# Finder no hereda el PATH de la terminal: sin esto no encuentra node/npm de Homebrew.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\$PATH"

cd "\$PROJECT_DIR" || {
    osascript -e 'display alert "BufferTV" message "No se encontró el proyecto en '"\$PROJECT_DIR"'."'
    exit 1
}

if [ ! -x "node_modules/.bin/electron" ]; then
    osascript -e 'display alert "BufferTV" message "No se encontraron dependencias. Ejecuta ./install.sh desde una terminal en el proyecto."'
    exit 1
fi

{
    echo "--- \$(date) ---"
    npm run build >/dev/null 2>&1; exec ./node_modules/.bin/electron .
} >> "\$LOG_FILE" 2>&1
LAUNCH
)

# --- Fuente AppleScript (se compila a un binario Mach-O real) -------------
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
LAUNCH_SH_PATH="$APP_DIR/Contents/Resources/launch.sh"

cat > "$WORKDIR/launcher.applescript" <<APPLESCRIPT
do shell script "'$LAUNCH_SH_PATH'"
APPLESCRIPT

echo "[*] Compilando el lanzador nativo (osacompile)..."
rm -rf "$APP_DIR"
osacompile -o "$APP_DIR" "$WORKDIR/launcher.applescript"

echo "[*] Instalando launch.sh dentro del bundle..."
printf '%s\n' "$LAUNCH_SH_CONTENT" > "$LAUNCH_SH_PATH"
chmod +x "$LAUNCH_SH_PATH"

# --- Info.plist: limpiar claves que no aplican y fijar identidad ----------
PLIST="$APP_DIR/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy

for key in NSAppleEventsUsageDescription NSAppleMusicUsageDescription \
           NSCalendarsUsageDescription NSCameraUsageDescription \
           NSContactsUsageDescription NSHomeKitUsageDescription \
           NSMicrophoneUsageDescription NSPhotoLibraryUsageDescription \
           NSRemindersUsageDescription NSSiriUsageDescription \
           NSSystemAdministrationUsageDescription LSRequiresCarbon \
           CFBundleAllowMixedLocalizations CFBundleIconName; do
    "$PB" -c "Delete :$key" "$PLIST" >/dev/null 2>&1 || true
done

"$PB" -c "Set :CFBundleName '$APP_NAME'" "$PLIST"
"$PB" -c "Add :CFBundleDisplayName string '$APP_NAME'" "$PLIST" 2>/dev/null || \
    "$PB" -c "Set :CFBundleDisplayName '$APP_NAME'" "$PLIST"
"$PB" -c "Add :CFBundleIdentifier string $BUNDLE_ID" "$PLIST" 2>/dev/null || \
    "$PB" -c "Set :CFBundleIdentifier $BUNDLE_ID" "$PLIST"
"$PB" -c "Add :CFBundleVersion string 2.0" "$PLIST" 2>/dev/null || \
    "$PB" -c "Set :CFBundleVersion 2.0" "$PLIST"
"$PB" -c "Add :CFBundleShortVersionString string 2.0" "$PLIST" 2>/dev/null || \
    "$PB" -c "Set :CFBundleShortVersionString 2.0" "$PLIST"
"$PB" -c "Add :LSApplicationCategoryType string public.app-category.video" "$PLIST" 2>/dev/null || true
"$PB" -c "Add :NSHighResolutionCapable bool true" "$PLIST" 2>/dev/null || \
    "$PB" -c "Set :NSHighResolutionCapable true" "$PLIST"
"$PB" -c "Add :NSHumanReadableCopyright string 'BufferTV'" "$PLIST" 2>/dev/null || true
"$PB" -c "Add :LSUIElement bool false" "$PLIST" 2>/dev/null || true
"$PB" -c "Set :OSAAppletShowStartupScreen false" "$PLIST" 2>/dev/null || true

# --- Icono -----------------------------------------------------------------
RESOURCES_DIR="$APP_DIR/Contents/Resources"
if [ -f "$ICON_SRC" ]; then
    # osacompile deja Resources/applet.icns referenciado por
    # CFBundleIconFile=applet; lo sobrescribimos con nuestro icono para no
    # tener que tocar más claves del plist. También quitamos el catálogo de
    # assets (Assets.car) que si no, tiene prioridad en Finder/Dock sobre el
    # .icns y mostraría el icono genérico de applet de AppleScript.
    cp "$ICON_SRC" "$RESOURCES_DIR/applet.icns"
    rm -f "$RESOURCES_DIR/Assets.car"
    echo "[*] Icono incluido (AppIcon.icns)."
else
    echo "[!] No se encontró $ICON_SRC: el .app se generará SIN icono personalizado"
    echo "    (usará el icono genérico de applet de AppleScript)."
fi

# --- Firma ad-hoc ------------------------------------------------------------
# Tras modificar el contenido del bundle hay que re-firmar (ad-hoc, sin
# certificado de pago) para que los recursos sellados por osacompile sigan
# siendo consistentes y Gatekeeper no se queje.
echo "[*] Firmando el bundle (ad-hoc)..."
codesign --force --deep --sign - "$APP_DIR" >/dev/null 2>&1 || true

echo "[OK] App generada: $APP_DIR"
echo "     Ábrela con: open \"$APP_DIR\""
echo "     Log de ejecución: ~/Library/Logs/BufferTV.log"
