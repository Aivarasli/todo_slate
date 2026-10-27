// Task model and pure operations. Nothing here touches the DOM or storage,
// so it can be unit tested with `node --test`.
import { parseISO } from './dates.js';

export const SCHEMA_VERSION = 1;
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

export function createTask({ title, due = null, time = null }, now = Date.now()) {
  const t = cleanTitle(title);
  if (!t) return null;
  const hasDue = !!parseISO(due);
  return {
    id: newId(),
    title: t,
    done: false,
    doneAt: null,
    due: hasDue ? due : null,
    time: hasDue && TIME_RE.test(time || '') ? time : null,
    createdAt: now,
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
    tasks.push({
      id,
      title,
      done,
      doneAt: done ? (Number.isFinite(x.doneAt) ? x.doneAt : now) : null,
      due: hasDue ? x.due : null,
      time: hasDue && TIME_RE.test(x.time || '') ? x.time : null,
      createdAt: Number.isFinite(x.createdAt) ? x.createdAt : now,
    });
  }
  return { tasks, ok: true };
}

const mapTask = (tasks, id, fn) => tasks.map((t) => (t.id === id ? fn(t) : t));

export function toggleDone(tasks, id, now = Date.now()) {
  return mapTask(tasks, id, (t) => (t.done ? { ...t, done: false, doneAt: null } : { ...t, done: true, doneAt: now }));
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

export function removeTask(tasks, id) {
  return tasks.filter((t) => t.id !== id);
}

export function clearDone(tasks) {
  return tasks.filter((t) => !t.done);
}

// Move task `id` so it sits just before `beforeId` (or last when beforeId is null).
export function moveBefore(tasks, id, beforeId) {
  if (id === beforeId) return tasks;
  const from = tasks.findIndex((t) => t.id === id);
  if (from < 0) return tasks;
  const item = tasks[from];
  const rest = tasks.filter((t) => t.id !== id);
  let at = beforeId == null ? rest.length : rest.findIndex((t) => t.id === beforeId);
  if (at < 0) at = rest.length;
  const out = rest.slice(0, at).concat([item], rest.slice(at));
  return out.every((t, i) => t === tasks[i]) ? tasks : out;
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

export function groupTasks(tasks, filter, today) {
  if (filter === 'done') {
    const d = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    return d.length ? [{ key: 'done', title: GROUP_TITLES.done, tasks: d }] : [];
  }
  const keys = filter === 'today' ? ['overdue', 'today'] : ['overdue', 'today', 'later', 'nodate'];
  const out = [];
  for (const key of keys) {
    const items = tasks.filter((t) => groupOf(t, today) === key);
    if (items.length) out.push({ key, title: GROUP_TITLES[key], tasks: items });
  }
  return out;
}

export function counts(tasks, today) {
  const open = tasks.filter((t) => !t.done);
  return {
    today: open.filter((t) => t.due && t.due <= today).length,
    all: open.length,
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
