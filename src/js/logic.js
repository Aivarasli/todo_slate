// Task model and pure operations. Nothing here touches the DOM or storage,
// so it can be unit tested with `node --test`.
import { parseISO } from './dates.js';

export const SCHEMA_VERSION = 2; // 2 adds `ord` and `updatedAt` per task, which folder sync merges on
export const MAX_TITLE = 300;

export function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanTitle(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

// A task's picture: the full image lives in IndexedDB under `id`; the task keeps a small
// thumbnail (a data URL) so the avatar draws without any lookup.
export function cleanImg(x) {
  if (!x || typeof x !== 'object') return null;
  const { id, w, h: ht, bytes, thumb } = x;
  if (typeof id !== 'string' || !id || id.length > 80) return null;
  if (!Number.isFinite(w) || !Number.isFinite(ht) || w < 1 || ht < 1) return null;
  if (typeof thumb !== 'string' || thumb.length > 40000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(thumb)) return null;
  return { id, w: Math.round(w), h: Math.round(ht), bytes: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0, thumb };
}

export function createTask({ title, due = null, time = null, img = null }, now = Date.now()) {
  const t = cleanTitle(title);
  if (!t) return null;
  const hasDue = !!parseISO(due);
  const pic = cleanImg(img);
  return {
    ...(pic ? { img: pic } : {}),
    id: newId(),
    title: t,
    done: false,
    doneAt: null,
    due: hasDue ? due : null,
    time: hasDue && TIME_RE.test(time || '') ? time : null,
    createdAt: now,
    updatedAt: now,
    ord: 0, // appendTask gives the real position
  };
}

// Accepts whatever was stored and returns a clean task list.
// Bad entries are dropped, never thrown on. `ok` is false when the shape is unrecognisable.
export function normalize(raw, now = Date.now()) {
  const arr = Array.isArray(raw) ? raw : raw && Array.isArray(raw.tasks) ? raw.tasks : null;
  if (!arr) return { tasks: [], ok: false };
  const seen = new Set();
  const tasks = [];
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue;
    const title = cleanTitle(x.title);
    if (!title) continue;
    let id = typeof x.id === 'string' && x.id ? x.id : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    const done = x.done === true;
    const hasDue = !!parseISO(x.due);
    const pic = cleanImg(x.img);
    tasks.push({
      ...(pic ? { img: pic } : {}),
      id,
      title,
      done,
      doneAt: done ? (Number.isFinite(x.doneAt) ? x.doneAt : now) : null,
      due: hasDue ? x.due : null,
      time: hasDue && TIME_RE.test(x.time || '') ? x.time : null,
      createdAt: Number.isFinite(x.createdAt) ? x.createdAt : now,
      updatedAt: Number.isFinite(x.updatedAt) ? x.updatedAt : (Number.isFinite(x.createdAt) ? x.createdAt : now),
      ord: Number.isFinite(x.ord) ? x.ord : NaN,
    });
  }
  // Older lists have no positions: the stored order becomes the order. A list that does have them is sorted by them.
  if (tasks.some((t) => !Number.isFinite(t.ord))) tasks.forEach((t, i) => { t.ord = i * ORD_STEP; });
  else sortByOrd(tasks);
  return { tasks, ok: true };
}

