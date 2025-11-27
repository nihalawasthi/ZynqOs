$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$APP_DIR = Join-Path $ROOT_DIR "apps\calculator-wasm"
$OUT_DIR = Join-Path $APP_DIR "pkg"

Write-Host "Building WASM modules..." -ForegroundColor Cyan
Write-Host ""

# Build wasm-bindgen calculator
Write-Host "1. Building wasm-bindgen calculator..." -ForegroundColor Yellow

if (-not (Get-Command wasm-pack -ErrorAction SilentlyContinue)) {
    Write-Host "wasm-pack not found. Please install with: cargo install wasm-pack" -ForegroundColor Red
    exit 1
}

Set-Location $APP_DIR
wasm-pack build --release --target web --out-dir pkg

if ($LASTEXITCODE -ne 0) {
    Write-Host "Calculator build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Calculator WASM build finished. Output in $OUT_DIR" -ForegroundColor Green
Set-Location $ROOT_DIR

Write-Host ""
Write-Host "2. Building WASI terminal..." -ForegroundColor Yellow

# Build WASI terminal
& "$ROOT_DIR\scripts\build-wasi.ps1" -Target "wasm32-wasip1"

if ($LASTEXITCODE -ne 0) {
    Write-Host "WASI terminal build failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✓ All WASM builds complete!" -ForegroundColor Green
