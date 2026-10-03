// Family accounts: sign in with a username and password (no Google account).
// Songs then come through the N4cuply server (server/worker.js), which reads
// the admin's Drive for them, read-only. The session lives on this device.
import { CONFIG } from '../config.js';

const KEY = 'mp.family.v1';

let session = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.token && s.user) return s;
  } catch (e) { /* storage unavailable */ }
  return null;
}

function save() {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch (e) { /* storage unavailable */ }
}

export const familyEnabled = () => !!CONFIG.apiBase;
export const isFamily = () => !!session;
export const familyToken = () => session?.token || '';
export const familyUser = () => session?.user || null;
/** Drive API address: the server for family members, Google for the admin. */
export const driveApiBase = () => (session ? `${CONFIG.apiBase}/drive/v3` : 'https://www.googleapis.com/drive/v3');

async function post(path, data, token = '') {
  let res;
  try {
    res = await fetch(CONFIG.apiBase + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(data),
    });
  } catch (e) {
    throw new Error("Couldn't reach the server. Check your internet connection.");
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `Something went wrong (${res.status}).`);
  return j;
}

export async function familyLogin(username, password) {
  const j = await post('/api/login', { username, password });
  session = { token: j.token, user: j.user };
  save();
  return j.user;
}

/** Asks the admin for an account. Resolves with the server's message. */
export async function familySignup(username, name, password) {
  return (await post('/api/signup', { username, name, password })).message;
}

/** Changes the signed-in member's password; other devices are signed out. */
export async function familyChangePassword(current, password) {
  const j = await post('/api/password', { current, password }, familyToken());
  session = { ...session, token: j.token };
  save();
}

export function familyLogout() {
  session = null;
  save();
}

// ---------------------------------------------------------------- admin portal calls
/** Admin requests carry the admin's Google token; the server checks it's the admin. */
export async function adminApi(path, googleToken, { method = 'GET', data } = {}) {
  let res;
  try {
    res = await fetch(CONFIG.apiBase + path, {
      method,
      headers: { Authorization: `Bearer ${googleToken}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      body: data ? JSON.stringify(data) : undefined,
    });
  } catch (e) {
    throw new Error("Couldn't reach the server. Check your internet connection.");
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(j.error?.message || `Something went wrong (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return j;
}
