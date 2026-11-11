// Storage for the static (no-server) build: everything is kept in this browser's IndexedDB.
// It mirrors the server API in src/api.js so the rest of the app does not care which one it uses.
const LOCAL_USER = { id: 'local', name: 'You', email: '', picture: '' };
const STORES = ['worlds', 'snapshots', 'assets', 'thumbs'];
const TYPES = { glb: 'model/gltf-binary', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' };

let dbPromise = null;
function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('smartspace', 1);
    req.onupgradeneeded = () => { for (const s of STORES) req.result.createObjectStore(s); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('This browser is blocking local storage, so worlds cannot be saved here.'));
  });
  return dbPromise;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = t.onabort = () => reject(t.error || new Error('Could not save to this browser.'));
  });
}
const get = (store, key) => tx(store, 'readonly', (s) => s.get(key));
const put = (store, key, value) => tx(store, 'readwrite', (s) => s.put(value, key));
const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
const all = (store) => tx(store, 'readonly', (s) => s.getAll());
const keysWithPrefix = (store, prefix) => tx(store, 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿')));

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
const cleanTitle = (t) => String(t || '').trim().slice(0, 80) || 'Untitled world';
const notFound = () => Object.assign(new Error('That world is not saved in this browser.'), { status: 404 });

const assetUrls = new Map(); // "worldId/file" -> object URL, filled by prepareAssets / uploadAsset

async function publicWorld(w) {
  const thumb = await get('thumbs', w.id);
  return { id: w.id, title: w.title, share: 'private', updatedAt: w.updatedAt, owner: LOCAL_USER, isOwner: true, access: 'edit', hasThumb: !!thumb, thumbUrl: thumb ? URL.createObjectURL(thumb) : '' };
}

export const localApi = {
  config: async () => ({ googleClientId: '', devLogin: false, static: true }),
  me: async () => ({ user: LOCAL_USER }),
  logout: async () => ({ ok: true }),
  async worlds() {
    const list = (await all('worlds')).sort((a, b) => b.updatedAt - a.updatedAt);
    return { mine: await Promise.all(list.map(publicWorld)), shared: [] };
  },
  async createWorld(title) {
    const w = { id: newId(), title: cleanTitle(title), updatedAt: Date.now() };
    await put('worlds', w.id, w);
    return { world: await publicWorld(w) };
  },
  async world(id) {
    const w = await get('worlds', id);
    if (!w) throw notFound();
    return { world: await publicWorld(w) };
  },
  async updateWorld(id, patch) {
    const w = await get('worlds', id);
    if (!w) throw notFound();
    if (patch.title !== undefined) w.title = cleanTitle(patch.title);
    w.updatedAt = Date.now();
    await put('worlds', id, w);
    return { world: await publicWorld(w) };
  },
  async deleteWorld(id) {
    for (const store of ['worlds', 'snapshots', 'thumbs']) await del(store, id);
    for (const key of await keysWithPrefix('assets', id + '/')) await del('assets', key);
    return { ok: true };
  },
  async copyWorld(id) {
    const src = await get('worlds', id);
    if (!src) throw notFound();
    const w = { id: newId(), title: cleanTitle(`Copy of ${src.title}`), updatedAt: Date.now() };
    await put('worlds', w.id, w);
    const snap = await get('snapshots', id), thumb = await get('thumbs', id);
    if (snap) await put('snapshots', w.id, snap);
    if (thumb) await put('thumbs', w.id, thumb);
    for (const key of await keysWithPrefix('assets', id + '/')) await put('assets', w.id + key.slice(id.length), await get('assets', key));
    return { world: await publicWorld(w) };
  },
  saveThumbnail: (id, blob) => put('thumbs', id, blob),
  async uploadAsset(id, blob, ext) {
    if (!TYPES[ext]) throw new Error('Unsupported file type.');
    const file = `${newId()}.${ext}`;
    const typed = new Blob([blob], { type: TYPES[ext] });
    await put('assets', `${id}/${file}`, typed);
    assetUrls.set(`${id}/${file}`, URL.createObjectURL(typed));
    return { file };
  },
  /** Make every stored file of a world available as a URL before the scene is built. */
  async prepareAssets(id) {
    for (const key of await keysWithPrefix('assets', id + '/')) {
      if (!assetUrls.has(key)) assetUrls.set(key, URL.createObjectURL(await get('assets', key)));
    }
  },
  assetUrl: (id, file) => assetUrls.get(`${id}/${file}`) || '',
  thumbUrl: (w) => w.thumbUrl,
  searchModels: async () => ({ results: [], errors: [] }),

  // the world document itself (used by src/collab/doc.js)
  readSnapshot: (id) => get('snapshots', id),
  async writeSnapshot(id, bytes) {
    await put('snapshots', id, bytes);
    const w = await get('worlds', id);
    if (w) { w.updatedAt = Date.now(); await put('worlds', id, w); }
  },
};
