/* Pyodide Web Worker - runs Python off the main thread */
/* global loadPyodide */

let pyodide = null;
let initialized = false;
let initPromise = null;

// Start loading Pyodide immediately when worker is created
async function ensurePyodide() {
  if (initialized && pyodide) return pyodide;
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    self.importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');
    pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/' });
    initialized = true;
    return pyodide;
  })();
  
  return initPromise;
}

// Start preloading immediately when worker starts
ensurePyodide().catch(err => {
  console.error('[Pyodide Worker] Failed to preload:', err);
});

async function runCode(code, reqId) {
  const p = await ensurePyodide();
  try {
  await p.runPythonAsync(`
import sys, traceback, js
from io import StringIO

_orig_stdout = sys.stdout
_orig_stderr = sys.stderr
_buf_out = StringIO()
_buf_err = StringIO()

class _StreamingWriter:
  def __init__(self, buf, stream_name):
    self._buf = buf
    self._stream = stream_name
  def write(self, s):
    try:
      self._buf.write(s)
      # emit as-is (may be partial line)
      try:
        js.globalThis.postMessage({ 'id': ${reqId}, 'type': 'stream', 'stream': self._stream, 'data': str(s) })
      except Exception:
        pass
      try:
        if js.globalThis.workerCancelFlag:
          raise SystemExit('Stopped')
      except AttributeError:
        pass
      return len(s)
    except SystemExit:
      raise
    except Exception:
      return 0
  def flush(self):
    try:
      self._buf.flush()
    except Exception:
      pass

sys.stdout = _StreamingWriter(_buf_out, 'stdout')
sys.stderr = _StreamingWriter(_buf_err, 'stderr')

code_to_run = ${JSON.stringify(code)}
try:
  exec(code_to_run, globals(), globals())
except SystemExit:
  # User requested stop; suppress traceback
  pass
except Exception:
  traceback.print_exc()
finally:
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

function formatInstallError(name, err) {
  const message = String(err && err.message ? err.message : err);
  if (message.includes("Can't find a pure Python 3 wheel")) {
    return (
      `Cannot install ${name} in Pyodide. ` +
      `This environment only supports pure-Python wheels or Pyodide-built packages, ` +
      `and ${name} requires native binaries. ` +
      `See https://pyodide.org/en/stable/usage/faq.html#why-can-t-micropip-find-a-pure-python-wheel-for-a-package`
    );
  }
  return message;
}

async function installPackage(name) {
  const p = await ensurePyodide();
  try {
    await p.loadPackage('micropip');
    await p.runPythonAsync(`import micropip; await micropip.install(${JSON.stringify(name)})`);
    return { ok: true, message: `Successfully installed ${name}` };
  } catch (e) {
    return { ok: false, error: formatInstallError(name, e) };
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
      // Clear any previous cancel flag before new execution
      globalThis.workerCancelFlag = false;
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
