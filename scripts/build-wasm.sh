#!/usr/bin/env bash
set -e
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/calculator-wasm"
OUT_DIR="$ROOT_DIR/apps/calculator-wasm/pkg"

echo "Building WASM for calculator..."
if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack not found. Please install with: cargo install wasm-pack"
  exit 1
fi

cd "$APP_DIR"
# Build target web (wasm-bindgen for web)
wasm-pack build --release --target web --out-dir pkg
echo "WASM build finished. Output in $OUT_DIR"
