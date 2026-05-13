# ZynqOS — Browser Micro-Runtime

A browser-hosted "micro-OS" shell that runs two kinds of sandboxed WASM apps:

1. **wasm-bindgen modules** (UI-integrated apps like Calculator) - JS-callable WebAssembly
2. **WASI modules** (command-line programs) - Standalone binaries running under `@bjorn3/browser_wasi_shim`

## Features

- 🪟 **Window Manager** with draggable windows
- 📁 **File Browser** for VFS management (create, edit, delete files)
- 📝 **Zynqpad Text Editor** - Edit all text file types (HTML, CSS, JS, Python, etc.)
- 🔢 **Calculator** (WASM via wasm-bindgen)
- 💻 **WASI Terminal** with command history (↑/↓ arrows)
- 🐍 **Python Support** - Pyodide integration with REPL and package manager
- 🐚 **Kernel Shell** - Command-line shell as WASI binary
- 💾 **Virtual File System** (IndexedDB-based with WASI sync)
- 📦 **.mapp Package Importer** for bundled applications
- 🛠️ **WASI Utilities** (ls, cat, mkdir, rm, touch)
- ☁️ **Cloud Storage** - Google Drive & GitHub repo sync
- 🔄 **Peer-to-Peer Sync** - Data stored in user's own GitHub repo
- ⏱️ **Activity Tracking** - Daily active time tracking with auto-reset
- 🤖 **AI Assistant (Wednesday)** - AI chat with streaming responses

## Available Applications

### Desktop Apps

- **File Browser** - Browse and manage VFS files
- **Text Editor** - Edit text files with VFS persistence
- **Calculator** - Basic calculator with WASM compute
- **Terminal** - Run WASI binaries and utilities
- **Package Importer** - Import .mapp application bundles
- **Settings** - System configuration with sync controls

### WASI Binaries (Terminal)

- **shell.wasm** - ZynqOS kernel shell with built-in commands
- **ls.wasm** - List directory contents
- **cat.wasm** - Display file contents
- **mkdir.wasm** - Create directories
- **rm.wasm** - Remove files and directories
- **touch.wasm** - Create empty files
- **terminal-wasi.wasm** - Sample WASI program

## Sync System

ZynqOS implements a hybrid peer-to-peer sync architecture:

- **Minimal server storage**: Only user ID, active time, and preferences stored on server
- **P2P data storage**: Files, logs, and audit trails stored in user's own GitHub repo (`microos-data`)
- **Flexible sync**: Manual sync button + auto-sync with configurable intervals (5m - 3h)
- **Daily reset**: Active time automatically resets at midnight UTC

See [docs/SYNC_SYSTEM.md](docs/SYNC_SYSTEM.md) for details.

## Quick Start

Tested on a clean machine with Node.js 20 LTS and npm 10.

### Prerequisites

- Node.js 20 LTS
- npm 10+
- Git

### 1. Install Dependencies

```powershell
npm install
```

### 2. Run Development Server

```powershell
npm run dev
```

Open `http://localhost:5173`

### Verification Checklist

After setup, run the quality checks used in CI:

```powershell
npm run lint
npm run format:check
npm run test
npm run build
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for pull request requirements, commit message conventions, code style, and review expectations.

## Contact

- GitHub Issues: use the repository issue tracker for bugs and feature requests
- Discord: ZynqOS community server linked from the package creation guide

## Scripts

- `npm run dev` - Start Vite dev server
- `npm run build` - Build production bundle
- `npm run preview` - Preview production build
- `npm run build-wasm` - Build all WASM modules (calls `build-wasm.ps1`)
- `npm run lint` - Run ESLint
- `npm run format:check` - Verify formatting with Prettier
- `npm run test` - Run the unit test suite

## WASM Build Scripts

### Windows (PowerShell)

- `.\scripts\build-wasm.ps1` - Builds both calculator and WASI terminal
- `.\scripts\build-wasi.ps1` - Builds only WASI terminal (wasm32-wasip1)

### Linux/macOS (Bash)

- `./scripts/build-wasm.sh` - Build wasm-bindgen calculator

## Using the WASI Terminal

The terminal supports command history - use ↑/↓ arrow keys to navigate previous commands.

WASI binaries can be run in three ways:

1. **From URL/Path**: `run /apps/wasm/shell.wasm help`
2. **From VFS**: `run /vfs/path/to/app.wasm` (if stored in IndexedDB VFS)
3. **Upload**: Click "Upload" button or type `upload` command

### Quick Run Buttons

The terminal has quick-run buttons for common operations:

- **🐚 Shell** - Run kernel shell with help command
- **📁 ls /** - List root directory using shell
- **📄 cat** - Display /input.txt using shell
- **📍 pwd** - Print working directory
- **ℹ️ stat** - Show file information
- **⚡ version** - Show kernel version

### Kernel Shell Commands

When running `shell.wasm`, available commands:

- `help` - Show available commands
- `ls [path]` - List directory contents
- `cat <file>` - Display file contents
- `pwd` - Print working directory
- `echo <text>` - Echo text to stdout
- `stat <path>` - Show file information
- `version` - Show kernel version

Example usage:

```bash
run /apps/wasm/shell.wasm ls /
run /apps/wasm/shell.wasm cat /input.txt
run /apps/wasm/shell.wasm echo "Hello from WASI!"
run /apps/wasm/shell.wasm version
```

### WASI Utilities

Individual utility binaries are also available:

```bash
# List directories
run /apps/wasm/ls.wasm /
run /apps/wasm/ls.wasm /home

