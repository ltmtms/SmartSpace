// Thin wrapper around the server's JSON API.
async function request(method, url, body, raw) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (raw) { init.body = raw.body; if (raw.type) init.headers['Content-Type'] = raw.type; } else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(url, init);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  config: () => request('GET', '/api/config'),
  me: () => request('GET', '/api/auth/me'),
  googleLogin: (credential) => request('POST', '/api/auth/google', { credential }),
  devLogin: (name) => request('POST', '/api/auth/dev', { name }),
  logout: () => request('POST', '/api/auth/logout'),
  worlds: () => request('GET', '/api/worlds'),
  createWorld: (title) => request('POST', '/api/worlds', { title }),
  world: (id) => request('GET', `/api/worlds/${id}`),
  updateWorld: (id, patch) => request('PATCH', `/api/worlds/${id}`, patch),
  deleteWorld: (id) => request('DELETE', `/api/worlds/${id}`),
  copyWorld: (id) => request('POST', `/api/worlds/${id}/copy`),
  saveThumbnail: (id, blob) => request('PUT', `/api/worlds/${id}/thumbnail`, undefined, { body: blob, type: 'image/jpeg' }),
  uploadAsset(id, blob, ext) {
    const form = new FormData();
    form.append('ext', ext);
    form.append('file', blob, `upload.${ext}`);
    return request('POST', `/api/worlds/${id}/assets`, undefined, { body: form });
  },
  searchModels: (q) => request('GET', `/api/search/models?q=${encodeURIComponent(q)}`),
  polyHavenUrl: (id) => request('GET', `/api/search/polyhaven/${encodeURIComponent(id)}`),
  assetUrl: (worldId, file) => `/api/worlds/${worldId}/assets/${file}`,
  proxyUrl: (url) => `/api/search/proxy?url=${encodeURIComponent(url)}`,
};
