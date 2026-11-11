// Python scripting via Pyodide (CPython compiled to WebAssembly), loaded only when a world uses it.
import { BASE } from '../env.js';

let pyodidePromise = null;
let sink = null; // where print() output goes for the current world

export function loadPython() {
  pyodidePromise ||= (async () => {
    const { loadPyodide } = await import(/* @vite-ignore */ `${location.origin}${BASE}pyodide/pyodide.mjs`);
    return loadPyodide({
      indexURL: `${BASE}pyodide/`,
      stdout: (s) => sink?.('print', s),
      stderr: (s) => sink?.('error', s),
    });
  })();
  pyodidePromise.catch(() => { pyodidePromise = null; });
  return pyodidePromise;
}

// Runs once per script, in that script's own namespace. Gives Python the same API as JavaScript,
// with decorators for events:   @when_clicked   /   @when_key("space")   /   @every(2)
const PRELUDE = `
import asyncio as _asyncio, inspect as _inspect, math, random
from pyodide.ffi import create_proxy as _proxy

def _wrap(fn):
    try:
        _n = len([p for p in _inspect.signature(fn).parameters.values() if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)])
        _var = any(p.kind == p.VAR_POSITIONAL for p in _inspect.signature(fn).parameters.values())
    except (TypeError, ValueError):
        _n, _var = 0, True
    async def _guarded(coro):
        try:
            await coro
        except Exception as e:
            _report(f"{type(e).__name__}: {e}")
    def call(*args):
        r = fn(*args) if _var else fn(*args[:_n])
        if _inspect.iscoroutine(r):
            _asyncio.ensure_future(_guarded(r))
    return _proxy(call)

def _event(register):
    def outer(*args):
        if len(args) == 1 and callable(args[0]) and not hasattr(args[0], 'js_id'):
            register(_wrap(args[0])); return args[0]
        if args and callable(args[-1]) and not hasattr(args[-1], 'js_id'):
            register(*args[:-1], _wrap(args[-1])); return args[-1]
        def deco(fn):
            register(*args, _wrap(fn)); return fn
        return deco
    return outer

when_start = _event(_when.start)
when_update = _event(_when.update)
when_clicked = _event(_when.clicked)
when_collides = _event(_when.collides)
when_collision_ends = _event(_when.collisionEnds)
when_key = _event(_when.key)
when_key_released = _event(_when.keyReleased)
when_message = _event(_when.message)
every = _event(_when.every)

async def wait(seconds=0):
    await _wait(seconds)
async def next_frame():
    await _wait(0)
`;

export async function runPython(code, api, rt) {
  rt.log_('info', 'Starting Python…');
  const py = await loadPython();
  sink = (kind, text) => rt.log_(kind, text);
  const ns = py.globals.get('dict')();
  const set = (k, v) => ns.set(k, v);
  set('me', api.me); set('world', api.world); set('player', api.player); set('input', api.input);
  set('_when', api.when); set('_wait', api.wait); set('_guard', rt.loopGuard());
  set('_report', (msg) => rt.report(new Error(String(msg)), api.me));
  try {
    py.runPython(PRELUDE, { globals: ns });
    await py.runPythonAsync(code, { globals: ns });
  } finally {
    rt.pyNamespaces ||= [];
    rt.pyNamespaces.push(ns);
  }
}
