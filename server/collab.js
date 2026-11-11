// Real-time collaboration: a small Yjs sync server (y-websocket wire protocol).
// One in-memory Y.Doc per open world, persisted to disk; viewers get a read-only connection.
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { userFromRequest } from './auth.js';
import { getWorld, accessFor, readSnapshot, writeSnapshot, touchWorld, recordVisit } from './store.js';
import { seedWorld } from '../shared/schema.js';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const rooms = new Map(); // worldId -> Room

class Room {
  constructor(id) {
    this.id = id;
    this.doc = new Y.Doc();
    this.conns = new Map(); // ws -> Set<awareness clientId>
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    this.saveTimer = null;
    const snap = readSnapshot(id);
    if (snap) Y.applyUpdate(this.doc, snap);
    else { seedWorld(Y, this.doc); this.save(); }

    this.doc.on('update', (update, origin) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.broadcast(encoding.toUint8Array(enc), origin);
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.save(), 1500);
    });
    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      const ids = this.conns.get(origin);
      if (ids) { added.forEach((c) => ids.add(c)); removed.forEach((c) => ids.delete(c)); }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      this.broadcast(encoding.toUint8Array(enc), null);
    });
  }
  save() {
    clearTimeout(this.saveTimer);
    writeSnapshot(this.id, Y.encodeStateAsUpdate(this.doc));
    touchWorld(this.id);
  }
  broadcast(msg, except) {
    for (const ws of this.conns.keys()) if (ws !== except && ws.readyState === 1) ws.send(msg);
  }
  close(ws) {
    const ids = this.conns.get(ws);
    if (!ids) return;
    this.conns.delete(ws);
    awarenessProtocol.removeAwarenessStates(this.awareness, [...ids], null);
    if (this.conns.size === 0) {
      this.save();
      this.doc.destroy();
      rooms.delete(this.id);
    }
  }
}

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, new Room(id));
  return rooms.get(id);
}

/** Make sure a world has a snapshot on disk (used by "make a copy" for worlds that are open). */
export function flushRoom(id) {
  rooms.get(id)?.save();
}
export function closeRoom(id) {
  const room = rooms.get(id);
  if (!room) return;
  for (const ws of [...room.conns.keys()]) ws.close(4001, 'World deleted');
}
/** Kick collaborators whose access was revoked or downgraded. */
export function recheckRoom(id) {
  const room = rooms.get(id);
  const world = getWorld(id);
  if (!room) return;
  for (const ws of [...room.conns.keys()]) {
    if (accessFor(world, ws.userId) !== ws.access) ws.close(4003, 'Access changed');
  }
}

function onConnection(ws, room, canEdit) {
  ws.binaryType = 'arraybuffer';
  room.conns.set(ws, new Set());

  ws.on('message', (data) => {
    try {
      const dec = decoding.createDecoder(new Uint8Array(data));
      const enc = encoding.createEncoder();
      const type = decoding.readVarUint(dec);
      if (type === MSG_SYNC) {
        encoding.writeVarUint(enc, MSG_SYNC);
        const sub = decoding.readVarUint(dec);
        if (sub === syncProtocol.messageYjsSyncStep1) syncProtocol.readSyncStep1(dec, enc, room.doc);
        else if (!canEdit) return; // read-only: ignore incoming document changes
        else if (sub === syncProtocol.messageYjsSyncStep2) syncProtocol.readSyncStep2(dec, room.doc, ws);
        else if (sub === syncProtocol.messageYjsUpdate) syncProtocol.readUpdate(dec, room.doc, ws);
        if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), ws);
      }
    } catch (e) {
      console.error('collab message error', e.message);
    }
  });
  ws.on('close', () => room.close(ws));
  ws.on('error', () => room.close(ws));

  // Kick off sync: send our state vector, then everyone's presence.
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  syncProtocol.writeSyncStep1(enc, room.doc);
  ws.send(encoding.toUint8Array(enc));
  const states = room.awareness.getStates();
  if (states.size > 0) {
    const e2 = encoding.createEncoder();
    encoding.writeVarUint(e2, MSG_AWARENESS);
    encoding.writeVarUint8Array(e2, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]));
    ws.send(encoding.toUint8Array(e2));
  }
}

export function attachCollab(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/collab\/([a-z0-9]+)$/);
    if (!m) return; // not ours (e.g. Vite HMR)
    const deny = (code, text) => { socket.write(`HTTP/1.1 ${code} ${text}\r\n\r\n`); socket.destroy(); };
    // Browsers always send Origin on WebSocket handshakes; refuse other sites riding on the cookie.
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) return deny(403, 'Forbidden'); } catch { return deny(403, 'Forbidden'); }
    }
    const user = userFromRequest(req);
    const world = getWorld(m[1]);
    const access = accessFor(world, user?.id);
    if (!user) return deny(401, 'Unauthorized');
    if (!access) return deny(403, 'Forbidden');
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = user.id;
      ws.access = access;
      recordVisit(world.id, user.id);
      onConnection(ws, getRoom(world.id), access === 'edit');
    });
  });
  const shutdown = () => { for (const r of rooms.values()) r.save(); };
  process.on('SIGINT', () => { shutdown(); process.exit(0); });
  process.on('SIGTERM', () => { shutdown(); process.exit(0); });
}
