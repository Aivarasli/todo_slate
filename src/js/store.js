// Persistence. Tasks live in localStorage, which every window of the app shares.
// Reads never throw; a damaged store is kept aside as a backup before anything is overwritten.
import { normalize, SCHEMA_VERSION } from './logic.js';

export const KEY = 'slate-tasks:v1';

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
