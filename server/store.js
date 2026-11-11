// Tiny file-backed store: metadata in data/db.json, one Yjs snapshot per world,
// uploaded assets under data/assets/<worldId>/. Swap for a real database when you outgrow it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const WORLD_DIR = path.join(DATA_DIR, 'worlds');
const ASSET_DIR = path.join(DATA_DIR, 'assets');
for (const d of [DATA_DIR, WORLD_DIR, ASSET_DIR]) fs.mkdirSync(d, { recursive: true });

let db = { users: {}, worlds: {}, secret: null };
if (fs.existsSync(DB_FILE)) db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 200);
}
export function flush() {
  clearTimeout(saveTimer);
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

export function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (!db.secret) {
    db.secret = crypto.randomBytes(32).toString('hex');
    flush();
  }
  return db.secret;
}

const ID_RE = /^[a-z0-9]{6,24}$/;
export const validId = (id) => typeof id === 'string' && ID_RE.test(id);
const newId = () => crypto.randomBytes(8).toString('hex').slice(0, 12);

// ---- users ----
export function upsertUser({ id, email, name, picture }) {
  db.users[id] = { ...(db.users[id] || {}), id, email, name, picture };
  save();
  return db.users[id];
}
export const getUser = (id) => db.users[id] || null;

// ---- worlds ----
export function createWorld(ownerId, title) {
  const id = newId();
  const now = Date.now();
  db.worlds[id] = { id, title: cleanTitle(title), ownerId, share: 'private', createdAt: now, updatedAt: now, visitors: {} };
  save();
  return db.worlds[id];
}
export const cleanTitle = (t) => String(t || '').trim().slice(0, 80) || 'Untitled world';
export const getWorld = (id) => (validId(id) && db.worlds[id]) || null;

/** 'edit' | 'view' | null */
export function accessFor(world, userId) {
  if (!world || !userId) return null;
  if (world.ownerId === userId) return 'edit';
  if (world.share === 'edit') return 'edit';
  if (world.share === 'view') return 'view';
  return null;
}

export function publicWorld(world, userId) {
  const owner = getUser(world.ownerId);
  return {
    id: world.id, title: world.title, share: world.share, updatedAt: world.updatedAt,
    owner: owner ? { name: owner.name, picture: owner.picture } : null,
    isOwner: world.ownerId === userId, access: accessFor(world, userId),
    hasThumb: fs.existsSync(thumbPath(world.id)),
  };
}

export function listWorlds(userId) {
  const mine = [], shared = [];
  for (const w of Object.values(db.worlds)) {
    if (w.ownerId === userId) mine.push(publicWorld(w, userId));
    else if (w.visitors?.[userId] && accessFor(w, userId)) shared.push(publicWorld(w, userId));
  }
  const byDate = (a, b) => b.updatedAt - a.updatedAt;
  return { mine: mine.sort(byDate), shared: shared.sort(byDate) };
}

export function updateWorld(id, patch) {
  const w = db.worlds[id];
  if (!w) return null;
  if (patch.title !== undefined) w.title = cleanTitle(patch.title);
  if (['private', 'view', 'edit'].includes(patch.share)) w.share = patch.share;
  w.updatedAt = Date.now();
  save();
  return w;
}
export function touchWorld(id) {
  if (db.worlds[id]) { db.worlds[id].updatedAt = Date.now(); save(); }
}
export function recordVisit(id, userId) {
  const w = db.worlds[id];
  if (w && w.ownerId !== userId) { (w.visitors ||= {})[userId] = Date.now(); save(); }
}
export function deleteWorld(id) {
  delete db.worlds[id];
  save();
  fs.rmSync(snapshotPath(id), { force: true });
  fs.rmSync(thumbPath(id), { force: true });
  fs.rmSync(assetDir(id), { recursive: true, force: true });
}

// ---- files ----
export const snapshotPath = (id) => path.join(WORLD_DIR, id + '.ybin');
export const thumbPath = (id) => path.join(WORLD_DIR, id + '.jpg');
export const assetDir = (id) => path.join(ASSET_DIR, id);

export function readSnapshot(id) {
  const p = snapshotPath(id);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
export function writeSnapshot(id, bytes) {
  const tmp = snapshotPath(id) + '.tmp';
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, snapshotPath(id));
}

export const ASSET_TYPES = {
  glb: 'model/gltf-binary', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
};
export function saveAsset(worldId, ext, buffer) {
  fs.mkdirSync(assetDir(worldId), { recursive: true });
  const file = `${newId()}.${ext}`;
  fs.writeFileSync(path.join(assetDir(worldId), file), buffer);
  return file;
}
export function assetPath(worldId, file) {
  if (!/^[a-z0-9]{6,24}\.[a-z0-9]{2,5}$/.test(file)) return null;
  const p = path.join(assetDir(worldId), file);
  return fs.existsSync(p) ? p : null;
}
export function copyWorldFiles(fromId, toId) {
  if (fs.existsSync(snapshotPath(fromId))) fs.copyFileSync(snapshotPath(fromId), snapshotPath(toId));
  if (fs.existsSync(thumbPath(fromId))) fs.copyFileSync(thumbPath(fromId), thumbPath(toId));
  if (fs.existsSync(assetDir(fromId))) fs.cpSync(assetDir(fromId), assetDir(toId), { recursive: true });
}
