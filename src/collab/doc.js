// Client side of real-time collaboration: one shared Yjs document per world.
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Awareness } from 'y-protocols/awareness';
import { STATIC } from '../env.js';
import { localApi } from '../localStore.js';
import { OBJECT_DEFAULTS, writeObject, newId, seedWorld } from '../../shared/schema.js';

export const LOCAL = 'local'; // origin of this user's own edits (what undo/redo tracks)
const USER_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

function serverProvider(worldId, doc) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const provider = new WebsocketProvider(`${proto}://${location.host}/collab`, worldId, doc, { disableBc: true });
  const synced = new Promise((resolve, reject) => {
    if (provider.synced) return resolve();
    const timer = setTimeout(() => reject(new Error('Could not connect to the world. Check your connection and try again.')), 15000);
    provider.once('sync', () => { clearTimeout(timer); resolve(); });
  });
  return { provider, synced };
}

/** Static build: no server, the document is loaded from and saved to this browser. */
function localProvider(worldId, doc) {
  let timer = null, loaded = false;
  const save = () => { clearTimeout(timer); timer = null; return localApi.writeSnapshot(worldId, Y.encodeStateAsUpdate(doc)).catch(() => {}); };
  const synced = (async () => {
    const snap = await localApi.readSnapshot(worldId);
    if (snap) Y.applyUpdate(doc, snap, 'load'); else seedWorld(Y, doc);
    loaded = true;
    doc.on('update', () => { clearTimeout(timer); timer = setTimeout(save, 600); });
    if (!snap) await save();
  })();
  const onHide = () => { if (loaded && timer) save(); };
  addEventListener('pagehide', onHide);
  const provider = {
    awareness: new Awareness(doc),
    on() {}, once() {}, disconnect() {},
    destroy() { removeEventListener('pagehide', onHide); if (loaded) save(); },
  };
  return { provider, synced };
}

export function openWorld(worldId, user) {
  const doc = new Y.Doc();
  const { provider, synced } = STATIC ? localProvider(worldId, doc) : serverProvider(worldId, doc);
  const awareness = provider.awareness;
  let hash = 0;
  for (const ch of user.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const me = { id: user.id, name: user.name, picture: user.picture, color: USER_COLORS[hash % USER_COLORS.length] };
  awareness.setLocalStateField('user', me);

  const objects = doc.getMap('objects');
  const settings = doc.getMap('settings');
  const undo = new Y.UndoManager([objects, settings], { trackedOrigins: new Set([LOCAL]), captureTimeout: 500 });
  const world = {
    doc, provider, awareness, objects, settings, undo, synced, me,
    transact: (fn) => doc.transact(fn, LOCAL),
    /** Plain-data view of an object (without its code). */
    data(id) {
      const m = objects.get(id);
      if (!m) return null;
      const out = { ...OBJECT_DEFAULTS };
      for (const [k, v] of m.entries()) if (k !== 'js' && k !== 'py') out[k] = v;
      return out;
    },
    set(id, patch) {
      const m = objects.get(id);
      if (!m) return;
      world.transact(() => { for (const [k, v] of Object.entries(patch)) m.set(k, v); });
    },
    add(data) {
      const id = newId();
      world.transact(() => {
        const m = new Y.Map();
        objects.set(id, m);
        writeObject(Y, m, data);
      });
      return id;
    },
    remove(id) { world.transact(() => objects.delete(id)); },
    duplicate(id, patch = {}) {
      const src = objects.get(id);
      if (!src) return null;
      return world.add({ ...world.data(id), js: src.get('js')?.toString() || '', py: src.get('py')?.toString() || '', ...patch });
    },
    codeText(id, lang) {
      const m = objects.get(id);
      if (!m) return null;
      let t = m.get(lang);
      if (!t) world.transact(() => { t = new Y.Text(); m.set(lang, t); });
      return t;
    },
    /** People currently in this world (one entry per person, even with several tabs open). */
    people() {
      const seen = new Map();
      for (const [clientId, state] of awareness.getStates()) {
        if (state.user && !seen.has(state.user.id)) seen.set(state.user.id, { ...state.user, clientId, selected: state.selected, isMe: clientId === doc.clientID });
      }
      return [...seen.values()];
    },
    destroy() { undo.destroy(); provider.destroy(); doc.destroy(); },
  };
  return world;
}
