// N4cuply family server (Cloudflare Worker + D1).
//
// Family members sign in with a username and password and play the admin's
// music without any Google account or permission of their own: this worker
// holds the admin's Drive access (a refresh token, saved once from the admin
// portal) and passes songs through, read-only, and only from the music folder.
//
// Secrets (wrangler secret put):  GOOGLE_CLIENT_SECRET, SESSION_KEY
// Vars (wrangler.toml):           GOOGLE_CLIENT_ID, ADMIN_EMAIL, ROOT_FOLDER, APP_ORIGINS
//
// Routes
//   POST /api/signup                 { username, name, password }  -> waits for approval
//   POST /api/login                  { username, password }        -> { token, user }
//   GET  /api/me                     (session)
//   POST /api/password               { current, password }  (session) -> { token }
//   GET  /api/admin/...              (admin's Google token)         users and settings
//   GET  /auth/google/start|callback                                admin links Drive once
//   GET  /drive/v3/files[/<id>]      (session)                      read-only Drive mirror

const SESSION_DAYS = 180;
const PBKDF2_ROUNDS = 100000; // the most Workers allow
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60e3;
const DRIVE = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

// ---------------------------------------------------------------- helpers
const enc = new TextEncoder();
const now = () => Date.now();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function randomB64(n = 16) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

/** Compares without leaking where the strings differ. */
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(salt), iterations: PBKDF2_ROUNDS }, key, 256);
  return b64url(bits);
}

