#!/bin/bash
# Lepus local build setup for Windows
# Run this from the MozillaBuild shell (C:\mozilla-build\start-shell.bat)
#
# Prerequisites:
#   1. Install MozillaBuild: winget install Mozilla.MozillaBuild
#   2. Open C:\mozilla-build\start-shell.bat
#   3. cd /d/repos/lepus
#   4. bash scripts/setup-local-build.sh

set -e

echo "=== Lepus Local Build Setup ==="

# Point all Mozilla tooling to D: drive
export MOZBUILD_STATE_PATH="D:/mozbuild"
mkdir -p "$MOZBUILD_STATE_PATH"

echo ""
echo "MOZBUILD_STATE_PATH = $MOZBUILD_STATE_PATH"
echo ""

# Write to shell profile so it persists
PROFILE="$HOME/.profile"
if ! grep -q "MOZBUILD_STATE_PATH" "$PROFILE" 2>/dev/null; then
    echo '' >> "$PROFILE"
    echo '# LEPUS: Keep Mozilla build tooling on D: drive' >> "$PROFILE"
    echo 'export MOZBUILD_STATE_PATH="D:/mozbuild"' >> "$PROFILE"
    echo "Added MOZBUILD_STATE_PATH to $PROFILE"
else
    echo "MOZBUILD_STATE_PATH already in $PROFILE"
fi

# Set mozconfig
export MOZCONFIG="$PWD/mozconfig.lepus"
if ! grep -q "MOZCONFIG" "$PROFILE" 2>/dev/null; then
    echo 'export MOZCONFIG="D:/repos/lepus/mozconfig.lepus"' >> "$PROFILE"
    echo "Added MOZCONFIG to $PROFILE"
fi

echo ""
echo "=== Step 1: Bootstrap ==="
echo "This downloads Clang, node, Rust toolchain, etc. to D:/mozbuild/"
echo "Takes ~10-20 minutes on first run."
echo ""

# Bootstrap — select "browser" (option 1)
echo 1 | ./mach bootstrap --application-choice=browser

echo ""
echo "=== Step 2: Update Cargo.lock ==="
cargo generate-lockfile 2>/dev/null || cargo update -p gkrust-shared 2>/dev/null || true

echo ""
echo "=== Step 3: Build ==="
echo "Starting build with 4 parallel jobs (safe for 16GB RAM)."
echo "Full build takes 2-3 hours. Incremental rebuilds ~30 min."
echo ""

./mach build -j4

echo ""
echo "=== Build Complete ==="
echo "Run with: ./mach run"
