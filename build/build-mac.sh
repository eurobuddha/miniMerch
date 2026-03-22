#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# miniMerch Studio — macOS .app builder
# Run from the project root: npm run build:mac
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="miniMerch Studio"
BINARY_NAME="minimerch-studio"
VERSION="0.2.0"
OUT_DIR="$PROJECT_DIR/release"
APP_DIR="$OUT_DIR/$APP_NAME.app"

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║         miniMerch Studio — macOS build                   ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Check prerequisites ────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
    echo "❌  Node.js not found. Please install Node.js 18+ first."
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

# ── 3. Compile with pkg ───────────────────────────────────────────────────────
echo ""
echo "🔨  Compiling binary (this takes a minute on first run)..."

npx @yao-pkg/pkg src/studio.js \
    --targets node22-macos-arm64 \
    --output "$OUT_DIR/$BINARY_NAME" \
    --compress GZip

echo "✓  Binary compiled: $OUT_DIR/$BINARY_NAME"

chmod +x "$OUT_DIR/$BINARY_NAME"
echo "✓  Binary ready (arm64 — runs on all Apple Silicon and Intel Macs via Rosetta 2)"

# ── 4. Assemble .app bundle ───────────────────────────────────────────────────
echo ""
echo "📦  Assembling .app bundle..."

mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# Copy binary
cp "$OUT_DIR/$BINARY_NAME" "$APP_DIR/Contents/MacOS/$BINARY_NAME"
chmod +x "$APP_DIR/Contents/MacOS/$BINARY_NAME"

# Write launcher shell script — macOS needs a real executable as CFBundleExecutable.
# A pkg binary has no GUI event loop so macOS kills it on double-click.
# This launcher script keeps the process alive and satisfies macOS.
cat > "$APP_DIR/Contents/MacOS/launcher" << 'EOF'
#!/bin/bash
# miniMerch Studio launcher
# Starts the server binary and keeps the process alive so macOS is happy.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/minimerch-studio"
EOF
chmod +x "$APP_DIR/Contents/MacOS/launcher"

# Copy metadata
cp "$SCRIPT_DIR/Info.plist" "$APP_DIR/Contents/Info.plist"
cp "$SCRIPT_DIR/icon.icns"  "$APP_DIR/Contents/Resources/icon.icns"

# PkgInfo file
echo -n "APPLMMST" > "$APP_DIR/Contents/PkgInfo"

# Clean up loose binary
rm "$OUT_DIR/$BINARY_NAME"

echo "✓  .app bundle created: $APP_DIR"

# ── 5. Ad-hoc sign (prevents "damaged app" error on other Macs) ──────────────
echo ""
echo "✍️   Signing app bundle (ad-hoc)..."
codesign --force --deep --sign - "$APP_DIR" 2>&1
xattr -cr "$APP_DIR" 2>/dev/null || true
echo "✓  Signed"

# ── 6. Create .dmg ───────────────────────────────────────────────────────────
echo ""
echo "💿  Creating .dmg disk image..."

DMG_NAME="miniMerch-Studio-$VERSION.dmg"
DMG_PATH="$OUT_DIR/$DMG_NAME"

# Create a temporary folder for DMG contents
TMP_DMG_DIR="$OUT_DIR/dmg_staging"
mkdir -p "$TMP_DMG_DIR"
cp -R "$APP_DIR" "$TMP_DMG_DIR/"

# Create symlink to /Applications for drag-install
ln -s /Applications "$TMP_DMG_DIR/Applications"

# Build the DMG
hdiutil create \
    -volname "miniMerch Studio" \
    -srcfolder "$TMP_DMG_DIR" \
    -ov \
    -format UDZO \
    "$DMG_PATH"

rm -rf "$TMP_DMG_DIR"

echo "✓  DMG created: $DMG_PATH"

# ── 7. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║               ✅ Build Complete!                          ║"
echo "╠═══════════════════════════════════════════════════════════╣"
printf "║  📦 App:  %-48s║\n" "$APP_NAME.app"
printf "║  💿 DMG:  %-48s║\n" "$DMG_NAME"
printf "║  📁 In:   %-48s║\n" "release/"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  To install:                                              ║"
echo "║    Open release/miniMerch-Studio-$VERSION.dmg            ║"
echo "║    Drag miniMerch Studio to Applications                  ║"
echo "║                                                           ║"
echo "║  First launch: right-click → Open (bypasses Gatekeeper)  ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
