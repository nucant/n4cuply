// Google login (Google Identity Services token flow).
// Token device-e thake, ~1 ghonta valid. Popup kholar jonno signIn()
// sobsomoy user-er click-er bhetor theke call korte hobe.
import { CONFIG } from '../config.js';

export const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const KEY = 'mp.token';

let client = null;
let pending = null;
let token = loadToken();

function loadToken() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY));
    if (t && t.exp > Date.now() + 60e3) return t;
  } catch (e) { /* storage bondho */ }
  return null;
}

function saveToken(t) {
  token = t;
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
  } catch (e) { /* storage bondho */ }
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
        reject(new Error('Google login load hoyni. Internet connection check koro.'));
      }
    }, 100);
  });
}

function settle(fn, value) {
  const p = pending;
  pending = null;
  if (p) p[fn](value);
}

export async function initAuth() {
  await waitForGis();
  client = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.googleClientId,
    scope: SCOPE,
    callback: (resp) => {
      if (resp.error) {
        settle('reject', new Error(resp.error_description || resp.error));
        return;
      }
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
        settle('reject', new Error('Drive permission dewa hoyni. Abar try koro, Drive-er box-e tick dite hobe.'));
        return;
      }
      saveToken({ value: resp.access_token, exp: Date.now() + Number(resp.expires_in || 3599) * 1000 });
      settle('resolve', token.value);
    },
    error_callback: (err) => {
      const msg = err?.type === 'popup_closed' ? 'Login window bondho hoye geche.'
        : err?.type === 'popup_failed_to_open' ? 'Popup khulte parchi na. Browser-e popup allow koro.'
        : 'Login hoyni.';
      settle('reject', new Error(msg));
    },
  });
}

export function hasToken() {
  return !!token && token.exp > Date.now() + 30e3;
}

/** 10 minute-er kom baki thakle true. Click-er somoy refresh korar jonno. */
export function expiresSoon() {
  return !token || token.exp - Date.now() < 10 * 60e3;
}

export function accessToken() {
  return hasToken() ? token.value : null;
}

/** Popup khule token ane. User-er click handler theke sync-bhabe call koro. */
export function signIn() {
  if (!client) return Promise.reject(new Error('Login ekhono ready na, ektu por try koro.'));
  if (pending) return pending.promise;
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  pending = { resolve, reject, promise };
  client.requestAccessToken({ prompt: '' });
  return promise;
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(token.value, () => {});
  }
  saveToken(null);
}
