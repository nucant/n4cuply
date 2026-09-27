// Google Drive API (v3).
import { accessToken } from './auth.js';

export const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,mimeType,size,md5Checksum,modifiedTime,parents';

export class AuthError extends Error {}

async function request(url, init = {}, account) {
  const t = accessToken(account);
  if (!t) throw new AuthError('Please sign in again.');
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + t } });
  if (res.status === 401) throw new AuthError('Your session expired. Connect again.');
  if (!res.ok) {
    let msg = 'Drive error ' + res.status;
    try {
      const j = await res.json();
      if (j.error?.message) msg = j.error.message;
    } catch (e) { /* not JSON */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res;
}

function withParams(path, params, base = API) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

export async function getFolder(id, account) {
  try {
    const res = await request(withParams('/files/' + encodeURIComponent(id), {
      fields: 'id,name,mimeType',
      supportsAllDrives: 'true',
    }), {}, account);
    return res.json();
  } catch (e) {
    if (e.status === 404) {
      throw new Error(`Folder not found${account ? ' in ' + account : ''}. Sign in with the Google account that owns it, or pick another folder in Settings.`);
    }
    throw e;
  }
}

export async function listChildren(folderId, account) {
  const out = [];
  let pageToken = '';
  do {
    const params = {
      q: `'${folderId}' in parents and trashed = false`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: '1000',
      orderBy: 'name',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    };
    if (pageToken) params.pageToken = pageToken;
    const j = await (await request(withParams('/files', params), {}, account)).json();
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

export function mediaUrl(id) {
  return `${API}/files/${encodeURIComponent(id)}?alt=media`;
}

export async function fetchBlob(id, account, signal) {
  const res = await request(mediaUrl(id), { signal }, account);
  return res.blob();
}

/** Part of a file (start..end, both inclusive). */
export async function fetchRange(id, start, end, account) {
  const res = await request(mediaUrl(id), { headers: { Range: `bytes=${start}-${end}` } }, account);
  const buf = await res.arrayBuffer();
  // If the server ignored the range and sent the whole file, cut out what we asked for.
  if (res.status === 200 && buf.byteLength > end - start + 1) return buf.slice(start, end + 1);
  return buf;
}

export async function createFolder(name, parentId, account) {
  const res = await request(withParams('/files', { fields: FILE_FIELDS, supportsAllDrives: 'true' }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  }, account);
  return res.json();
}

/**
 * Uploads one file with a resumable session so large FLACs work and we get
 * progress. onProgress(0..1). Resolves with the new file's metadata.
 */
export async function uploadFile(file, parentId, account, onProgress, signal) {
  const init = await request(withParams('/files', { uploadType: 'resumable', fields: FILE_FIELDS, supportsAllDrives: 'true' }, UPLOAD_API), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(file.size),
    },
    body: JSON.stringify({ name: file.name, parents: [parentId] }),
  }, account);
  const session = init.headers.get('Location');
  if (!session) throw new Error("Drive didn't start the upload. Try again.");
  return putToSession(session, file, onProgress, signal);
}

/** Replaces a file's content (resumable, with progress). Drive keeps the old version in its history. */
export async function updateFileResumable(id, blob, account, onProgress) {
  const init = await request(withParams('/files/' + encodeURIComponent(id), { uploadType: 'resumable', fields: FILE_FIELDS, supportsAllDrives: 'true' }, UPLOAD_API), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': blob.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(blob.size),
    },
    body: '{}',
  }, account);
  const session = init.headers.get('Location');
  if (!session) throw new Error("Drive didn't start the upload. Try again.");
  return putToSession(session, blob, onProgress);
}

function putToSession(session, file, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', session);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve({}); }
      } else if (xhr.status === 401) {
        reject(new AuthError('Your session expired. Connect again.'));
      } else {
        reject(new Error(`Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** Replaces the content of an existing file (small files, e.g. JSON). */
export async function updateFileContent(id, blob, account) {
  const res = await request(withParams('/files/' + encodeURIComponent(id), { uploadType: 'media', fields: FILE_FIELDS, supportsAllDrives: 'true' }, UPLOAD_API), {
    method: 'PATCH',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  }, account);
  return res.json();
}
