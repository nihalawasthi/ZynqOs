$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$APP_DIR = Join-Path $ROOT_DIR "apps\calculator-wasm"
$OUT_DIR = Join-Path $APP_DIR "pkg"

Write-Host "Building WASM for calculator..."

if (-not (Get-Command wasm-pack -ErrorAction SilentlyContinue)) {
    Write-Host "wasm-pack not found. Please install with: cargo install wasm-pack"
    exit 1
}

Set-Location $APP_DIR
# Build target web (wasm-bindgen for web)
wasm-pack build --release --target web --out-dir pkg

Write-Host "WASM build finished. Output in $OUT_DIR"
