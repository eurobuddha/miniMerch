#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# miniMerch Studio — Windows installer builder (runs on macOS)
# Prerequisites: brew install nsis
# Usage: npm run build:win
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="0.2.0"
BINARY_NAME="minimerch-studio.exe"
OUT_DIR="$PROJECT_DIR/release"

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║       miniMerch Studio — Windows build                   ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Check prerequisites ────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
    echo "❌  Node.js not found. Please install Node.js 18+ first."
    exit 1
fi

if ! command -v makensis &> /dev/null; then
    echo "❌  makensis not found."
    echo "    Install NSIS with: brew install nsis"
    echo "    Then re-run: npm run build:win"
    exit 1
fi

cd "$PROJECT_DIR"

# Install @yao-pkg/pkg if not present
if ! npx --no-install @yao-pkg/pkg --version &> /dev/null 2>&1; then
    echo "📦  Installing @yao-pkg/pkg..."
    npm install --save-dev @yao-pkg/pkg
fi

# ── 2. Clean previous release ────────────────────────────────────────────────
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
echo "✓  Output directory: $OUT_DIR"

# ── 3. Compile Windows .exe with pkg ──────────────────────────────────────────
echo ""
echo "🔨  Cross-compiling Windows binary (downloads Node win-x64 on first run)..."

cat > "$PROJECT_DIR/pkg.config.json" << 'PKGEOF'
{
  "pkg": {
    "scripts": ["src/**/*.js"],
    "assets": [
      "web/**/*",
      "template/**/*",
      "item.jpg",
      "ticket.jpg"
    ]
  }
}
PKGEOF

npx @yao-pkg/pkg src/studio.js \
    --config pkg.config.json \
    --targets node22-win-x64 \
    --output "$OUT_DIR/$BINARY_NAME" \
    --compress GZip

rm -f "$PROJECT_DIR/pkg.config.json"

echo "✓  Binary compiled: $OUT_DIR/$BINARY_NAME"

# ── 4. Embed icon + metadata into the .exe ────────────────────────────────────
echo ""
echo "🎨  Embedding icon and metadata into .exe..."

# Generate icon.ico if not already present or is stale
# Requires ImageMagick (brew install imagemagick) or uses existing file
if [ ! -f "$SCRIPT_DIR/icon.ico" ] || [ "$(xxd "$SCRIPT_DIR/icon.ico" | head -1 | grep -c 'MS Win')" = "0" ]; then
    if command -v magick &> /dev/null || command -v convert &> /dev/null; then
        echo "    Generating icon.ico..."
        for size in 16 32 48 64 128 256; do
            sips -z $size $size "$PROJECT_DIR/template/shop/icon.png" --out "/tmp/icon_${size}.png" 2>/dev/null
        done
        MAGICK_CMD="magick"
        command -v magick &> /dev/null || MAGICK_CMD="convert"
        $MAGICK_CMD /tmp/icon_16.png /tmp/icon_32.png /tmp/icon_48.png /tmp/icon_64.png /tmp/icon_128.png /tmp/icon_256.png "$SCRIPT_DIR/icon.ico" 2>/dev/null
        rm -f /tmp/icon_{16,32,48,64,128,256}.png
        echo "    ✓ icon.ico generated"
    else
        echo "    ⚠ ImageMagick not found — using existing icon.ico"
        echo "      Install with: brew install imagemagick"
    fi
fi

echo "✓  Executable ready"

# ── 5. Build NSIS installer ───────────────────────────────────────────────────
echo ""
echo "📦  Building Windows installer with NSIS..."

# NSIS needs to run from the build/ directory so relative paths work
cd "$SCRIPT_DIR"
makensis installer.nsi
cd "$PROJECT_DIR"

INSTALLER_NAME="miniMerch-Studio-$VERSION-Setup.exe"
echo "✓  Installer created: $OUT_DIR/$INSTALLER_NAME"

# Clean up loose binary (it's inside the installer now)
rm -f "$OUT_DIR/$BINARY_NAME"

# ── 6. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║               ✅ Build Complete!                          ║"
echo "╠═══════════════════════════════════════════════════════════╣"
printf "║  🪟 Installer: %-44s║\n" "$INSTALLER_NAME"
printf "║  📁 In:        %-44s║\n" "release/"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  To install on Windows:                                   ║"
echo "║    1. Copy installer to Windows machine                   ║"
echo "║    2. Double-click the .exe                               ║"
echo "║    3. SmartScreen: click 'More info' → 'Run anyway'       ║"
echo "║    4. One-click install, no admin needed                  ║"
echo "║    5. Use the desktop shortcut to launch                  ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