export const ORD_STEP = 1000;
export function sortByOrd(tasks) {
  return tasks.sort((a, b) => (a.ord - b.ord) || (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Adds a new task at the end of the list.
export function appendTask(tasks, task) {
  const last = tasks.reduce((m, t) => Math.max(m, t.ord), -ORD_STEP);
  return tasks.concat([{ ...task, ord: last + ORD_STEP }]);
}

// Every change stamps the task with a time that is always later than its last one, so the newest edit wins when lists merge.
const stamp = (t, now) => Math.max(now, (t.updatedAt || 0) + 1);
const mapTask = (tasks, id, fn, now = Date.now()) => tasks.map((t) => (t.id === id ? { ...fn(t), updatedAt: stamp(t, now) } : t));

export function toggleDone(tasks, id, now = Date.now()) {
  return mapTask(tasks, id, (t) => (t.done ? { ...t, done: false, doneAt: null } : { ...t, done: true, doneAt: now }), now);
}

export function renameTask(tasks, id, title) {
  const clean = cleanTitle(title);
  if (!clean) return tasks;
  return mapTask(tasks, id, (t) => ({ ...t, title: clean }));
}

export function setDue(tasks, id, due, time = null) {
  const ok = !!parseISO(due);
  return mapTask(tasks, id, (t) => ({ ...t, due: ok ? due : null, time: ok && TIME_RE.test(time || '') ? time : null }));
}

// Attach a picture (img = {id,w,h,bytes,thumb}) or remove it (img = null).
export function setImage(tasks, id, img) {
  const pic = cleanImg(img);
  return mapTask(tasks, id, (t) => {
    const { img: _old, ...rest } = t;
    return pic ? { ...rest, img: pic } : rest;
  });
}

// Ids of every picture still in use, for cleaning up the stored files.
export function imageIds(tasks) {
  return new Set(tasks.filter((t) => t.img).map((t) => t.img.id));
}

export function removeTask(tasks, id) {
  return tasks.filter((t) => t.id !== id);
}

export function clearDone(tasks) {
  return tasks.filter((t) => !t.done);
}

// Move task `id` so it sits just before `beforeId` (or last when beforeId is null).
export function moveBefore(tasks, id, beforeId, now = Date.now()) {
  if (id === beforeId) return tasks;
  const from = tasks.findIndex((t) => t.id === id);
  if (from < 0) return tasks;
  const item = tasks[from];
  const rest = tasks.filter((t) => t.id !== id);
  let at = beforeId == null ? rest.length : rest.findIndex((t) => t.id === beforeId);
  if (at < 0) at = rest.length;
  if (rest.slice(0, at).concat([item], rest.slice(at)).every((t, i) => t === tasks[i])) return tasks;
  // The task takes a position between its new neighbours, so only it changes (and only it needs to sync).
  const prev = rest[at - 1], next = rest[at];
  let ord = prev && next ? (prev.ord + next.ord) / 2 : prev ? prev.ord + ORD_STEP : next ? next.ord - ORD_STEP : 0;
  const moved = { ...item, ord, updatedAt: stamp(item, now) };
  const out = rest.slice(0, at).concat([moved], rest.slice(at));
  // Positions can run out of room after very many moves into the same gap: renumber then.
  if (prev && next && !(ord > prev.ord && ord < next.ord)) {
    return out.map((t, i) => (t.ord === i * ORD_STEP ? t : { ...t, ord: i * ORD_STEP, updatedAt: stamp(t, now) }));
  }
  return out;
}

// ---------- merging two copies of the list (folder sync) ----------
// A store is { tasks, deleted } where `deleted` maps a task id to the time it was deleted.
export const TOMBSTONE_DAYS = 45;

export function cleanDeleted(raw, now = Date.now()) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, at] of Object.entries(raw)) {
    if (typeof id === 'string' && id && id.length <= 80 && Number.isFinite(at) && at > now - TOMBSTONE_DAYS * 864e5) out[id] = at;
  }
  return out;
}

// Per task, the newest change wins; a task deleted after its last change stays deleted.
// Merging is symmetric in what it keeps, so both machines end up with the same list.
export function mergeStores(a, b, now = Date.now()) {
  const deleted = cleanDeleted(a.deleted, now);
  for (const [id, at] of Object.entries(cleanDeleted(b.deleted, now))) deleted[id] = Math.max(deleted[id] || 0, at);
  const byId = new Map();
  for (const t of [...a.tasks, ...b.tasks]) {
    const cur = byId.get(t.id);
    if (!cur || t.updatedAt > cur.updatedAt) byId.set(t.id, t);
  }
  const tasks = [];
  for (const t of byId.values()) {
    if (deleted[t.id] !== undefined && deleted[t.id] >= t.updatedAt) continue;
    delete deleted[t.id]; // a later edit (or an undo) outranks the old delete
    tasks.push(t);
  }
  return { tasks: sortByOrd(tasks), deleted };
}

// Same tasks, same values, same order?
export function sameTasks(a, b) {
  if (a.length !== b.length) return false;
  return a.every((t, i) => t === b[i] || JSON.stringify(t) === JSON.stringify(b[i]));
}

// What a commit changed: ids that disappeared become deleted markers, ids that are back lose theirs.
export function trackDeleted(deleted, prevTasks, nextTasks, now = Date.now()) {
  const keep = new Set(nextTasks.map((t) => t.id));
  const out = { ...deleted };
  let changed = false;
  for (const t of prevTasks) if (!keep.has(t.id)) { out[t.id] = now; changed = true; }
  for (const t of nextTasks) if (out[t.id] !== undefined && out[t.id] < t.updatedAt) { delete out[t.id]; changed = true; }
  return changed ? out : deleted;
}

// Tasks brought back by Undo get a fresh time, so they beat the delete marker on every machine.
export function revive(prevTasks, currentTasks, now = Date.now()) {
  const have = new Set(currentTasks.map((t) => t.id));
  return prevTasks.map((t) => (have.has(t.id) ? t : { ...t, updatedAt: stamp(t, now) }));
}

export const GROUP_TITLES = { overdue: 'Overdue', today: 'Today', later: 'Later', nodate: 'No date', done: 'Done' };

// Which group a task belongs to. A task due today stays in Today even once done,
// so finishing it strikes it through instead of making it vanish.
export function groupOf(t, today) {
  if (t.due === today) return 'today';
  if (t.done) return 'done';
  if (!t.due) return 'nodate';
  return t.due < today ? 'overdue' : 'later';
}

export const FILTERS = ['today', 'open', 'all', 'done'];

