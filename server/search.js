// External 3D model search. The server talks to the providers so API keys stay off the client,
// and proxies downloads from an allowlist of provider hosts so browsers do not hit CORS walls.
//   Poly Haven  - CC0 models, no key needed.
//   Poly Pizza  - low-poly CC0/CC-BY models; set POLY_PIZZA_API_KEY to enable.
const UA = 'SmartSpace/1.0 (education 3D world builder)';
const POLY_PIZZA_KEY = process.env.POLY_PIZZA_API_KEY || '';
const PROXY_HOSTS = new Set(['dl.polyhaven.org', 'cdn.polyhaven.com', 'static.poly.pizza']);

let havenCache = { at: 0, list: [] };
async function havenList() {
  if (Date.now() - havenCache.at < 3600_000 && havenCache.list.length) return havenCache.list;
  const r = await fetch('https://api.polyhaven.com/assets?t=models', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('Poly Haven ' + r.status);
  const json = await r.json();
  havenCache = {
    at: Date.now(),
    list: Object.entries(json).map(([id, a]) => ({
      id, name: a.name, hay: [a.name, ...(a.tags || []), ...(a.categories || [])].join(' ').toLowerCase(),
      downloads: a.download_count || 0,
    })),
  };
  return havenCache.list;
}

async function searchHaven(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = await havenList();
  return list.filter((a) => words.every((w) => a.hay.includes(w)))
    .sort((a, b) => b.downloads - a.downloads).slice(0, 24)
    .map((a) => ({
      provider: 'polyhaven', id: a.id, name: a.name, author: 'Poly Haven', license: 'CC0',
      thumb: `https://cdn.polyhaven.com/asset_img/thumbs/${a.id}.png?height=160`,
    }));
}

async function searchPizza(q) {
  if (!POLY_PIZZA_KEY) return [];
  const r = await fetch(`https://api.poly.pizza/v1.1/search/${encodeURIComponent(q)}?Limit=24`, {
    headers: { 'x-auth-token': POLY_PIZZA_KEY, 'User-Agent': UA }, signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error('Poly Pizza ' + r.status);
  const json = await r.json();
  return (json.results || []).map((m) => ({
    provider: 'polypizza', id: m.ID, name: m.Title, author: m.Creator?.Username || 'Poly Pizza',
    license: m.Licence || '', thumb: m.Thumbnail, url: m.Download,
  }));
}

export function searchRoutes(app, requireUser) {
  app.get('/api/search/models', requireUser, async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (!q) return res.json({ results: [], errors: [] });
    const settled = await Promise.allSettled([searchPizza(q), searchHaven(q)]);
    res.json({
      results: settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : [])),
      errors: settled.filter((s) => s.status === 'rejected').map((s) => String(s.reason?.message || s.reason)),
    });
  });

  // Resolve a Poly Haven asset id to a downloadable glTF url.
  app.get('/api/search/polyhaven/:id', requireUser, async (req, res) => {
    try {
      if (!/^[\w-]{1,80}$/.test(req.params.id)) return res.status(400).json({ error: 'Bad id' });
      const r = await fetch(`https://api.polyhaven.com/files/${req.params.id}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('Poly Haven ' + r.status);
      const files = await r.json();
      const url = files?.gltf?.['1k']?.gltf?.url;
      if (!url) return res.status(404).json({ error: 'No glTF download for this model.' });
      res.json({ url });
    } catch (e) {
      res.status(502).json({ error: 'Could not reach Poly Haven.' });
    }
  });

  // Download proxy, limited to provider hosts (never an open proxy).
  app.get('/api/search/proxy', requireUser, async (req, res) => {
    let url;
    try { url = new URL(String(req.query.url)); } catch { return res.status(400).end(); }
    if (url.protocol !== 'https:' || !PROXY_HOSTS.has(url.hostname)) return res.status(403).end();
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!r.ok) return res.status(502).end();
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.status(502).end();
    }
  });
}
