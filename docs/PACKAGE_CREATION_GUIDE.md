# Package Creation Guide for ZynqOS

This guide explains how to create packages for ZynqOS that can be uploaded and run through the App Store or WASM Runner.

## Package Types

### 1. Simple WASM (.wasm)
Single WebAssembly binary with no external dependencies.

**Use case**: Pure computation, no DOM access needed.

**How to create**:
```bash
# From Rust
cargo build --target wasm32-unknown-unknown --release
# Output: target/wasm32-unknown-unknown/release/your_app.wasm

# From C/C++
emcc main.c -o output.wasm

# From AssemblyScript
asc assembly/index.ts --target release --outFile build/module.wasm
```

**Upload**: Just select the `.wasm` file in ZynqOS App Store.

---

### 2. WASI (.wasm)
WebAssembly with WASI (WebAssembly System Interface) for file I/O, environment variables, etc.

**Use case**: Command-line tools, utilities that need filesystem access.

**How to create**:
```bash
# From Rust
cargo build --target wasm32-wasi --release
# Output: target/wasm32-wasi/release/your_app.wasm

# From C/C++ with wasi-sdk
/path/to/wasi-sdk/bin/clang main.c -o output.wasm
```

**Upload**: Select the `.wasm` file. ZynqOS auto-detects WASI imports.

---

### 3. wasm-bindgen Package (.zip) ⭐ RECOMMENDED

WebAssembly compiled with Rust's wasm-bindgen for full JavaScript/DOM interop.

**Use case**: Interactive apps, games, UI components, calculator, etc.

#### Step-by-step Setup

**Prerequisites**:
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add wasm target
rustup target add wasm32-unknown-unknown

# Install wasm-pack
cargo install wasm-pack
```

**1. Create a new Rust project**:
```bash
cargo new --lib my-app
cd my-app
```

**2. Update `Cargo.toml`**:
```toml
[package]
name = "my-app"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"

# Optional: Add these for more features
# web-sys = { version = "0.3", features = ["Window", "Document", "Element"] }
# js-sys = "0.3"
```

**3. Write your code in `src/lib.rs`**:
```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

