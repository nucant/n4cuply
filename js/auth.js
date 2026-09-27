// Google sign-in (Google Identity Services token flow).
// The token lives on this device and is valid for about an hour. signIn()
// opens a popup, so always call it from inside a user's click handler.
import { CONFIG } from '../config.js';

export const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
// Asked for only when the user uploads songs.
export const WRITE_SCOPE = 'https://www.googleapis.com/auth/drive';
const KEY = 'mp.token';

let readClient = null;
let writeClient = null;
let pending = null;
let token = loadToken();

function loadToken() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY));
    if (t && t.exp > Date.now() + 60e3) return t;
  } catch (e) { /* storage unavailable */ }
  return null;
}

function saveToken(t) {
  token = t;
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
  } catch (e) { /* storage unavailable */ }
}

function waitForGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    let tries = 0;
    const timer = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(timer);
        resolve();
      } else if (++tries > 150) {
        clearInterval(timer);
        reject(new Error("Google sign-in didn't load. Check your internet connection."));
      }
    }, 100);
  });
}

function settle(fn, value) {
  const p = pending;
  pending = null;
  if (p) p[fn](value);
}

function makeClient(scope) {
  return google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.googleClientId,
    scope,
    include_granted_scopes: true,
    callback: (resp) => {
      if (resp.error) {
        settle('reject', new Error(resp.error_description || resp.error));
        return;
      }
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
        settle('reject', new Error('Drive access was not granted. Try again and tick the Google Drive box.'));
        return;
      }
      const write = google.accounts.oauth2.hasGrantedAllScopes(resp, WRITE_SCOPE);
      if (scope.includes(WRITE_SCOPE) && !write) {
        settle('reject', new Error('Upload permission was not granted. Tick the Drive box to allow uploads.'));
        return;
      }
      saveToken({ value: resp.access_token, exp: Date.now() + Number(resp.expires_in || 3599) * 1000, write });
      settle('resolve', token.value);
    },
    error_callback: (err) => {
      const msg = err?.type === 'popup_closed' ? 'The sign-in window was closed.'
        : err?.type === 'popup_failed_to_open' ? "Couldn't open the sign-in popup. Allow popups for this site."
        : 'Sign-in failed.';
      settle('reject', new Error(msg));
    },
  });
}

export async function initAuth() {
  await waitForGis();
  readClient = makeClient(SCOPE);
}

export function hasToken() {
  return !!token && token.exp > Date.now() + 30e3;
}

export function canWrite() {
  return hasToken() && !!token.write;
}

/** True when less than 10 minutes are left, so we can refresh on the next click. */
export function expiresSoon() {
  return !token || token.exp - Date.now() < 10 * 60e3;
}

export function accessToken() {
  return hasToken() ? token.value : null;
}

/**
 * Opens the Google popup and resolves with a token. Call synchronously from
 * a click handler. Pass { write: true } to also ask for upload permission.
 */
export function signIn({ write = false } = {}) {
  if (!readClient) return Promise.reject(new Error("Sign-in isn't ready yet. Try again in a moment."));
  if (pending) return pending.promise;
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  pending = { resolve, reject, promise };
  const wantWrite = write || !!token?.write;
  if (wantWrite && !writeClient) writeClient = makeClient(`${SCOPE} ${WRITE_SCOPE}`);
  (wantWrite ? writeClient : readClient).requestAccessToken({ prompt: '' });
  return promise;
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(token.value, () => {});
  }
  saveToken(null);
}
