// minimal helper to load raw WebAssembly modules (not WASI).
export async function loadWasm(url: string, importObject: any = {}) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch wasm: ${res.statusText}`)
  const bytes = await res.arrayBuffer()
  const mod = await WebAssembly.instantiate(bytes, importObject)
  return mod.instance.exports
}
