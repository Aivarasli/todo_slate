// Pictures attached to tasks. A dropped image is resized to fit 1280x720 (720x1280 when it is
// portrait), never enlarged, saved as JPEG in IndexedDB, and a 96px square thumbnail is kept on
// the task for the avatar. Everything here stays on this Mac.
import { native } from './native.js';

export const MAX_W = 1280;
export const MAX_H = 720;
export const MAX_PIXELS = 100e6;
export const MAX_INPUT = 40 * 1024 * 1024; // refuse files larger than this before decoding
const QUALITY = 0.8;
const THUMB = 96;

// Size after fitting into 1280x720 (landscape and square) or 720x1280 (portrait). Never upscales.
export function fitSize(w, h) {
  if (!(w > 0) || !(h > 0)) return { w: 1, h: 1 };
  const [bw, bh] = w >= h ? [MAX_W, MAX_H] : [MAX_H, MAX_W];
  const k = Math.min(1, bw / w, bh / h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|avif)$/i;
export function isImage(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type) return type.startsWith('image/') && !type.includes('svg');
  return IMAGE_EXT.test(String(file.name || ''));
}

// "Fenn moodboard_v3.final.png" -> "Fenn moodboard v3.final"
export function titleFromName(name) {
  return String(name || '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function formatBytes(n) {
  if (!(n > 0)) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// ---------- decoding and resizing (browser only) ----------
function readDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('read'));
    r.readAsDataURL(blob);
  });
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => { try { bmp.close(); } catch { /* ignore */ } } };
    } catch { /* fall back to an <img> */ }
  }
  const url = await readDataURL(file); // a data URL, because the page's CSP does not allow blob: images
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('decode')); img.src = url; });
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, done() {} };
}

const toBlob = (canvas, type, q) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), type, q));

function paperColour() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
    return v || '#ececE9';
  } catch { return '#ececE9'; }
}

// Returns { blob, thumb, w, h, bytes }. Throws Error('large') or Error('decode') on bad input.
export async function prepare(file) {
  if (file.size > MAX_INPUT) throw new Error('large');
  let pic;
  try { pic = await decode(file); } catch { throw new Error('decode'); }
  try {
    if (!(pic.w > 0 && pic.h > 0)) throw new Error('decode');
    if (pic.w * pic.h > MAX_PIXELS) throw new Error('large'); // a decoded 100-megapixel picture needs hundreds of MB
    const { w, h } = fitSize(pic.w, pic.h);
    const bg = paperColour();
    const full = document.createElement('canvas');
    full.width = w; full.height = h;
    const c = full.getContext('2d');
    c.fillStyle = bg; c.fillRect(0, 0, w, h); // transparent areas land on the paper colour, not black
    c.imageSmoothingQuality = 'high';
    c.drawImage(pic.src, 0, 0, w, h);
    const blob = await toBlob(full, 'image/jpeg', QUALITY);

    const th = document.createElement('canvas');
    th.width = THUMB; th.height = THUMB;
    const t = th.getContext('2d');
    t.fillStyle = bg; t.fillRect(0, 0, THUMB, THUMB);
    t.imageSmoothingQuality = 'high';
    const side = Math.min(pic.w, pic.h); // centred square crop
    t.drawImage(pic.src, (pic.w - side) / 2, (pic.h - side) / 2, side, side, 0, 0, THUMB, THUMB);
    return { blob, thumb: th.toDataURL('image/jpeg', QUALITY), w, h, bytes: blob.size };
  } finally { pic.done(); }
}

// ---------- storage (IndexedDB) ----------
const DB_NAME = 'slate-tasks-pictures';
const STORE = 'blobs';
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no storage')); return; }
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    let out;
    try { out = fn(tx.objectStore(STORE)); } catch (e) { reject(e); return; }
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

const idbPut = (id, blob) => run('readwrite', (s) => s.put(blob, id));
export const remove = (id) => run('readwrite', (s) => s.delete(id));
export const keys = () => run('readonly', (s) => s.getAllKeys());
export const getBlob = (id) => run('readonly', (s) => s.get(id));

// ---------- the synced folder (optional) ----------
// With a folder set, every picture is also kept there as pictures/<id>.jpg, and a picture another
// machine added is fetched from it on first use and cached here.
let folder = null;
export const setFolder = (dir) => { folder = dir || null; };
export const hasFolder = () => !!folder;

const b64Of = async (blob) => (await readDataURL(blob)).split(',')[1] || '';
function blobFromB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

export async function put(id, blob) {
  await idbPut(id, blob);
  if (folder) { try { await native.call('pic_write', { dir: folder, id, data: await b64Of(blob) }); } catch { /* the sync pass uploads it later */ } }
}

export const folderList = () => native.call('pic_list', { dir: folder }); // [[id, modifiedMs], ...]
export const folderRemove = (id) => native.call('pic_remove', { dir: folder, id });

// Uploads pictures that exist only on this Mac. Returns how many went up.
export async function uploadMissing(ids) {
  if (!folder || !ids.length) return 0;
  const have = new Set((await folderList()).map(([id]) => id));
  let n = 0;
  for (const id of ids) {
    if (have.has(id)) continue;
    const blob = await getBlob(id).catch(() => null);
    if (!blob) continue;
    await native.call('pic_write', { dir: folder, id, data: await b64Of(blob) });
    n++;
  }
  return n;
}

// Brings pictures that exist only in the folder onto this Mac (used when leaving folder storage).
export async function pullMissing(ids, dir = folder) {
  if (!dir) return 0;
  const local = new Set(await keys().catch(() => []));
  let n = 0;
  for (const id of ids) {
    if (local.has(id)) continue;
    const b64 = await native.call('pic_read', { dir, id }).catch(() => null);
    if (b64) { await idbPut(id, blobFromB64(b64)); n++; }
  }
  return n;
}

// The stored picture as a data URL, or null when it is missing.
export async function dataURL(id) {
  try {
    const blob = await getBlob(id);
    if (blob) return await readDataURL(blob);
  } catch { /* fall through to the folder */ }
  if (!folder) return null;
  try {
    const b64 = await native.call('pic_read', { dir: folder, id });
    if (!b64) return null;
    idbPut(id, blobFromB64(b64)).catch(() => {}); // keep a copy on this Mac
    return `data:image/jpeg;base64,${b64}`;
  } catch { return null; }
}
