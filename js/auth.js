// Google sign-in (Google Identity Services token flow), for one or more accounts.
// Tokens live on this device, one per Google account, each valid for about an
// hour. signIn() opens a popup, so always call it from inside a click handler.
import { CONFIG } from '../config.js';

export const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
// Asked for only when the user uploads songs.
export const WRITE_SCOPE = 'https://www.googleapis.com/auth/drive';
const KEY = 'mp.tokens.v2';

let readClient = null;
let writeClient = null;
let pending = null;
let pendingOpts = {};
const state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.tokens) return s;
  } catch (e) { /* storage unavailable */ }
  return { primary: '', tokens: {}, names: {} };
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
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

async function whoIs(accessToken) {
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) throw new Error("Couldn't read your Google account. Try again.");
  const j = await res.json();
  return { email: j.user?.emailAddress || '', name: j.user?.displayName || '' };
}

function makeClient(scope) {
  return google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.googleClientId,
    scope,
    include_granted_scopes: true,
    callback: async (resp) => {
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
        settle('reject', new Error('Upload permission was not granted. In the Google window, tick "See, edit, create and delete all of your Google Drive files".'));
        return;
      }
      try {
        const who = await whoIs(resp.access_token);
        const email = who.email || pendingOpts.account || 'account';
        if (pendingOpts.account && email.toLowerCase() !== pendingOpts.account.toLowerCase()) {
          settle('reject', new Error(`You picked ${email}, but this needs ${pendingOpts.account}.`));
          return;
        }
        state.tokens[email] = { value: resp.access_token, exp: Date.now() + Number(resp.expires_in || 3599) * 1000, write };
        state.names[email] = who.name;
        if (!state.primary) state.primary = email;
        save();
        settle('resolve', email);
      } catch (e) {
        settle('reject', e);
      }
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

export const primaryAccount = () => state.primary;
export const accountName = (email) => state.names[email] || '';
export const knownAccounts = () => Object.keys(state.tokens);

const tokenOf = (account) => state.tokens[account || state.primary];

export function hasToken(account) {
  const t = tokenOf(account);
  return !!t && t.exp > Date.now() + 30e3;
}

export function canWrite(account) {
  return hasToken(account) && !!tokenOf(account).write;
}

/** True when less than 10 minutes are left, so we can refresh on the next click. */
export function expiresSoon(account) {
  const t = tokenOf(account);
  return !t || t.exp - Date.now() < 10 * 60e3;
}

export function accessToken(account) {
  return hasToken(account) ? tokenOf(account).value : null;
}

/**
 * Opens the Google popup and resolves with the signed-in email. Call it
 * synchronously from a click handler.
 *   account: sign in to this specific account (no picker when already allowed)
 *   choose:  always show the account picker (for adding another account)
 *   write:   also ask for upload permission
 */
export function signIn({ account = '', choose = false, write = false } = {}) {
  if (!readClient) return Promise.reject(new Error("Sign-in isn't ready yet. Try again in a moment."));
  if (pending) return pending.promise;
  const target = choose ? '' : (account || state.primary);
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  pending = { resolve, reject, promise };
  pendingOpts = { account: choose ? '' : account };
  const wantWrite = write || !!tokenOf(target)?.write;
  if (wantWrite && !writeClient) writeClient = makeClient(`${SCOPE} ${WRITE_SCOPE}`);
  // A new permission (uploading) needs the consent screen; with prompt '' Google
  // may close the popup at once and return a token without it.
  const needsConsent = write && !tokenOf(target)?.write;
  const override = { prompt: choose ? 'select_account' : needsConsent ? 'consent' : '' };
  if (target) override.login_hint = target;
  (wantWrite ? writeClient : readClient).requestAccessToken(override);
  return promise;
}

export function signOut() {
  for (const t of Object.values(state.tokens)) {
    try { google.accounts.oauth2.revoke(t.value, () => {}); } catch (e) { /* offline */ }
  }
  state.primary = '';
  state.tokens = {};
  state.names = {};
  save();
}

// Old single-account token from v1.2 and earlier.
try { localStorage.removeItem('mp.token'); } catch (e) { /* ignore */ }
