// Persistence. Tasks live in localStorage, which every window of the app shares.
// Reads never throw; a damaged store is kept aside as a backup before anything is overwritten.
import { normalize, cleanDeleted, SCHEMA_VERSION } from './logic.js';

export const KEY = 'slate-tasks:v1';
export const DELETED_KEY = 'slate-tasks:deleted';

function ls() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function load() {
  const s = ls();
  if (!s) return [];
  let raw = null;
  try {
    raw = s.getItem(KEY);
    if (raw == null) return [];
    const { tasks, ok } = normalize(JSON.parse(raw));
    if (ok) return tasks;
  } catch { /* fall through to backup */ }
  try { if (raw != null) s.setItem(`${KEY}:backup:${Date.now()}`, raw); } catch { /* nothing more to do */ }
  return [];
}

export function save(tasks) {
  const s = ls();
  if (!s) return false;
  try {
    s.setItem(KEY, JSON.stringify({ v: SCHEMA_VERSION, tasks }));
    return true;
  } catch {
    return false;
  }
}

// Delete markers (id -> time). They let a deletion travel to another machine through the synced folder.
export function loadDeleted() {
  const s = ls();
  try { return s ? cleanDeleted(JSON.parse(s.getItem(DELETED_KEY) || '{}')) : {}; } catch { return {}; }
}

export function saveDeleted(deleted) {
  const s = ls();
  if (!s) return false;
  try { s.setItem(DELETED_KEY, JSON.stringify(deleted)); return true; } catch { return false; }
}
