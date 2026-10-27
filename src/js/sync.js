// Keeps the task list in a folder you choose (Dropbox, iCloud Drive, a network share...).
// The folder holds slate-tasks.json and a pictures/ folder. This Mac keeps its own copy too, so the
// app works with the folder missing or offline, and catches up when it comes back.
//
// A sync pass reads the file, merges it with the list in memory (newest change per task wins),
// then writes the result back if it differs. It runs after every change here, when the file changes
// there (checked every two seconds), and when the window gets focus.
import { native } from './native.js';
import * as L from './logic.js';
import * as P from './pictures.js';

const POLL_MS = 2000;
const SLOW_EVERY = 5; // while the folder is unreachable, look every 10 s instead

export function createSync({ getStore, applyStore, onStatus }) {
  let current = null; // the folder in use; passes started for an older one give up
  let running = false;
  let again = false;
  let timer = null;
  let poll = null;
  let ticks = 0;
  let last = null; // the file's modified time and size as of our last read or write
  let failing = false;

  const status = (kind, message) => onStatus({ kind, message: message || '', at: Date.now(), dir: current });

  // `d` is the folder this pass belongs to. If the folder is changed or syncing is switched off
  // meanwhile, the pass stops before it touches anything else.
  async function pass(d) {
    const dir = d;
    const stale = () => dir !== current;
    const stat = await native.call('sync_stat', { dir });
    let remote = null;
    let merged = getStore();
    if (stat.exists) {
      const text = await native.call('sync_read', { dir });
      remote = L.parseStore(text);
      if (!remote) throw new Error('unreadable'); // never overwrite a file we cannot understand
      merged = L.mergeStores(merged, remote);
    }
    // Copies a sync service made when two machines saved at once ("conflicted copy"): fold them in.
    const folded = [];
    for (const name of await native.call('sync_extras', { dir })) {
      const extra = L.parseStore(await native.call('sync_read_extra', { dir, name }));
      if (!extra) continue; // leave anything we cannot read alone
      merged = L.mergeStores(merged, extra);
      folded.push(name);
    }
    // Edits made while we were reading the folder are kept: merge once more with the list as it is now.
    const cur = getStore();
    merged = L.mergeStores(cur, merged);
    const sameAsLocal = L.sameTasks(merged.tasks, cur.tasks) && L.sameDeleted(merged.deleted, cur.deleted);
    const sameAsRemote = !!remote && L.sameTasks(merged.tasks, remote.tasks) && L.sameDeleted(merged.deleted, remote.deleted);
    if (stale()) return;
    if (!sameAsLocal) applyStore(merged);
    if (!sameAsRemote || folded.length) {
      last = await native.call('sync_write', { dir, text: L.serializeStore(merged.tasks, merged.deleted) });
      for (const name of folded) await native.call('sync_remove_extra', { dir, name }).catch(() => {});
    } else {
      last = stat;
    }
    // Pictures that only exist here go up; ones only in the folder are fetched when first opened.
    if (!stale()) await P.uploadMissing([...L.imageIds(merged.tasks)]);
  }

  async function syncNow() {
    if (!current) return;
    if (running) { again = true; return; }
    running = true;
    const mine = current;
    status('busy');
    try {
      await pass(mine);
      if (mine !== current) return;
      failing = false;
      status('ok');
    } catch (e) {
      if (mine !== current) return;
      failing = true;
      const m = String((e && e.message) || e);
      status('error', /not found|invalid folder|not a folder/.test(m) ? 'folder not found' : m === 'unreadable' ? 'unreadable file' : m);
    } finally {
      running = false;
      if (again) { again = false; schedule(300); }
    }
  }

  function schedule(ms = 500) {
    if (!current) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, ms);
  }

  async function check() {
    if (!current || running) return;
    if (failing && ++ticks % SLOW_EVERY) return;
    try {
      const st = await native.call('sync_stat', { dir: current });
      if (failing || !last || st.exists !== last.exists || st.mtimeMs !== last.mtimeMs || st.len !== last.len) await syncNow();
    } catch (e) {
      if (!failing) syncNow(); // reports the problem
    }
  }

  return {
    // Starts (or restarts) syncing with a folder; null stops it.
    start(newDir) {
      current = newDir || null;
      last = null;
      failing = false;
      again = false;
      P.setFolder(current);
      clearInterval(poll);
      clearTimeout(timer);
      if (!current) { status('off'); return Promise.resolve(); }
      poll = setInterval(check, POLL_MS);
      return syncNow();
    },
    schedule,
    syncNow,
    get dir() { return current; },
  };
}