async function hmac(env, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

/** Signed, expiring token: base64url(json).signature */
async function sign(env, data) {
  const body = b64url(enc.encode(JSON.stringify(data)));
  return `${body}.${await hmac(env, body)}`;
}

async function verify(env, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !sameText(sig, await hmac(env, body))) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return data.exp > now() ? data : null;
  } catch (e) {
    return null;
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function origins(env) {
  return String(env.APP_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const list = origins(env);
  return {
    'Access-Control-Allow-Origin': list.includes(origin) ? origin : list[0] || '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function body(req) {
  try {
    return await req.json();
  } catch (e) {
    throw new HttpError(400, 'Bad request.');
  }
}

const bearer = (req) => (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

// ---------------------------------------------------------------- settings
async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : '';
}

async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

async function rootFolder(env) {
  return (await getSetting(env, 'root_folder')) || env.ROOT_FOLDER;
}

// ---------------------------------------------------------------- family accounts
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/i;

function checkNewUser({ username, name, password }) {
  if (!USERNAME_RE.test(String(username || ''))) throw new HttpError(400, 'Username: 3 to 32 letters, numbers, dots, dashes or underscores.');
  if (String(password || '').length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
  if (String(name || '').length > 60) throw new HttpError(400, 'Name is too long.');
}

async function createUser(env, { username, name, password }, status) {
  checkNewUser({ username, name, password });
  const salt = randomB64(16);
  const hash = await hashPassword(password, salt);
  try {
    await env.DB.prepare('INSERT INTO users (username, name, pass_hash, salt, status, created_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(username.trim(), String(name || '').trim(), hash, salt, status, now(), status === 'approved' ? now() : null).run();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'That username is taken.');
    throw e;
  }
}

const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, status: u.status, createdAt: u.created_at, approvedAt: u.approved_at, lastLogin: u.last_login });

async function signup(req, env) {
  const b = await body(req);
  await createUser(env, b, 'pending');
  return json({ ok: true, message: 'Request sent. You can sign in once the admin approves it.' });
}

async function login(req, env) {
  const { username, password } = await body(req);
  const u = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(String(username || '').trim()).first();
  const wrong = new HttpError(401, 'Wrong username or password.');
  if (!u) {
    await hashPassword(String(password || ''), randomB64(16)); // same time as a real check
    throw wrong;
  }
  if (u.locked_until > now()) throw new HttpError(429, 'Too many wrong passwords. Try again in 15 minutes.');
  const hash = await hashPassword(String(password || ''), u.salt);
  if (!sameText(hash, u.pass_hash)) {
    const fails = u.fails + 1;
    await env.DB.prepare('UPDATE users SET fails = ?, locked_until = ? WHERE id = ?')
      .bind(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? now() + LOCK_MS : 0, u.id).run();
    throw wrong;
  }
  if (u.status === 'pending') throw new HttpError(403, 'Your account is waiting for the admin to approve it.');
  if (u.status !== 'approved') throw new HttpError(403, 'Your account is turned off. Ask the admin.');
  await env.DB.prepare('UPDATE users SET fails = 0, locked_until = 0, last_login = ? WHERE id = ?').bind(now(), u.id).run();
  const token = await sign(env, { u: u.id, v: u.ver, exp: now() + SESSION_DAYS * 864e5 });
  return json({ token, user: publicUser(u) });
}

/** A family member changes their own password. Signs out their other devices; this one gets a new token. */
async function changePassword(req, env) {
  const u = await sessionUser(req, env);
  const { current, password } = await body(req);
  if (!sameText(await hashPassword(String(current || ''), u.salt), u.pass_hash)) throw new HttpError(400, 'Your current password is wrong.');
  if (String(password || '').length < 6) throw new HttpError(400, 'The new password must be at least 6 characters.');
  const salt = randomB64(16);
  await env.DB.prepare('UPDATE users SET pass_hash = ?, salt = ?, ver = ver + 1 WHERE id = ?').bind(await hashPassword(password, salt), salt, u.id).run();
  const token = await sign(env, { u: u.id, v: u.ver + 1, exp: now() + SESSION_DAYS * 864e5 });
  return json({ token });
}

/** The signed-in family member, or a 401. Checked against the database each time, so admin changes apply at once. */
async function sessionUser(req, env) {
  const data = await verify(env, bearer(req));
  if (!data) throw new HttpError(401, 'Please sign in again.');
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(data.u).first();
  if (!u || u.ver !== data.v) throw new HttpError(401, 'Please sign in again.');
  if (u.status !== 'approved') throw new HttpError(403, 'Your account is turned off. Ask the admin.');
  return u;
}

// ---------------------------------------------------------------- admin
const adminCache = new Map(); // Google token -> expiry of the check

/** The admin proves who they are with the Google token the app already has. */
async function requireAdmin(req, env) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'Sign in with Google first.');
  if ((adminCache.get(token) || 0) > now()) return;
  const res = await fetch(`${DRIVE}/about?fields=user(emailAddress)`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new HttpError(401, 'Your Google sign-in expired. Sign in again.');
  const email = ((await res.json()).user?.emailAddress || '').toLowerCase();
  if (email !== env.ADMIN_EMAIL.toLowerCase()) throw new HttpError(403, 'Only the admin can open this.');
  if (adminCache.size > 50) adminCache.clear();
  adminCache.set(token, now() + 5 * 60e3);
}

async function admin(req, env, path) {
  await requireAdmin(req, env);
  if (path === '/api/admin/status' && req.method === 'GET') {
    return json({
      driveLinked: !!(await getSetting(env, 'drive_refresh_token')),
      driveEmail: await getSetting(env, 'drive_email'),
      rootFolder: await rootFolder(env),
    });
  }
  if (path === '/api/admin/settings' && req.method === 'POST') {
    const { rootFolder: folder } = await body(req);
    if (!/^[\w-]{10,}$/.test(String(folder || ''))) throw new HttpError(400, "That doesn't look like a Drive folder id.");
    await setSetting(env, 'root_folder', folder);
    allowed.clear();
    return json({ ok: true });
  }
  if (path === '/api/admin/users' && req.method === 'GET') {
    const { results } = await env.DB.prepare("SELECT * FROM users ORDER BY status = 'pending' DESC, created_at DESC").all();
    return json({ users: results.map(publicUser) });
  }
  if (path === '/api/admin/users' && req.method === 'POST') {
    await createUser(env, await body(req), 'approved');
    return json({ ok: true });
  }
  const m = path.match(/^\/api\/admin\/users\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    if (!u) throw new HttpError(404, 'No such user.');
    if (req.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    if (req.method === 'POST') {
      const { action, password } = await body(req);
      if (action === 'approve' || action === 'enable') {
        await env.DB.prepare("UPDATE users SET status = 'approved', approved_at = COALESCE(approved_at, ?) WHERE id = ?").bind(now(), id).run();
      } else if (action === 'disable') {
        await env.DB.prepare("UPDATE users SET status = 'disabled', ver = ver + 1 WHERE id = ?").bind(id).run();
      } else if (action === 'password') {
        if (String(password || '').length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
        const salt = randomB64(16);
        await env.DB.prepare('UPDATE users SET pass_hash = ?, salt = ?, ver = ver + 1, fails = 0, locked_until = 0 WHERE id = ?')
          .bind(await hashPassword(password, salt), salt, id).run();
      } else {
        throw new HttpError(400, 'Unknown action.');
      }
      return json({ ok: true });
    }
  }
  throw new HttpError(404, 'Not found.');
}

// ---------------------------------------------------------------- linking the admin's Drive
const callbackUrl = (req) => `${new URL(req.url).origin}/auth/google/callback`;

async function googleStart(req, env) {
  const back = new URL(req.url).searchParams.get('back') || '';
  if (!origins(env).some((o) => back.startsWith(o + '/'))) throw new HttpError(400, 'Unknown return address.');
  const state = await sign(env, { back, exp: now() + 10 * 60e3 });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(req),
    response_type: 'code',
    scope: `${DRIVE_SCOPE} email`,
    access_type: 'offline',
    prompt: 'consent', // always returns a refresh token
    login_hint: env.ADMIN_EMAIL,
    state,
  });
  return Response.redirect(url.href, 302);
}

async function googleCallback(req, env) {
  const p = new URL(req.url).searchParams;
  const state = await verify(env, p.get('state'));
  if (!state) throw new HttpError(400, 'This link expired. Start again from the admin page.');
  const back = new URL(state.back);
  // Sends the admin back with the reason (Google's error code, never a secret).
  const failed = (why) => {
    console.error('Drive link failed:', why);
    back.searchParams.set('drive', 'error');
    back.searchParams.set('why', String(why).slice(0, 200));
    return Response.redirect(back.href, 302);
  };
  if (p.get('error')) return failed(p.get('error'));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: p.get('code') || '',
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(req),
      grant_type: 'authorization_code',
    }),
  });
  const t = await res.json();
  if (!res.ok) return failed(`${t.error || res.status}: ${t.error_description || ''}`);
  if (!t.refresh_token) return failed('Google sent no refresh token');
  if (!String(t.scope || '').includes(DRIVE_SCOPE)) return failed('Drive access was not ticked');
  const who = await (await fetch(`${DRIVE}/about?fields=user(emailAddress)`, { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
  const email = (who.user?.emailAddress || '').toLowerCase();
  if (email !== env.ADMIN_EMAIL.toLowerCase()) {
    back.searchParams.set('drive', 'wrong-account');
    return Response.redirect(back.href, 302);
  }
  await setSetting(env, 'drive_refresh_token', t.refresh_token);
  await setSetting(env, 'drive_email', email);
  driveToken = { value: t.access_token, exp: now() + (t.expires_in - 120) * 1000 };
  back.searchParams.set('drive', 'ok');
  return Response.redirect(back.href, 302);
}

let driveToken = null; // { value, exp }

async function adminDriveToken(env) {
  if (driveToken && driveToken.exp > now()) return driveToken.value;
  const refresh = await getSetting(env, 'drive_refresh_token');
  if (!refresh) throw new HttpError(503, "The admin hasn't linked the music yet.");
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const t = await res.json();
  if (!res.ok) throw new HttpError(503, 'The music link stopped working. The admin needs to link Drive again.');
  driveToken = { value: t.access_token, exp: now() + (t.expires_in - 120) * 1000 };
  return driveToken.value;
}

// ---------------------------------------------------------------- read-only Drive mirror
// Only files inside the music folder can be read. Folders seen in a listing
// are remembered so a library scan doesn't check each one again.
const allowed = new Set();

async function isInside(env, id, token) {
  const root = await rootFolder(env);
  let cur = id;
  const trail = [];
  for (let depth = 0; depth < 25 && cur; depth++) {
    if (cur === root || allowed.has(cur)) {
      for (const t of trail) allowed.add(t);
      return true;
    }
    trail.push(cur);
    const res = await fetch(`${DRIVE}/files/${encodeURIComponent(cur)}?fields=parents&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return false;
    cur = (await res.json()).parents?.[0] || '';
  }
  return false;
}

async function drive(req, env, path) {
  await sessionUser(req, env);
  const token = await adminDriveToken(env);
  const url = new URL(req.url);
  const auth = { Authorization: `Bearer ${token}` };

  if (path === '/drive/v3/files') {
    // Only "'<folder>' in parents and trashed = false" listings.
    const m = (url.searchParams.get('q') || '').match(/^'([\w-]+)' in parents and trashed = false$/);
    if (!m || !(await isInside(env, m[1], token))) throw new HttpError(403, 'Not part of the music library.');
    const res = await fetch(`${DRIVE}/files${url.search}`, { headers: auth });
    const j = await res.json();
    if (res.ok) for (const f of j.files || []) if (f.mimeType === FOLDER_MIME) allowed.add(f.id);
    return json(j, res.status);
  }

  const m = path.match(/^\/drive\/v3\/files\/([\w-]+)$/);
  if (!m) throw new HttpError(404, 'Not found.');
  if (!(await isInside(env, m[1], token))) throw new HttpError(404, 'File not found.');
  const range = req.headers.get('Range');
  const res = await fetch(`${DRIVE}/files/${m[1]}${url.search}`, { headers: range ? { ...auth, Range: range } : auth });
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

// ---------------------------------------------------------------- router
async function route(req, env) {
  const path = new URL(req.url).pathname;
  if (path === '/api/signup' && req.method === 'POST') return signup(req, env);
  if (path === '/api/login' && req.method === 'POST') return login(req, env);
  if (path === '/api/me' && req.method === 'GET') return json({ user: publicUser(await sessionUser(req, env)) });
  if (path === '/api/password' && req.method === 'POST') return changePassword(req, env);
  if (path.startsWith('/api/admin/')) return admin(req, env, path);
  if (path === '/auth/google/start') return googleStart(req, env);
  if (path === '/auth/google/callback') return googleCallback(req, env);
  if (path.startsWith('/drive/v3/') && req.method === 'GET') return drive(req, env, path);
  if (path === '/') return new Response('N4cuply server is running.', { headers: { 'Content-Type': 'text/plain' } });
  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await route(req, env);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      res = json({ error: { message: e instanceof HttpError ? e.message : 'Server error. Try again.' } }, status);
      if (status === 500) console.error(e);
    }
    if (res.status >= 300 && res.status < 400) return res; // redirects
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
