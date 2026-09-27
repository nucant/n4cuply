// Google Drive API (v3) - shudhu pora.
import { accessToken } from './auth.js';

export const API = 'https://www.googleapis.com/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class AuthError extends Error {}

async function request(url, init = {}) {
  const t = accessToken();
  if (!t) throw new AuthError('Abar login korte hobe.');
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + t } });
  if (res.status === 401) throw new AuthError('Session sesh hoye geche. Abar connect koro.');
  if (!res.ok) {
    let msg = 'Drive error ' + res.status;
    try {
      const j = await res.json();
      if (j.error?.message) msg = j.error.message;
    } catch (e) { /* json na */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res;
}

function withParams(path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

export async function getFolder(id) {
  try {
    const res = await request(withParams('/files/' + encodeURIComponent(id), {
      fields: 'id,name,mimeType',
      supportsAllDrives: 'true',
    }));
    return res.json();
  } catch (e) {
    if (e.status === 404) {
      throw new Error('Gaaner folder pawa jayni. Je Google account-e folder-ta ache, sei account diye login koro.');
    }
    throw e;
  }
}

export async function listChildren(folderId) {
  const out = [];
  let pageToken = '';
  do {
    const params = {
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime)',
      pageSize: '1000',
      orderBy: 'name',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    };
    if (pageToken) params.pageToken = pageToken;
    const j = await (await request(withParams('/files', params))).json();
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

export function mediaUrl(id) {
  return `${API}/files/${encodeURIComponent(id)}?alt=media`;
}

export async function fetchBlob(id, signal) {
  const res = await request(mediaUrl(id), { signal });
  return res.blob();
}

/** File-er ekta ongsho (start..end, duto-i inclusive). */
export async function fetchRange(id, start, end) {
  const res = await request(mediaUrl(id), { headers: { Range: `bytes=${start}-${end}` } });
  const buf = await res.arrayBuffer();
  // Server range na mene puro file dile, dorkari ongsho kete nei.
  if (res.status === 200 && buf.byteLength > end - start + 1) return buf.slice(start, end + 1);
  return buf;
}
