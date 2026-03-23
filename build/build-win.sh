#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# miniMerch Studio — Windows installer builder (runs on macOS)
# Prerequisites: brew install nsis
# Usage: npm run build:win
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="0.4.7"
NODE_VERSION="22.14.0"    # LTS
NODE_ZIP="node-v${NODE_VERSION}-win-x64.zip"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}"
OUT_DIR="$PROJECT_DIR/release"
STAGING="$OUT_DIR/staging"

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║       miniMerch Studio — Windows build                   ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Check prerequisites ────────────────────────────────────────────────────
if ! command -v makensis &> /dev/null; then
    echo "❌  makensis not found. Install with: brew install nsis"
    exit 1
fi

cd "$PROJECT_DIR"

# ── 2. Clean previous Windows release files only (preserve Mac .dmg) ─────────
rm -rf "$OUT_DIR/staging" "$OUT_DIR/miniMerch-Studio-"*"-Setup.exe"
mkdir -p "$OUT_DIR" "$STAGING"
echo "✓  Output directory: $OUT_DIR"

# ── 3. Download portable Node.js for Windows ──────────────────────────────────
echo ""
echo "📥  Downloading portable Node.js ${NODE_VERSION} for Windows..."
NODE_CACHE="$SCRIPT_DIR/.node-win-cache"
mkdir -p "$NODE_CACHE"

if [ ! -f "$NODE_CACHE/$NODE_ZIP" ]; then
    curl -L --progress-bar "$NODE_URL" -o "$NODE_CACHE/$NODE_ZIP"
    echo "✓  Downloaded: $NODE_ZIP"
else
    echo "✓  Using cached: $NODE_ZIP"
fi

# Extract node.exe from the zip
echo "    Extracting node.exe..."
unzip -p "$NODE_CACHE/$NODE_ZIP" "node-v${NODE_VERSION}-win-x64/node.exe" > "$STAGING/node.exe"
echo "✓  node.exe extracted"

# ── 4. Stage app source files ─────────────────────────────────────────────────
echo ""
echo "📦  Staging app source files..."

mkdir -p "$STAGING/src"
mkdir -p "$STAGING/web"
mkdir -p "$STAGING/template/shop"
mkdir -p "$STAGING/template/inbox"

# Copy source files
cp "$PROJECT_DIR/src/studio.js"         "$STAGING/src/"
cp "$PROJECT_DIR/src/studio-builder.js" "$STAGING/src/"
cp "$PROJECT_DIR/src/setup.js"          "$STAGING/src/"

# Copy web UI
cp "$PROJECT_DIR/web/index.html"  "$STAGING/web/"
cp "$PROJECT_DIR/web/style.css"   "$STAGING/web/"
cp "$PROJECT_DIR/web/app.js"      "$STAGING/web/"

# Copy templates
cp -r "$PROJECT_DIR/template/shop/"  "$STAGING/template/shop/"
cp -r "$PROJECT_DIR/template/inbox/" "$STAGING/template/inbox/"

# Copy default image and package.json (needed for archiver require resolve)
cp "$PROJECT_DIR/item.jpg"       "$STAGING/"
[ -f "$PROJECT_DIR/ticket.jpg" ] && cp "$PROJECT_DIR/ticket.jpg" "$STAGING/"

# Copy dependencies (archiver + commander)
mkdir -p "$STAGING/node_modules"
cp -r "$PROJECT_DIR/node_modules/archiver"          "$STAGING/node_modules/" 2>/dev/null || true
cp -r "$PROJECT_DIR/node_modules/archiver-utils"    "$STAGING/node_modules/" 2>/dev/null || true
cp -r "$PROJECT_DIR/node_modules/async"             "$STAGING/node_modules/" 2>/dev/null || true
cp -r "$PROJECT_DIR/node_modules/buffer-crc32"      "$STAGING/node_modules/" 2>/dev/null || true
cp -r "$PROJECT_DIR/node_modules/readable-stream"   "$STAGING/node_modules/" 2>/dev/null || true
cp -r "$PROJECT_DIR/node_modules/readdir-glob"      "$STAGING/node_modules/" 2>/dev/null || true
cp -r "$PROJECT_DIR/node_modules/glob"              "$STAGING/node_modules/" 2>/dev/null || true
cp -r "$PROJECT_DIR/node_modules/zip-stream"        "$STAGING/node_modules/" 2>/dev/null || true
cp -r "$PROJECT_DIR/node_modules/compress-commons"  "$STAGING/node_modules/" 2>/dev/null || true
cp -r "$PROJECT_DIR/node_modules/crc-32"            "$STAGING/node_modules/" 2>/dev/null || true
cp -r "$PROJECT_DIR/node_modules/commander"         "$STAGING/node_modules/" 2>/dev/null || true
cp -r "$PROJECT_DIR/node_modules/lazystream"        "$STAGING/node_modules/" 2>/dev/null || true
cp -r "$PROJECT_DIR/node_modules/lodash"            "$STAGING/node_modules/" 2>/dev/null || true
cp -r "$PROJECT_DIR/node_modules/normalize-path"    "$STAGING/node_modules/" 2>/dev/null || true

# Write a minimal package.json so Node can resolve modules
cat > "$STAGING/package.json" << 'PKGJSON'
{ "name": "minimerch-studio", "version": "0.4.7", "main": "src/studio.js" }
PKGJSON

echo "✓  App files staged"

# ── 5. Generate icon.ico ──────────────────────────────────────────────────────
echo ""
echo "🎨  Generating icon..."
if [ ! -f "$SCRIPT_DIR/icon.ico" ]; then
    for size in 16 32 48 64 128 256; do
        sips -z $size $size "$PROJECT_DIR/template/shop/icon.png" --out "/tmp/icon_${size}.png" 2>/dev/null
    done
    MAGICK_CMD="magick"
    command -v magick &> /dev/null || MAGICK_CMD="convert"
    $MAGICK_CMD /tmp/icon_16.png /tmp/icon_32.png /tmp/icon_48.png /tmp/icon_64.png /tmp/icon_128.png /tmp/icon_256.png "$SCRIPT_DIR/icon.ico" 2>/dev/null
    rm -f /tmp/icon_{16,32,48,64,128,256}.png
fi
cp "$SCRIPT_DIR/icon.ico" "$STAGING/icon.ico"
echo "✓  icon.ico ready"

# ── 6. Build NSIS installer ───────────────────────────────────────────────────
echo ""
echo "🔨  Building NSIS installer..."

cd "$SCRIPT_DIR"
makensis installer.nsi
cd "$PROJECT_DIR"

INSTALLER="miniMerch-Studio-$VERSION-Setup.exe"
rm -rf "$STAGING"
echo "✓  Installer: $OUT_DIR/$INSTALLER"

# ── 7. Summary ────────────────────────────────────────────────────────────────
SIZE=$(du -sh "$OUT_DIR/$INSTALLER" | cut -f1)
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║               ✅ Build Complete!                          ║"
echo "╠═══════════════════════════════════════════════════════════╣"
printf "║  🪟 %-55s║\n" "$INSTALLER  ($SIZE)"
printf "║  📁 %-55s║\n" "release/"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  To install on Windows:                                   ║"
echo "║    1. Double-click the Setup.exe                          ║"
echo "║    2. SmartScreen → More info → Run anyway                ║"
echo "║    3. One-click install — no admin, no Node.js needed     ║"
echo "║    4. Desktop shortcut launches the Studio                ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
