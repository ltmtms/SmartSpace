// Google Sign-In: the browser gets an ID token from Google Identity Services and posts it here;
// we verify it against Google's keys and issue our own signed, HttpOnly session cookie.
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { sessionSecret, upsertUser, getUser } from './store.js';

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
// Optional: restrict sign-in to Google Workspace domains, e.g. ALLOWED_DOMAINS=myschool.edu,district.org
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
// Name-only login (no Google). On by default for local development; on a deployed server it must be
// switched on explicitly with GUEST_LOGIN=true and is meant for short-lived test deployments only:
// anyone who can reach the site can sign in under any name. GUEST_CODE optionally requires a shared code.
// It is always off once GOOGLE_CLIENT_ID is set.
const GUEST_CODE = process.env.GUEST_CODE || '';
export const DEV_LOGIN = !GOOGLE_CLIENT_ID && (process.env.NODE_ENV !== 'production' || process.env.GUEST_LOGIN === 'true');

const COOKIE = 'ss_session';
const MAX_AGE = 60 * 60 * 24 * 14; // seconds
const oauth = new OAuth2Client(GOOGLE_CLIENT_ID);

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (body) => crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');

function makeToken(uid) {
  const body = b64(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + MAX_AGE }));
  return `${body}.${sign(body)}`;
}
function readToken(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expect = sign(body);
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return exp > Date.now() / 1000 ? uid : null;
  } catch { return null; }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Works for both Express requests and raw WebSocket upgrade requests. */
export function userFromRequest(req) {
  const uid = readToken(parseCookies(req.headers.cookie)[COOKIE]);
  return uid ? getUser(uid) : null;
}

function setSession(req, res, uid) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${makeToken(uid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`);
}

export function requireUser(req, res, next) {
  req.user = userFromRequest(req);
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

export function authRoutes(app) {
  app.get('/api/config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID, devLogin: DEV_LOGIN, guestCode: DEV_LOGIN && !!GUEST_CODE }));

  app.get('/api/auth/me', (req, res) => res.json({ user: userFromRequest(req) }));

  app.post('/api/auth/google', async (req, res) => {
    if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
    try {
      const ticket = await oauth.verifyIdToken({ idToken: String(req.body?.credential || ''), audience: GOOGLE_CLIENT_ID });
      const p = ticket.getPayload();
      if (!p?.sub || !p.email_verified) return res.status(401).json({ error: 'Google account could not be verified.' });
      if (ALLOWED_DOMAINS.length && !ALLOWED_DOMAINS.includes(String(p.hd || '').toLowerCase())) {
        return res.status(403).json({ error: 'This Google account is not part of an allowed school domain.' });
      }
      const user = upsertUser({ id: 'g' + p.sub, email: p.email, name: p.name || p.email, picture: p.picture || '' });
      setSession(req, res, user.id);
      res.json({ user });
    } catch (e) {
      res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
    }
  });

  app.post('/api/auth/dev', (req, res) => {
    if (!DEV_LOGIN) return res.status(404).json({ error: 'Not found' });
    if (GUEST_CODE && String(req.body?.code || '') !== GUEST_CODE) return res.status(403).json({ error: 'That access code is not right.' });
    const name = String(req.body?.name || '').trim().slice(0, 40) || 'Dev User';
    const id = 'dev' + crypto.createHash('sha1').update(name.toLowerCase()).digest('hex').slice(0, 12);
    const user = upsertUser({ id, email: `${name.toLowerCase().replace(/\W+/g, '.')}@dev.local`, name, picture: '' });
    setSession(req, res, user.id);
    res.json({ user });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });
}
