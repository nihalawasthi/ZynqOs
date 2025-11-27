#!/usr/bin/env bash
set -u

TARGET=${1:-wasm32-wasip1}

echo "Building WASI modules..."
echo "Target: ${TARGET}"

# Ensure target is installed (don't fail if already present)
rustup target add "${TARGET}" || true

OUTDIR="apps/wasm"
mkdir -p "${OUTDIR}"

build_project() {
  local project_dir=$1
  local artifact_name=$2
  local dest_name=$3

  echo "\nBuilding ${project_dir}..."
  if [ ! -d "${project_dir}" ]; then
    echo "Directory ${project_dir} not found, skipping"
    return 1
  fi

  pushd "${project_dir}" >/dev/null || return 1
  cargo build --target "${TARGET}" --release
  rc=$?
  popd >/dev/null

  if [ ${rc} -eq 0 ]; then
    src="${project_dir}/target/${TARGET}/release/${artifact_name}"
    if [ -f "${src}" ]; then
      cp "${src}" "${OUTDIR}/${dest_name}"
      echo "✓ ${dest_name}"
    else
      echo "✗ build succeeded but artifact ${src} not found"
    fi
  else
    echo "✗ build failed for ${project_dir}"
  fi
}

# Build terminal-wasi
build_project "apps/terminal-wasi" "terminal-wasi.wasm" "terminal-wasi.wasm"

# Build kernel shell (microos-shell -> shell.wasm)
build_project "apps/kernel-shell" "microos-shell.wasm" "shell.wasm"

# Build utils
utils=(ls cat mkdir rm touch)
for u in "${utils[@]}"; do
  build_project "apps/wasi-utils/${u}" "wasi-${u}.wasm" "${u}.wasm"
done

# Build calculator-wasm (wasm-bindgen / pkg) if present
if [ -d "apps/calculator-wasm" ]; then
  echo "\nBuilding calculator-wasm (wasm-bindgen pkg)..."
  if command -v wasm-pack >/dev/null 2>&1; then
    pushd apps/calculator-wasm >/dev/null || true
    wasm-pack build --release --target web || echo "wasm-pack build failed for calculator-wasm"
    popd >/dev/null || true
    # copy pkg into public area so frontend build can import it
    mkdir -p public/apps/wasm/calculator-wasm
    cp -r apps/calculator-wasm/pkg/* public/apps/wasm/calculator-wasm/ 2>/dev/null || true
    echo "✓ calculator-wasm pkg copied to public/apps/wasm/calculator-wasm/"
  else
    echo "wasm-pack not found; skipping calculator-wasm pkg build"
  fi
fi

# Copy to public directory
echo "\nCopying WASM files to public directory..."
mkdir -p public/apps/wasm
cp -f apps/wasm/* public/apps/wasm/ 2>/dev/null || true
echo "✓ Files copied to public/apps/wasm/"

echo "\n✓ All WASI builds complete!"
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