# Display files
run /apps/wasm/cat.wasm /input.txt
run /apps/wasm/cat.wasm /home/demo.txt

# Create directories
run /apps/wasm/mkdir.wasm /data
run /apps/wasm/mkdir.wasm /home/user

# Create files
run /apps/wasm/touch.wasm /test.txt

# Remove files/directories
run /apps/wasm/rm.wasm /test.txt
```

### VFS Integration

**All file changes made by WASI programs are automatically synced back to the IndexedDB VFS!**

This means you can:

1. Create files with `touch` or `mkdir`
2. Check them in the File Browser app
3. Edit them in Zynqpad (supports HTML, CSS, JS, Python, Markdown, and more!)
4. Read them with `cat` in future terminal sessions

Default mounted files:

- `/input.txt` - Sample text file
- `/home/demo.txt` - Demo file

### Python Support (Pyodide)

ZynqOS includes full Python support via Pyodide:

```bash
# Interactive Python REPL
python

# Run Python scripts from VFS
python /home/script.py

# Execute Python code directly
python -c "print('Hello from Python!')"

# Install Python packages
pip install numpy
pip install requests

# List installed packages
pip list
```

Python can access ZynqOS VFS files using the built-in `open_vfs()` function:

```python
# Read a file from VFS
content = open_vfs('/home/data.txt', 'r')

# Write to VFS
with open_vfs('/home/output.txt', 'w') as f:
    f.write('Hello from Python!')
```

### Terminal Commands

- `help` - Show available commands
- `python` / `python3` - Start Python REPL or run scripts
- `pip install <pkg>` - Install Python packages
- `pip list` - List installed Python packages
- `run <url|path> [args...]` - Run WASI binary
- `upload` - Upload and run local .wasm file
- `clear` - Clear terminal output

## Project Structure

```
apps/
  calculator-wasm/        # Rust WASM calculator (wasm-bindgen)
  kernel-shell/          # Kernel shell WASI binary
  terminal-wasi/         # Sample WASI program
  wasi-utils/           # WASI utility binaries
    ls/                 # Directory listing
    cat/                # File display
    mkdir/              # Create directories
    rm/                 # Remove files/dirs
    touch/              # Create files
  wasm/                 # Built WASM outputs (temp)
public/
  apps/wasm/            # Public WASM files served by Vite
scripts/
  build-wasm.ps1        # Windows: Build all WASM
  build-wasi.ps1        # Windows: Build WASI modules
  build-wasm.sh         # Linux/macOS: Build wasm-bindgen modules
src/
  apps/                 # Application UI components
    calculator/         # Calculator UI
    terminal/           # WASI terminal UI
    text-editor/        # Text editor UI
    file-browser/       # VFS file manager
    mapp-importer/      # Package importer
  components/           # Window manager, taskbar, launcher
  vfs/                 # Virtual file system (IndexedDB)
    fs.ts              # VFS API (readFile, writeFile, etc.)
    init.ts            # Auto-initialize sample files
  wasm/                # WASM loaders
```

## Windows Build Notes

On Windows with `x86_64-pc-windows-gnu` toolchain, use `wasm32-wasip1` target instead of `wasm32-wasi`:

```powershell
rustup target add wasm32-wasip1
cargo build --target wasm32-wasip1 --release
```

The scripts automatically handle this.

## Technology Stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS v4
- **VFS**: IndexedDB via `idb` library
- **WASM**:
  - wasm-bindgen for web-integrated modules
  - @wasmer/wasi + @wasmer/wasmfs for WASI runtime
- **Build**: Vite, wasm-pack, cargo

## Development

The window manager exposes a global function for opening windows:

```typescript
(window as any).ZynqOS_openWindow(title: string, content: ReactNode)
```

Apps are mounted via the Taskbar or Launcher components.

<!--
[
    "arch",
    "base32",
    "base64",
    "baseenc",
    "basename",
    "cat",
    "chcon",
    "chgrp",
    "chmod",
    "chown",
    "chroot",
    "cksum",
    "comm",
    "cp",
    "csplit",
    "cut",
    "date",
    "dd",
    "df",
    "dircolors",
    "dirname",
    "du",
    "echo",
    "env",
    "expand",
    "expr",
    "factor",
    "false",
    "fmt",
    "fold",
    "groups",
    "hashsum",
    "head",
    "hostid",
    "hostname",
    "id",
    "install",
    "join",
    "kill",
    "link",
    "ln",
    "logname",
    "ls",
    "mkdir",
    "mkfifo",
    "mknod",
    "mktemp",
    "more",
    "mv",
    "nice",
    "nl",
    "nohup",
    "nproc",
    "numfmt",
    "od",
    "paste",
    "pathchk",
    "pinky",
    "pr",
    "printenv",
    "printf",
    "ptx",
    "pwd",
    "readlink",
    "realpath",
    "relpath",
    "rm",
    "rmdir",
    "runcon",
    "seq",
    "sh",
    "shred",
    "shuf",
    "sleep",
    "sort",
    "split",
    "stat",
    "stdbuf",
    "sum",
    "sync",
    "tac",
    "tail",
    "tee",
    "test",
    "timeout",
    "touch",
    "tr",
    "true",
    "truncate",
    "tsort",
    "tty",
    "uname",
    "unexpand",
    "uniq",
    "unlink",
    "uptime",
    "users",
    "wc",
    "who",
    "whoami",
    "yes"
]
-->
