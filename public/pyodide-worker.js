/* Pyodide Web Worker - runs Python off the main thread */
/* global loadPyodide */

let pyodide = null;
let initialized = false;

async function ensurePyodide() {
  if (initialized && pyodide) return pyodide;
  self.importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');
  pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/' });
  initialized = true;
  return pyodide;
}

async function runCode(code, reqId) {
  const p = await ensurePyodide();
  try {
  await p.runPythonAsync(`
import sys, traceback, js, builtins
from io import StringIO

_orig_stdout = sys.stdout
_orig_stderr = sys.stderr
_buf_out = StringIO()
_buf_err = StringIO()
sys.stdout = _buf_out
sys.stderr = _buf_err

_orig_print = builtins.print
def print(*args, **kwargs):
  _orig_print(*args, **kwargs)
  # Emit streamed chunk (line + separator newline signal)
  try:
    text = ' '.join(str(a) for a in args)
    js.globalThis.postMessage({ 'id': ${reqId}, 'type': 'stream', 'stream': 'stdout', 'data': text })
    js.globalThis.postMessage({ 'id': ${reqId}, 'type': 'stream', 'stream': 'stdout', 'data': '' })
  except Exception:
    pass
  # Cooperative cancel check via attribute access (more reliable than getattr)
  try:
    if js.globalThis.workerCancelFlag:
      raise SystemExit('Stopped')
  except AttributeError:
    pass
builtins.print = print

code_to_run = ${JSON.stringify(code)}
try:
  exec(code_to_run, globals(), globals())
except SystemExit:
  # User requested stop; suppress traceback
  pass
except Exception:
  traceback.print_exc()
finally:
  builtins.print = _orig_print
  sys.stdout = _orig_stdout
  sys.stderr = _orig_stderr
`);
  const stdout = await p.runPythonAsync('_buf_out.getvalue()')
  const stderr = await p.runPythonAsync('_buf_err.getvalue()')
  // Signal end of streaming explicitly
  try { self.postMessage({ id: reqId, type: 'stream-end' }) } catch {}
  return { ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') };
  } catch (e) {
  return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

async function installPackage(name) {
  const p = await ensurePyodide();
  try {
    await p.loadPackage('micropip');
    await p.runPythonAsync(`import micropip; await micropip.install(${JSON.stringify(name)})`);
    return { ok: true, message: `Successfully installed ${name}` };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

async function listPackages() {
  const p = await ensurePyodide();
  try {
    const r = await p.runPythonAsync('import micropip; list(micropip.list().keys())');
    const arr = r && r.toJs ? r.toJs() : [];
    return { ok: true, packages: Array.from(arr || []) };
  } catch (e) {
    return { ok: false, packages: [] };
  }
}

self.onmessage = async (evt) => {
  const msg = evt.data || {};
  const id = msg.id;
  const type = msg.type;
  try {
    if (type === 'cancel') {
      // Set global flag that Python print hook will observe
      globalThis.workerCancelFlag = true;
      // Acknowledge immediately (output will finalize on next print)
      self.postMessage({ id, type: 'cancelled', ok: true });
      return;
    }
    if (type === 'init') {
      await ensurePyodide();
      self.postMessage({ id, type: 'inited', ok: true });
      return;
    }
    if (type === 'run') {
      const { code } = msg;
      const r = await runCode(code, id);
      self.postMessage({ id, type: 'result', ...r });
      return;
    }
    if (type === 'install') {
      const { name } = msg;
      const r = await installPackage(name);
      self.postMessage({ id, type: 'installed', ...r });
      return;
    }
    if (type === 'list') {
      const r = await listPackages();
      self.postMessage({ id, type: 'packages', ...r });
      return;
    }
    if (type === 'ping') {
      self.postMessage({ id, type: 'pong' });
      return;
    }
  } catch (e) {
    self.postMessage({ id, type: 'error', ok: false, error: String(e && e.message ? e.message : e) });
  }
};