// For DOM manipulation
#[wasm_bindgen(start)]
pub fn main() {
    // Your initialization code
    web_sys::console::log_1(&"App loaded!".into());
}
```

**4. Build the package**:
```bash
wasm-pack build --target web
```

This creates a `pkg/` directory with:
- `my_app_bg.wasm` - The WebAssembly binary
- `my_app.js` - JavaScript glue code
- `my_app.d.ts` - TypeScript definitions
- `package.json` - NPM package metadata
- `README.md` - Auto-generated docs

**5. Create a ZIP file**:
```bash
# Windows PowerShell
Compress-Archive -Path pkg/* -DestinationPath my-app.zip

# Linux/Mac
cd pkg && zip -r ../my-app.zip *
```

**6. Upload to ZynqOS**:
- Open App Store → Upload tab
- Select `my-app.zip`
- Fill in metadata:
  - Name: "My App"
  - Description: "Does cool stuff"
  - Icon: "🚀"
- Click Upload

---

### 4. Complex Packages with Assets

For apps with images, fonts, stylesheets, multiple modules, etc.

**Example structure**:
```
my-game/
├── game_bg.wasm        # Main WASM binary
├── game.js             # Main JS glue
├── utils.js            # Additional modules
├── types.d.ts          # TypeScript definitions
├── sprites.png         # Image assets
├── font.woff2          # Font files
├── styles.css          # Stylesheets
└── data.json           # Config/data files
```

**Build steps**:

1. Build with wasm-pack:
```bash
wasm-pack build --target web
```

2. Add your assets to the `pkg/` directory:
```bash
cp assets/* pkg/
```

3. Create the ZIP:
```bash
cd pkg && zip -r ../my-game.zip *
```

**What ZynqOS does**:
- Extracts all files
- Categorizes them:
  - `.wasm` → Binary
  - `.js` → JS modules
  - `.d.ts`, `.ts` → TypeScript files
  - `.png`, `.jpg`, `.svg`, `.woff`, etc. → Assets (stored as base64)
  - Other text files → Assets (stored as text)
- Creates blob URLs for all files
- Patches imports/references automatically
- Executes the main module

---

## Real-World Examples

### Calculator (Simple)

**Source**: `apps/calculator-wasm/`

**Build**:
```bash
cd apps/calculator-wasm
wasm-pack build --target web
cd pkg && zip -r ../calculator.zip *
```

**ZIP contains**:
- `calculator_wasm_bg.wasm` (~20KB)
- `calculator_wasm.js` (~5KB)
- `calculator_wasm.d.ts` (~2KB)

**Upload**: calculator.zip → Works immediately!

---

### Terminal (WASI)

**Source**: `apps/terminal-wasi/`

**Build**:
```bash
cd apps/terminal-wasi
cargo build --target wasm32-wasi --release
cp target/wasm32-wasi/release/terminal-wasi.wasm terminal.wasm
```

**Upload**: terminal.wasm → Runs with WASI imports

---

### Game with Assets

```rust
// src/lib.rs
use wasm_bindgen::prelude::*;
use web_sys::{window, Document, HtmlImageElement};

#[wasm_bindgen(start)]
pub fn main() {
    let window = window().unwrap();
    let document = window.document().unwrap();
    
    // Load sprite (ZynqOS provides the blob URL automatically)
    let img = HtmlImageElement::new().unwrap();
    img.set_src("./sprites.png");
    
    let body = document.body().unwrap();
    body.append_child(&img).unwrap();
}
```

**Build and package**:
```bash
wasm-pack build --target web
cp assets/sprites.png pkg/
cd pkg && zip -r ../game.zip *
```

**Upload**: game.zip → Image loads automatically via blob URL!

---

## Advanced Topics

### Multiple JS Modules

If your package has multiple JS files:

```javascript
// pkg/main.js (imports from utils.js)
import { helper } from './utils.js';

export function init() {
  helper();
}
```

**ZynqOS automatically**:
- Creates blob URLs for all JS files
- Patches imports: `'./utils.js'` → `"blob:http://..."`
- Loads modules in correct order

---

### TypeScript Support

Include `.d.ts` files in your ZIP:

```typescript
// pkg/my_app.d.ts
export function add(a: number, b: number): number;
export function greet(name: string): string;
```

**Future features** (coming soon):
- Type checking before execution
- Auto-generated API docs from types
- IntelliSense in ZynqOS code editor

---

### Asset References

Assets are automatically available via their filename:

```javascript
// In your JS code
const img = new Image();
img.src = './sprite.png';  // ZynqOS provides blob URL

const font = new FontFace('MyFont', 'url(./font.woff2)');
document.fonts.add(font);
```

**Supported asset types**:
- Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.ico`
- Fonts: `.woff`, `.woff2`, `.ttf`, `.eot`
- Other: Stored as text or base64

---

## Validation & Errors

ZynqOS validates your package on upload:

### ✅ Valid Package
- Contains at least one `.wasm` file
- For wasm-bindgen: Contains at least one `.js` file
- WASM binary is valid (magic number check)
- All referenced files are included

### ❌ Common Errors

**"ZIP must contain a .wasm file"**
- Solution: Make sure your ZIP has the WASM binary

**"ZIP must contain at least one .js file"**
- Solution: For wasm-bindgen, include the generated JS glue code

**"Invalid WASM binary"**
- Solution: Check that the file is actually a WASM file (starts with `0x00 0x61 0x73 0x6D`)
- Re-build with correct target

**"Import #0 '...' module is not an object or function"**
- Solution: Package as a ZIP with the JS glue code (wasm-bindgen)
- Or use plain WASM/WASI without imports

---

## Testing Your Package

### Option 1: WASM Runner (Quick)
1. Open ZynqOS
2. Click Start Menu → WASM Runner
3. Select your `.zip` or `.wasm` file
4. Executes immediately (no persistence)

### Option 2: App Store (Persistent)
1. Open ZynqOS
2. Click Start Menu → App Store
3. Go to Upload tab
4. Select file and fill metadata
5. Upload → Appears in Start Menu
6. Run anytime from Start Menu

---

## Best Practices

### DO ✅
- Include all dependencies in the ZIP
- Use descriptive filenames
- Add TypeScript definitions for better DX
- Keep WASM binaries optimized (`--release`)
- Test locally before uploading
- Include a README in your ZIP

### DON'T ❌
- Mix different package types in one ZIP
- Include unnecessary files (node_modules, .git, etc.)
- Hardcode absolute URLs (use relative paths)
- Forget to test imports between modules
- Upload huge binaries (optimize with `wasm-opt`)

---

## Optimization Tips

### Reduce WASM Size

```bash
# Install wasm-opt
npm install -g wasm-opt

# Optimize WASM
wasm-opt -Oz -o optimized.wasm input.wasm

# Can reduce size by 50-70%!
```

### Strip Debug Info

```bash
# In Cargo.toml
[profile.release]
opt-level = "z"       # Optimize for size
lto = true            # Link-time optimization
codegen-units = 1     # Better optimization
strip = true          # Strip symbols
```

### Lazy Loading

```javascript
// Load heavy assets only when needed
async function loadSprite() {
  const img = new Image();
  img.src = './large-sprite.png';
  await img.decode();
  return img;
}
```

---

## Examples Repository

Check out example packages:

```bash
# Clone examples
git clone https://github.com/zynqos/wasm-examples
cd wasm-examples

# Build calculator
cd calculator
wasm-pack build --target web
cd pkg && zip -r ../calculator.zip *

# Build game
cd ../game
wasm-pack build --target web
cp assets/* pkg/
cd pkg && zip -r ../game.zip *
```

---

## Troubleshooting

### My package won't execute

1. Check browser console for errors
2. Verify ZIP structure: `unzip -l my-app.zip`
3. Make sure main JS file exists
4. Test WASM locally first:
   ```html
   <script type="module">
     import init from './pkg/my_app.js';
     await init();
   </script>
   ```

### Assets not loading

- Check filenames match (case-sensitive)
- Use relative paths: `./asset.png` not `/asset.png`
- Include assets in ZIP root or pkg/ directory

### Performance issues

- Optimize WASM with `wasm-opt`
- Use `--release` builds
- Lazy load heavy resources
- Consider code splitting for large apps

---

## Need Help?

- 📚 [wasm-bindgen Book](https://rustwasm.github.io/wasm-bindgen/)
- 🦀 [Rust and WebAssembly Book](https://rustwasm.github.io/book/)
- 💬 ZynqOS Discord: [discord.gg/zynqos](https://discord.gg/zynqos)
- 🐛 Report issues: [github.com/zynqos/issues](https://github.com/zynqos/issues)

---

## Quick Reference Card

| Package Type | File | Target | Build Command |
|--------------|------|--------|---------------|
| Simple WASM | `.wasm` | `wasm32-unknown-unknown` | `cargo build --release` |
| WASI | `.wasm` | `wasm32-wasi` | `cargo build --release` |
| wasm-bindgen | `.zip` | `wasm32-unknown-unknown` | `wasm-pack build --target web` |

**Upload Path**: Start Menu → App Store → Upload tab → Select file → Upload

**Quick Run**: Start Menu → WASM Runner → Select file → Auto-executes

---

Happy building! 🚀
