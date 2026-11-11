import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import multer from 'multer';
import { authRoutes, requireUser, GOOGLE_CLIENT_ID, DEV_LOGIN } from './auth.js';
import { attachCollab, flushRoom, closeRoom, recheckRoom } from './collab.js';
import { searchRoutes } from './search.js';
import * as store from './store.js';

const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';
const root = path.resolve(import.meta.dirname, '..');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

authRoutes(app);
searchRoutes(app, requireUser);

// ---- worlds ----
function withWorld(need) {
  return (req, res, next) => {
    const world = store.getWorld(req.params.id);
    const access = store.accessFor(world, req.user.id);
    if (!world || !access) return res.status(404).json({ error: 'World not found, or it has not been shared with you.' });
    if (need === 'edit' && access !== 'edit') return res.status(403).json({ error: 'You can only view this world.' });
    if (need === 'owner' && world.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the owner can do that.' });
    req.world = world;
    next();
  };
}

app.get('/api/worlds', requireUser, (req, res) => res.json(store.listWorlds(req.user.id)));
app.post('/api/worlds', requireUser, (req, res) => {
  res.json({ world: store.publicWorld(store.createWorld(req.user.id, req.body?.title), req.user.id) });
});
app.get('/api/worlds/:id', requireUser, withWorld('view'), (req, res) => {
  res.json({ world: store.publicWorld(req.world, req.user.id) });
});
app.patch('/api/worlds/:id', requireUser, withWorld('edit'), (req, res) => {
  const patch = { title: req.body?.title };
  if (req.world.ownerId === req.user.id) patch.share = req.body?.share; // only the owner changes sharing
  const world = store.updateWorld(req.world.id, patch);
  recheckRoom(world.id);
  res.json({ world: store.publicWorld(world, req.user.id) });
});
app.delete('/api/worlds/:id', requireUser, withWorld('owner'), (req, res) => {
  closeRoom(req.world.id);
  store.deleteWorld(req.world.id);
  res.json({ ok: true });
});
app.post('/api/worlds/:id/copy', requireUser, withWorld('view'), (req, res) => {
  flushRoom(req.world.id);
  const copy = store.createWorld(req.user.id, `Copy of ${req.world.title}`);
  store.copyWorldFiles(req.world.id, copy.id);
  res.json({ world: store.publicWorld(copy, req.user.id) });
});

// ---- thumbnails ----
app.put('/api/worlds/:id/thumbnail', requireUser, withWorld('edit'), express.raw({ type: 'image/jpeg', limit: '400kb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: 'Bad image' });
  fs.writeFileSync(store.thumbPath(req.world.id), req.body);
  res.json({ ok: true });
});
app.get('/api/worlds/:id/thumbnail', requireUser, withWorld('view'), (req, res) => {
  const p = store.thumbPath(req.world.id);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.type('image/jpeg').sendFile(p);
});

// ---- uploaded assets (models are converted to .glb in the browser before upload) ----
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024, files: 1 } });
app.post('/api/worlds/:id/assets', requireUser, withWorld('edit'), upload.single('file'), (req, res) => {
  const ext = String(req.body?.ext || '').toLowerCase();
  if (!req.file || !store.ASSET_TYPES[ext]) return res.status(400).json({ error: 'Unsupported file type.' });
  res.json({ file: store.saveAsset(req.world.id, ext, req.file.buffer) });
});
app.get('/api/worlds/:id/assets/:file', requireUser, withWorld('view'), (req, res) => {
  const p = store.assetPath(req.world.id, req.params.file);
  if (!p) return res.status(404).end();
  res.setHeader('Content-Type', store.ASSET_TYPES[path.extname(p).slice(1)] || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(p);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---- front end ----
const server = http.createServer(app);
attachCollab(server);

if (PROD) {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist, { index: false }));
  app.get('/{*any}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 413 ? 'That file is too large.' : err.expose ? err.message : 'Something went wrong.' });
});

server.listen(PORT, () => {
  console.log(`SmartSpace running at http://localhost:${PORT}  (${PROD ? 'production' : 'development'})`);
  if (!GOOGLE_CLIENT_ID) {
    console.log(DEV_LOGIN
      ? 'GOOGLE_CLIENT_ID is not set: Google sign-in is off and the local dev login is enabled.'
      : 'GOOGLE_CLIENT_ID is not set: nobody can sign in. Set it and restart.');
  }
});
