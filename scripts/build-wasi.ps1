# Build WASI target for Windows
param(
    [string]$Target = "wasm32-wasip1"
)

Write-Host "Building WASI modules..." -ForegroundColor Cyan
Write-Host "Target: $Target" -ForegroundColor Yellow
Write-Host ""

# Ensure target is installed
Write-Host "Ensuring Rust target $Target is available..." -ForegroundColor Yellow
rustup target add $Target

# Create output directory
$OutDir = "apps/wasm"
if (!(Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}

# Build terminal-wasi
Write-Host "`nBuilding terminal-wasi..." -ForegroundColor Yellow
Set-Location apps/terminal-wasi
cargo build --target $Target --release
if ($LASTEXITCODE -eq 0) {
    Copy-Item "target/$Target/release/terminal-wasi.wasm" "../wasm/terminal-wasi.wasm" -Force
    Write-Host "✓ terminal-wasi.wasm" -ForegroundColor Green
} else {
    Write-Host "✗ terminal-wasi build failed" -ForegroundColor Red
}
Set-Location ../..

# Build kernel shell
Write-Host "`nBuilding kernel-shell..." -ForegroundColor Yellow
Set-Location apps/kernel-shell
cargo build --target $Target --release
if ($LASTEXITCODE -eq 0) {
    Copy-Item "target/$Target/release/microos-shell.wasm" "../wasm/shell.wasm" -Force
    Write-Host "✓ shell.wasm" -ForegroundColor Green
} else {
    Write-Host "✗ kernel-shell build failed" -ForegroundColor Red
}
Set-Location ../..

# Build WASI utilities
$utils = @("ls", "cat", "mkdir", "rm", "touch")
foreach ($util in $utils) {
    Write-Host "`nBuilding wasi-$util..." -ForegroundColor Yellow
    Set-Location "apps/wasi-utils/$util"
    cargo build --target $Target --release
    if ($LASTEXITCODE -eq 0) {
        Copy-Item "target/$Target/release/wasi-$util.wasm" "../../../apps/wasm/$util.wasm" -Force
        Write-Host "✓ $util.wasm" -ForegroundColor Green
    } else {
        Write-Host "✗ wasi-$util build failed" -ForegroundColor Red
    }
    Set-Location ../../..
}

# Copy to public directory
Write-Host "`nCopying WASM files to public directory..." -ForegroundColor Yellow
if (!(Test-Path "public/apps/wasm")) {
    New-Item -ItemType Directory -Path "public/apps/wasm" -Force | Out-Null
}
Copy-Item "apps/wasm/*" "public/apps/wasm/" -Force
Write-Host "✓ Files copied to public/apps/wasm/" -ForegroundColor Green

# Build calculator-wasm pkg if wasm-pack is available
if (Test-Path "apps/calculator-wasm") {
    Write-Host "\nBuilding calculator-wasm (wasm-pack pkg) ..." -ForegroundColor Yellow
    $wp = Get-Command wasm-pack -ErrorAction SilentlyContinue
    if ($wp) {
        Set-Location apps/calculator-wasm
        wasm-pack build --release --target web
        Set-Location ../..
        if (!(Test-Path "public/apps/wasm/calculator-wasm")) {
            New-Item -ItemType Directory -Path "public/apps/wasm/calculator-wasm" -Force | Out-Null
        }
        Copy-Item "apps/calculator-wasm/pkg/*" "public/apps/wasm/calculator-wasm/" -Force
        Write-Host "✓ calculator-wasm pkg copied to public/apps/wasm/calculator-wasm/" -ForegroundColor Green
    } else {
        Write-Host "wasm-pack not found; skipping calculator-wasm pkg build" -ForegroundColor Yellow
    }
}

Write-Host "`n✓ All WASI builds complete!" -ForegroundColor Green