// today: what is due now or late. open: everything still to do. all: everything. done: finished work.
export function groupTasks(tasks, filter, today) {
  if (filter === 'done') {
    const d = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    return d.length ? [{ key: 'done', title: GROUP_TITLES.done, tasks: d }] : [];
  }
  const keys = filter === 'today' ? ['overdue', 'today'] : filter === 'open' ? ['overdue', 'today', 'later', 'nodate'] : ['overdue', 'today', 'later', 'nodate', 'done'];
  const pool = filter === 'open' ? tasks.filter((t) => !t.done) : tasks;
  const out = [];
  for (const key of keys) {
    let items = pool.filter((t) => groupOf(t, today) === key);
    if (key === 'done') items = items.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    if (items.length) out.push({ key, title: GROUP_TITLES[key], tasks: items });
  }
  return out;
}

export function counts(tasks, today) {
  const open = tasks.filter((t) => !t.done);
  return {
    today: open.filter((t) => t.due && t.due <= today).length,
    open: open.length,
    all: tasks.length,
    done: tasks.length - open.length,
  };
}

// The task the collapsed strip shows: first open task that is overdue or due today,
// otherwise the first open task of any kind.
export function nextUp(tasks, today) {
  const groups = groupTasks(tasks, 'today', today);
  for (const g of groups) {
    const t = g.tasks.find((x) => !x.done);
    if (t) return t;
  }
  return tasks.find((t) => !t.done) || null;
}

// ---------- links ----------
// Splits a title into plain and link parts: [{ text }, { text, href }].
// Recognises http(s) links, www. and bare domains with a common ending, and email addresses.
const TLDS = 'com|org|net|io|dev|app|co|lt|eu|uk|de|fr|nl|se|fi|pl|lv|ee|ca|au|ai|xyz|info|biz|design|studio|site|page|link|ly|tv|ch|cz|dk|ie|be|gr|ro|hu|bg';
const LINK_RE = new RegExp(
  String.raw`https?:\/\/[^\s<>"'\x60]+` +
  String.raw`|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}` +
  String.raw`|(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+(?:${TLDS})(?![A-Za-z0-9-])(?::\d{1,5})?(?:[\/?#][^\s<>"'\x60]*)?`,
  'gi',
);

// Sentence punctuation after a link is not part of it, and a closing bracket only is when it has an opener.
function trimLink(s) {
  for (;;) {
    const last = s[s.length - 1];
    if (last && '.,;:!?\'"'.includes(last)) { s = s.slice(0, -1); continue; }
    const pair = { ')': '(', ']': '[', '}': '{' }[last];
    if (pair && s.split(last).length > s.split(pair).length) { s = s.slice(0, -1); continue; }
    return s;
  }
}

// The address to open for a link's text, or null when it is not something safe to open.
export function hrefFor(text) {
  let href = text;
  if (/^https?:\/\//i.test(text)) href = text;
  else if (/^[^\s@\/]+@[^\s@\/]+$/.test(text)) href = 'mailto:' + text;
  else href = 'https://' + text;
  try {
    const u = new URL(href);
    if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return null;
    if (u.protocol !== 'mailto:' && !u.hostname.includes('.')) return null;
    return href.length <= 2048 ? href : null;
  } catch {
    return null;
  }
}

export function tokenize(title) {
  const s = String(title == null ? '' : title);
  const out = [];
  let at = 0;
  const push = (text, href) => { if (text) out.push(href ? { text, href } : { text }); };
  for (const m of s.matchAll(LINK_RE)) {
    const raw = m[0];
    const start = m.index;
    const isUrl = /^https?:\/\//i.test(raw);
    const isMail = !isUrl && raw.includes('@');
    // A bare domain glued to a word ("foo_bar.com", "path/x.com") is not a link.
    if (!isUrl && !isMail && start > 0 && /[\w@./-]/.test(s[start - 1])) continue;
    const text = trimLink(raw);
    const href = text ? hrefFor(text) : null;
    if (!href) continue;
    push(s.slice(at, start));
    push(text, href);
    at = start + text.length;
  }
  push(s.slice(at));
  return out.length ? out : [{ text: s }];
}

export function firstLink(title) {
  const t = tokenize(title).find((x) => x.href);
  return t ? t.href : null;
}

// ---------- the synced file ----------
const sameDeleted = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};
export { sameDeleted };

// One task per line, so a text diff (or a Dropbox history) stays readable.
export function serializeStore(tasks, deleted, now = Date.now()) {
  const head = `{"app":"slate-tasks","v":${SCHEMA_VERSION},"savedAt":${now},`;
  const body = tasks.map((t) => '  ' + JSON.stringify(t)).join(',\n');
  return `${head}\n"tasks":[${tasks.length ? '\n' + body + '\n' : ''}],\n"deleted":${JSON.stringify(deleted)}}\n`;
}

// Returns { tasks, deleted } or null when the text is not a task file.
export function parseStore(text, now = Date.now()) {
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.tasks)) return null;
  const { tasks, ok } = normalize(raw, now);
  if (!ok) return null;
  return { tasks, deleted: cleanDeleted(raw.deleted, now) };
}
