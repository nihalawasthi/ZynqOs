# MicroOS — MVP Starter

Browser-based micro runtime / micro-OS prototype using React + WASM.

## Quick start

1. `npm install`
2. (Optional) `npm run build-wasm` (requires `wasm-pack` and Rust toolchain)
3. `npm run dev`
4. Open `http://localhost:5173`

## Scripts

- `npm run dev` - run Vite dev server
- `npm run build` - build frontend
- `npm run preview` - preview production build locally
- `npm run build-wasm` - wrapper that calls `scripts/build-wasm.sh` (build Rust WASM via wasm-pack)

## Development notes

- Frontend: Vite + React + TypeScript + Tailwind.
- VFS: IndexedDB using `idb`.
- WASM: example calculator built in `apps/calculator-wasm`. For more advanced WASI support see the `wasm-shell` instructions.
