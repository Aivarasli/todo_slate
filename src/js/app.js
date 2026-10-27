// The main window: list, settings, about and the collapsed strip.
import { h, clear, checkIcon, chevron, crossIcon } from './dom.js';
import * as D from './dates.js';
import * as L from './logic.js';
import * as store from './store.js';
import * as S from './settings.js';
import { native } from './native.js';
import { createCalendar } from './calendar.js';
import { wireReorder, isReordering } from './reorder.js';

const COLLAPSED = { w: 420, h: 56 };
const DEFAULT_SIZE = { w: 360, h: 560 };
const IDLE_MS = 10000;
const UNDO_MS = 8000;
const EASE = 'cubic-bezier(.2,.7,.2,1)';
const AUTHOR = 'Aivaras Ligeika';
const COPYRIGHT = `© 2026 ${AUTHOR}`;
const REPO = 'https://github.com/Aivarasli/todo_slate';

const motionOK = () => !(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);

const state = {
  tasks: store.load(),
  settings: S.load(), // includes the list tab last used (settings.filter)
  mode: 'main', // main | settings | about | collapsed
  today: D.toISO(new Date()),
  editingId: null,
  dateId: null, // the task whose date bar is open
  calOpen: false, // the calendar inside that bar
  fresh: null, // 'bar' | 'cal': animate the bar or calendar in on the next render
  focusId: null,
  focusFallback: null, // row index to focus when the ticked row has left the list
  focusSel: null,
  popId: null, // the task just ticked or unticked, for its animation
  leaving: new Set(), // rows playing their exit animation
  undo: null, // { tasks } snapshot to restore
  message: null, // text shown in the footer
  saveError: false,
  clickThrough: false, // never persisted
  autostart: false,
  version: null,
  expandedSize: null,
  autoCollapsed: false,
};
let undoTimer = null;
let idleTimer = null;
let skipFlip = true; // the next list render should not animate rows (first paint, tab switch)
let pendingLeaves = 0;

// ---------- shell (built once) ----------
const els = {
  main: h('div', { class: 'view' }),
  settings: h('div', { class: 'view' }),
  about: h('div', { class: 'view' }),
  strip: h('div', { class: 'view' }),
  titlebar: h('div', { class: 'titlebar', 'data-tauri-drag-region': true }),
  head: h('div', { class: 'head' }),
  tabs: h('div', { class: 'tabs', role: 'group', 'aria-label': 'Filter' }),
  scroll: h('div', { class: 'scroll' }),
  foot: h('div', { class: 'foot' }),
  sTitlebar: h('div', { class: 'titlebar', 'data-tauri-drag-region': true }),
  sScroll: h('div', { class: 'scroll', style: 'padding-top:16px' }),
  aTitlebar: h('div', { class: 'titlebar', 'data-tauri-drag-region': true }),
  aScroll: h('div', { class: 'scroll', style: 'padding-top:8px' }),
};

els.input = h('input', {
  class: 'input', type: 'text', placeholder: 'Add a task', 'aria-label': 'New task', maxlength: String(L.MAX_TITLE), autocomplete: 'off', spellcheck: 'false',
  onKeydown: (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
    else if (e.key === 'Escape') els.input.blur();
  },
});
els.add = h('div', { class: 'add' }, els.input, h('button', { class: 'btn solid', type: 'button', onClick: addFromInput }, 'Add'));

els.main.append(els.titlebar, els.head, els.add, els.tabs, els.scroll, els.foot);
els.settings.append(els.sTitlebar, els.sScroll);
els.about.append(els.aTitlebar, els.aScroll);
els.sheet = h('div', { class: 'sheet', hidden: true });
els.win = h('div', { class: 'win' }, els.main, els.settings, els.about, els.strip, els.sheet);
document.getElementById('root').append(els.win);

const filter = () => state.settings.filter;
const rowFor = (id) => (state.mode === 'main' ? els.scroll.querySelector(`.row[data-id="${CSS.escape(id)}"]`) : null);

// ---------- state changes ----------
// Saves and shows the new list. `render: false` saves now and leaves drawing to the caller,
// which is how a row gets to play its exit animation before it disappears.
function commit(tasks, opts = {}) {
  state.tasks = tasks;
  if (opts.focusId !== undefined) state.focusId = opts.focusId;
  const ok = store.save(tasks);
  state.saveError = !ok;
  if (ok) native.emit('tasks-changed', { from: 'main' });
  if (opts.render === false) return;
  render();
}

function setUndo(prevTasks, text) {
  state.undo = { tasks: prevTasks };
  state.message = text;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { state.undo = null; state.message = null; if (state.mode === 'main') renderFoot(); }, UNDO_MS);
}

function undo() {
  if (!state.undo) return;
  const prev = state.undo.tasks;
  state.undo = null;
  state.message = null;
  clearTimeout(undoTimer);
  commit(prev);
}

// A row collapses away, then the list is drawn again without it. Several rows can leave at once;
// the list is only redrawn when the last one is gone.
function leaveRow(row, delay, duration) {
  const id = row.dataset.id;
  pendingLeaves++;
  state.leaving.add(id);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    state.leaving.delete(id);
    if (--pendingLeaves <= 0) { pendingLeaves = 0; render(); }
  };
  setTimeout(() => {
    row.classList.add('leaving');
    const hgt = row.getBoundingClientRect().height;
    const a = row.animate([
      { height: `${hgt}px`, minHeight: `${hgt}px`, opacity: 1 },
      { height: '0px', minHeight: '0px', paddingTop: '0px', paddingBottom: '0px', borderBottomWidth: '0px', opacity: 0 },
    ], { duration, easing: EASE, fill: 'forwards' });
    a.onfinish = end;
    a.oncancel = end;
  }, delay);
  setTimeout(end, delay + duration + 120); // safety net if the animation never reports back
}

// Shows a row as ticked (or unticked) without redrawing it, so its animation can play where it stands.
function markDone(row, done) {
  row.classList.toggle('done', done);
  row.classList.add('pop');
  const chk = row.querySelector('.check');
  if (chk) { chk.classList.toggle('on', done); chk.classList.add('pop'); chk.setAttribute('aria-pressed', String(done)); }
}

function toggle(id, byKeyboard) {
  if (state.leaving.has(id)) return;
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const next = L.toggleDone(state.tasks, id);
  const nt = next.find((x) => x.id === id);
  const row = rowFor(id);
  state.focusFallback = byKeyboard ? [...els.scroll.querySelectorAll('.row')].findIndex((r) => r.dataset.id === id) : null;

  const visibleAfter = L.groupTasks(next, filter(), state.today).some((g) => g.tasks.some((x) => x.id === id));
  const moves = L.groupOf(t, state.today) !== L.groupOf(nt, state.today);
  if (row && motionOK() && (!visibleAfter || moves)) {
    // It is about to leave this view: tick it where it stands, let that play, then slide it out.
    commit(next, { focusId: id, render: false });
    markDone(row, nt.done);
    renderTitlebar(); renderTabs();
    leaveRow(row, 620, 260);
    return;
  }
  state.popId = id;
  commit(next, { focusId: id });
}

function remove(id, siblings) {
  const prev = state.tasks;
  const i = siblings ? siblings.findIndex((t) => t.id === id) : -1;
  const neighbour = siblings ? (siblings[i + 1] || siblings[i - 1]) : null;
  const row = rowFor(id);
  setUndo(prev, 'Task deleted.');
  const next = L.removeTask(prev, id);
  const focusId = neighbour ? neighbour.id : null;
  if (row && motionOK() && !state.leaving.has(id)) {
    commit(next, { focusId, render: false });
    renderTitlebar(); renderTabs(); renderFoot();
    leaveRow(row, 0, 240);
    return;
  }
  commit(next, { focusId });
}

function clearDone() {
  const prev = state.tasks;
  if (!prev.some((t) => t.done)) return;
  setUndo(prev, 'Done tasks cleared.');
  commit(L.clearDone(prev));
}

function addFromInput() {
  const task = L.createTask({ title: els.input.value, due: state.today });
  if (!task) { if (!els.input.value.trim()) els.input.value = ''; return; }
  els.input.value = '';
  if (filter() === 'done') setFilter('today', true);
  commit(state.tasks.concat([task]));
}

function startEdit(id) {
  state.editingId = id;
  state.dateId = null;
  state.calOpen = false;
  state.focusId = null;
  render();
  const input = els.scroll.querySelector('.row .edit');
  if (input) { input.focus(); input.select(); }
}

function finishEdit(id, value, save) {
  if (state.editingId !== id) return;
  state.editingId = null;
  const t = state.tasks.find((x) => x.id === id);
  const next = L.renameTask(state.tasks, id, value);
  if (save && t && next !== state.tasks && next.find((x) => x.id === id).title !== t.title) commit(next, { focusId: id });
  else { state.focusId = id; render(); }
}

function applyDue(id, due) {
  state.dateId = null;
  state.calOpen = false;
  commit(L.setDue(state.tasks, id, due), { focusId: id });
}

function openBar(id, cal) {
  state.fresh = cal ? 'cal' : (state.dateId === id ? null : 'bar');
  state.editingId = null;
  state.dateId = id;
  state.calOpen = !!cal;
  state.focusSel = cal ? '.cal .day[tabindex="0"]' : null;
  render();
}

function closeBar(id) {
  state.dateId = null;
  state.calOpen = false;
  if (id) state.focusId = id;
  render();
}

function reorder(id, beforeId) {
  const next = L.moveBefore(state.tasks, id, beforeId);
  if (next !== state.tasks) commit(next, { focusId: id });
  else render(); // nothing moved: redraw so a dragged row settles back into place
}

// The task that follows `t` in the stored order, ignoring `skipId`.
function successorId(t, skipId) {
  if (!t) return null;
  const i = state.tasks.findIndex((x) => x.id === t.id);
  let nx = state.tasks[i + 1];
  if (nx && nx.id === skipId) nx = state.tasks[i + 2];
  return nx ? nx.id : null;
}

function setFilter(key, quiet) {
  if (!L.FILTERS.includes(key) || filter() === key) return;
  state.settings = S.clean({ ...state.settings, filter: key });
  S.save(state.settings);
  state.dateId = null;
  state.calOpen = false;
  skipFlip = true;
  if (!quiet) render();
}

// ---------- rendering ----------
function render() {
  state.today = D.toISO(new Date());
  document.body.classList.toggle('clickthrough', state.clickThrough);
  els.main.hidden = state.mode !== 'main';
  els.settings.hidden = state.mode !== 'settings';
  els.about.hidden = state.mode !== 'about';
  els.strip.hidden = state.mode !== 'collapsed';
  if (state.mode === 'main') { renderTitlebar(); renderHead(); renderTabs(); renderList(); renderFoot(); }
  else if (state.mode === 'settings') renderSettings();
  else if (state.mode === 'about') renderAbout();
  else renderStrip();
  renderSheet();
  applyFocus();
  state.popId = null;
  state.fresh = null;
}

function applyFocus() {
  if (state.focusSel) {
    const el = els.win.querySelector(state.focusSel);
    if (el) el.focus();
    state.focusSel = null;
  } else if (state.focusId || state.focusFallback != null) {
    let el = state.focusId ? els.scroll.querySelector(`.row[data-id="${CSS.escape(state.focusId)}"]`) : null;
    if (!el && state.focusFallback != null) {
      const rows = [...els.scroll.querySelectorAll('.row')];
      el = rows[Math.min(state.focusFallback, rows.length - 1)];
    }
    if (el) el.focus();
  }
  state.focusId = null;
  state.focusFallback = null;
}

function gap() { return h('div', { class: 'lights-gap', 'data-tauri-drag-region': true }); }

function renderTitlebar() {
  const open = L.counts(state.tasks, state.today).open;
  clear(els.titlebar).append(
    gap(),
    h('span', { class: 'label center', 'data-tauri-drag-region': true },
      state.clickThrough ? h('span', { class: 'pill on' }, 'Click-through') : `${open} open`),
    h('button', { class: 'btn', type: 'button', 'aria-pressed': String(state.settings.onTop), onClick: () => saveSettings({ onTop: !state.settings.onTop }) },
      h('span', { class: 'dot' + (state.settings.onTop ? ' on' : '') }), 'On top'),
  );
}

const HEAD_TITLES = { today: 'Today', open: 'Open', all: 'All tasks', done: 'Done' };
const EMPTY_TEXT = { today: 'Nothing due today', open: 'Nothing left to do', all: 'No tasks yet', done: 'Nothing done yet' };

function renderHead() {
  const now = new Date();
  clear(els.head).append(
    h('h1', null, HEAD_TITLES[filter()]),
    h('div', { class: 'dateline' },
      h('span', { class: 'label' }, D.datelineEN(now)),
      h('span', { class: 'small dim' }, D.datelineLT(now))),
  );
}

function renderTabs() {
  const c = L.counts(state.tasks, state.today);
  const tab = (key, label, n) => h('button', {
    class: 'btn', type: 'button', 'aria-pressed': String(filter() === key),
    onClick: () => setFilter(key),
  }, `${label} ${n}`);
  clear(els.tabs).append(tab('today', 'Today', c.today), tab('open', 'Open', c.open), tab('all', 'All', c.all), tab('done', 'Done', c.done));
}

// Rows glide to their new place instead of jumping: measure before the redraw, play after (FLIP).
function snapshot() {
  const m = new Map();
  for (const el of els.scroll.querySelectorAll('[data-flip]')) {
    m.set(el.dataset.flip, { top: el.getBoundingClientRect().top, group: el.dataset.group || '' });
  }
  return m;
}

function playFlip(prev) {
  if (!prev || !motionOK()) return;
  const moved = [];
  const entering = [];
  for (const el of els.scroll.querySelectorAll('[data-flip]')) {
    const key = el.dataset.flip;
    const isRow = key[0] === 'r';
    const old = prev.get(key);
    if (!old) { if (isRow) entering.push(el); continue; }
    if (isRow && old.group !== el.dataset.group) { entering.push(el); continue; } // changed tile: fade in rather than slide across
    const dy = old.top - el.getBoundingClientRect().top;
    if (Math.abs(dy) >= 1) moved.push([el, dy, isRow]);
  }
  for (const [el, dy, isRow] of moved) {
    const a = el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: Math.round(Math.min(440, 220 + Math.abs(dy) * 0.5)), easing: EASE });
    if (isRow) {
      el.classList.add('moving');
      const clean = () => el.classList.remove('moving');
      a.onfinish = clean;
      a.oncancel = clean;
    }
  }
  for (const el of entering) {
    el.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 260, easing: EASE });
  }
}

function renderList() {
  const prev = skipFlip ? null : snapshot();
  skipFlip = false;
  const groups = L.groupTasks(state.tasks, filter(), state.today);
  clear(els.scroll);
  if (!groups.length) {
    els.scroll.append(h('p', { class: 'label empty' }, EMPTY_TEXT[filter()]));
    return;
  }
  for (const g of groups) {
    const n = g.key === 'done' ? g.tasks.length : g.tasks.filter((t) => !t.done).length;
    els.scroll.append(h('section', { class: 'group' },
      h('div', { class: 'group-head', 'data-flip': 'g:' + g.key },
        h('h2', { class: 'section-label' }, g.title),
        h('span', { class: 'label' }, String(n)),
        h('span', { class: 'grow' }),
        g.key === 'done' ? h('button', { class: 'btn quiet', type: 'button', onClick: clearDone }, 'Clear') : null),
      h('ul', { class: 'tile' }, g.tasks.map((t) => rowEl(t, g)))));
  }
  playFlip(prev);
}

// A title as text, with any links in it made clickable. Everything is a text node, never markup.
function titleNodes(title) {
  return L.tokenize(title).map((tok) => (tok.href
    ? h('a', { class: 'link', href: tok.href, tabindex: '-1', title: tok.href }, tok.text)
    : tok.text));
}

function rowEl(t, g) {
  const editing = state.editingId === t.id;
  const canDrag = !editing && g.key !== 'done';
  const pop = state.popId === t.id;
  const li = h('li', {
    class: 'row' + (t.done ? ' done' : '') + (editing ? ' editing' : '') + (pop ? ' pop' : ''),
    tabindex: '0', 'data-id': t.id, 'data-group': g.key, 'data-flip': 'r:' + t.id,
  });

  li.append(h('button', {
    class: 'check' + (t.done ? ' on' : '') + (pop ? ' pop' : ''), type: 'button', tabindex: '-1', 'aria-pressed': String(t.done),
    'aria-label': (t.done ? 'Mark not done: ' : 'Mark done: ') + t.title,
    onClick: (e) => { e.stopPropagation(); toggle(t.id); },
  }, h('i', null, checkIcon())));

  if (editing) {
    const input = h('input', {
      class: 'edit', type: 'text', value: t.title, maxlength: String(L.MAX_TITLE), 'aria-label': 'Task title',
      onKeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finishEdit(t.id, input.value, true); }
        else if (e.key === 'Escape') { e.preventDefault(); finishEdit(t.id, input.value, false); }
      },
      onBlur: () => finishEdit(t.id, input.value, true),
    });
    li.append(input);
  } else {
    // Hovering the text previews the tick; clicking it ticks the task. Links inside it open instead.
    li.append(h('span', { class: 't', onClick: (e) => { if (e.target.closest('a')) return; toggle(t.id); } },
      h('span', { class: 'tx' }, titleNodes(t.title))));
    const label = t.due ? D.formatDue(t.due, state.today, t.time) : '';
    li.append(label
      ? h('button', {
        class: 'pill' + (t.due < state.today && !t.done ? ' on' : ''), type: 'button', tabindex: '-1', 'aria-label': `Due: ${label}. Change date`,
        onClick: (e) => { e.stopPropagation(); state.dateId === t.id ? closeBar(t.id) : openBar(t.id, false); },
      }, label)
      : h('span'));
    li.append(h('button', {
      class: 'x', type: 'button', tabindex: '-1', 'aria-label': 'Delete: ' + t.title, title: 'Delete',
      onClick: (e) => { e.stopPropagation(); remove(t.id, g.tasks); },
    }, crossIcon()));
    // Rows without a date get a "Date" button on hover, in the same spot the pill would be.
    if (!label) {
      li.append(h('div', { class: 'acts' },
        h('button', { class: 'btn', type: 'button', tabindex: '-1', onClick: (e) => { e.stopPropagation(); openBar(t.id, false); } }, 'Date')));
    }
  }

  if (state.dateId === t.id && !editing) li.append(dateBar(t, g));

  li.addEventListener('keydown', (e) => { if (e.target === li) onRowKey(e, t, g); });
  if (canDrag) {
    wireReorder(li, {
      scroller: els.scroll,
      onDrop: (r) => {
        if (!r || !r.changed) { render(); return; } // cancelled or unmoved: settle back
        reorder(r.id, r.before !== null ? r.before : successorId(state.tasks.find((x) => x.id === r.lastId), r.id));
      },
    });
  }
  return li;
}

function dateBar(t, g) {
  const today = state.today;
  const pick = (label, due) => h('button', { class: 'btn', type: 'button', 'aria-pressed': String(t.due === due && due !== null), onClick: () => applyDue(t.id, due) }, label);
  const quick = [today, D.addDays(today, 1), D.nextMonday(today)];
  const custom = t.due && !quick.includes(t.due);
  const pickBtn = h('button', {
    class: 'btn pick', type: 'button', 'aria-pressed': String(!!custom), 'aria-haspopup': 'dialog',
    onClick: () => openBar(t.id, true),
  }, custom ? D.shortDate(t.due) : 'Pick date');

  const bar = h('div', { class: 'datebar' + (state.fresh === 'bar' ? ' enter' : '') },
    h('div', { class: 'chips' }, pick('Today', today), pick('Tomorrow', D.addDays(today, 1)), pick('Next week', D.nextMonday(today)), pickBtn),
    h('div', { class: 'chips' },
      h('button', { class: 'btn quiet', type: 'button', onClick: () => startEdit(t.id) }, 'Edit'),
      h('button', { class: 'btn quiet', type: 'button', onClick: () => applyDue(t.id, null) }, 'No date'),
      h('button', { class: 'btn quiet', type: 'button', 'aria-label': 'Delete: ' + t.title, onClick: () => { state.dateId = null; state.calOpen = false; remove(t.id, g.tasks); } }, 'Delete')));
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeBar(t.id); }
  });
  return bar;
}

function closeCal() {
  state.calOpen = false;
  state.focusSel = '.datebar .pick';
  render();
}

// The calendar is a sheet over the window rather than part of the row, so it is never
// cut off by the list's scrolling, whatever size the window is.
function renderSheet() {
  const t = state.mode === 'main' && state.calOpen ? state.tasks.find((x) => x.id === state.dateId) : null;
  els.main.inert = !!t;
  if (!t) { els.sheet.hidden = true; clear(els.sheet); return; }
  const today = state.today;
  const quick = (label, due) => h('button', {
    class: 'btn', type: 'button', 'aria-pressed': String(t.due === due && due !== null), onClick: () => applyDue(t.id, due),
  }, label);
  clear(els.sheet).append(
    h('div', { class: 'sheet-back', onClick: closeCal }),
    h('div', { class: 'sheet-panel' + (state.fresh === 'cal' ? ' enter' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Due date' },
      h('div', { class: 'sheet-head' },
        h('span', { class: 'label' }, 'Due date'),
        h('span', { class: 'sheet-task small dim grow' }, t.title),
        h('button', { class: 'btn quiet', type: 'button', onClick: () => applyDue(t.id, null) }, 'No date')),
      createCalendar({ value: t.due, today, onPick: (iso) => applyDue(t.id, iso), onClose: closeCal }),
      h('div', { class: 'chips' }, quick('Today', today), quick('Tomorrow', D.addDays(today, 1)), quick('Next week', D.nextMonday(today)))));
  els.sheet.hidden = false;
}

function focusRow(rows, i) {
  const el = rows[Math.max(0, Math.min(rows.length - 1, i))];
  if (el) el.focus();
}

function onRowKey(e, t, g) {
  if (e.metaKey || e.ctrlKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const stop = () => e.preventDefault();
  if (k === ' ' || k === 'x') { stop(); toggle(t.id, true); }
  else if (k === 'Enter' || k === 'e') { stop(); startEdit(t.id); }
  else if (k === 'Backspace' || k === 'Delete') { stop(); remove(t.id, g.tasks); }
  else if (k === 'd') { stop(); state.dateId === t.id ? closeBar(t.id) : openBar(t.id, false); }
  else if (k === 'c') { stop(); openBar(t.id, true); }
  else if (k === 't') { stop(); applyDue(t.id, state.today); }
  else if (k === 'm') { stop(); applyDue(t.id, D.addDays(state.today, 1)); }
  else if (k === 'w') { stop(); applyDue(t.id, D.nextMonday(state.today)); }
  else if (k === '0') { stop(); applyDue(t.id, null); }
  else if (k === 'o') { const href = L.firstLink(t.title); if (href) { stop(); native.openUrl(href); } }
  else if (k === 'Escape') { if (state.dateId === t.id) closeBar(t.id); else e.target.blur(); }
  else if (k === 'Home' || k === 'End') {
    stop();
    const rows = [...els.scroll.querySelectorAll('.row')];
    focusRow(rows, k === 'Home' ? 0 : rows.length - 1);
  } else if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'j' || k === 'k') {
    stop();
    const dir = (k === 'ArrowUp' || k === 'k') ? -1 : 1;
    if (e.altKey && k.startsWith('Arrow')) {
      if (g.key === 'done') return;
      const i = g.tasks.findIndex((x) => x.id === t.id);
      const neighbour = g.tasks[i + dir];
      if (!neighbour) return;
      reorder(t.id, dir < 0 ? neighbour.id : successorId(neighbour, t.id));
    } else {
      const rows = [...els.scroll.querySelectorAll('.row')];
      focusRow(rows, rows.indexOf(e.target) + dir);
    }
  }
}

function renderFoot() {
  const left = state.saveError
    ? h('span', { class: 'label' }, 'Could not save. Try again.')
    : state.message
      ? [h('span', { class: 'label' }, state.message), state.undo ? h('button', { class: 'btn quiet', type: 'button', onClick: undo }, 'Undo') : null]
      : h('span', { class: 'label', style: 'white-space:nowrap' }, 'Opt Space: add');
  clear(els.foot).append(
    ...[left].flat(), h('span', { class: 'grow' }),
    h('button', { class: 'btn quiet', type: 'button', onClick: () => collapse(false) }, 'Collapse'),
    h('button', { class: 'btn quiet', type: 'button', onClick: () => openSettings() }, 'Settings'),
  );
}

function renderStrip() {
  const t = L.nextUp(state.tasks, state.today);
  const more = Math.max(0, L.counts(state.tasks, state.today).open - (t ? 1 : 0));
  const strip = h('div', { class: 'strip', 'data-tauri-drag-region': true },
    gap(),
    t ? h('button', {
      class: 'check' + (t.done ? ' on' : ''), type: 'button', 'aria-label': 'Mark done: ' + t.title,
      onClick: () => toggle(t.id),
    }, h('i', null, checkIcon())) : null,
    h('div', { class: 'next grow', 'data-tauri-drag-region': true },
      h('span', { class: 'label' }, t ? 'Next up' : 'All clear'),
      h('span', { class: 'name' }, t ? t.title : 'Nothing open')),
    more > 0 ? h('span', { class: 'pill' }, `+${more}`) : null,
    h('button', { class: 'btn quiet', type: 'button', onClick: expand }, 'Expand'));
  clear(els.strip).append(strip);
}

// ---------- settings ----------
function saveSettings(patch) {
  const before = state.settings;
  state.settings = S.clean({ ...before, ...patch });
  S.save(state.settings);
  S.apply(state.settings);
  if (state.settings.onTop !== before.onTop) native.setOnTop(state.settings.onTop);
  if (state.settings.allWorkspaces !== before.allWorkspaces) native.setAllWorkspaces(state.settings.allWorkspaces);
  native.emit('settings-changed', { from: 'main' });
  render();
}

async function setClickThrough(on) {
  state.clickThrough = on;
  if (on && state.mode !== 'main' && state.mode !== 'collapsed') { state.mode = 'main'; skipFlip = true; } // the way out must stay visible
  render();
  await native.setClickThrough(on);
  native.invoke('clickthrough_changed', { on });
}

async function openSettings(section) {
  state.mode = 'settings';
  skipFlip = true;
  render();
  if (section) {
    const el = els.sScroll.querySelector(`[data-section="${section}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView();
  }
  const on = await native.autostartEnabled();
  if (typeof on === 'boolean' && on !== state.autostart) { state.autostart = on; if (state.mode === 'settings') renderSettings(); }
}

async function openAbout() {
  state.mode = 'about';
  render();
  if (!state.version) {
    const v = await native.version();
    if (typeof v === 'string' && v) { state.version = v; if (state.mode === 'about') renderAbout(); }
  }
}

function leaveSettings() {
  state.mode = 'main';
  skipFlip = true;
  render();
}

function switchRow(label, desc, checked, onToggle) {
  return h('div', { class: 'set-row' },
    h('div', { class: 'what' }, h('b', null, label), desc ? h('span', { class: 'small dim' }, desc) : null),
    h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(checked), 'aria-label': label, onClick: () => onToggle(!checked) }));
}

// Keys that work anywhere, and keys that work in the list. Shown in Settings.
const SHORTCUTS_GLOBAL = [
  ['Quick add', 'Opt Space'],
  ['Show or hide', 'Opt Shift T'],
  ['Click-through', 'Opt Shift C'],
];
const SHORTCUTS_LIST = [
  ['Add a task', 'N or /'],
  ['Show Today, Open, All, Done', '1 2 3 4'],
  ['Previous or next list', '[ ]'],
  ['Move between tasks', 'Up Down, J K'],
  ['First or last task', 'Home End'],
  ['Tick or untick', 'Space X'],
  ['Edit the title', 'Enter E'],
  ['Delete', 'Backspace'],
  ['Move the task up or down', 'Alt Up Down'],
  ['Set a date', 'D'],
  ['Due today', 'T'],
  ['Due tomorrow', 'M'],
  ['Due next week', 'W'],
  ['Open the calendar', 'C'],
  ['Clear the date', '0'],
  ['Open a link in the task', 'O'],
  ['Undo', 'Cmd Z'],
  ['Settings', 'Cmd ,'],
  ['Collapse or expand', 'Cmd .'],
  ['Show these shortcuts', '?'],
];

function renderSettings() {
  clear(els.sTitlebar).append(
    gap(),
    h('span', { class: 'label center', 'data-tauri-drag-region': true }, 'Settings'),
    h('button', { class: 'btn quiet', type: 'button', onClick: leaveSettings }, 'Done'));

  const opVal = h('span', { class: 'label range-val' }, `${state.settings.opacity}%`);
  const slider = h('input', {
    class: 'range', id: 'opacity', type: 'range', min: String(S.MIN_OPACITY), max: '100', step: '5', value: String(state.settings.opacity), 'aria-label': 'Opacity',
    onInput: () => {
      const v = Number(slider.value);
      opVal.textContent = `${v}%`;
      document.documentElement.style.setProperty('--win-opacity', String(v / 100)); // live, no re-render while dragging
    },
    onChange: () => saveSettings({ opacity: Number(slider.value) }),
  });

  const themeBtn = (id, label) => h('button', { class: 'btn', type: 'button', 'aria-pressed': String(state.settings.theme === id), onClick: () => saveSettings({ theme: id }) }, label);
  const section = (title, rows, key) => h('section', { class: 'group', 'data-section': key || null },
    h('div', { class: 'group-head' }, h('h2', { class: 'section-label' }, title)),
    h('div', { class: 'tile' }, rows));
  const kbd = (name, keys) => h('div', { class: 'set-row compact' }, h('span', { class: 'what' }, name), h('span', { class: 'kbd' }, keys));

  clear(els.sScroll).append(
    section('Window', [
      switchRow('Keep on top', 'Stays above other windows', state.settings.onTop, (v) => saveSettings({ onTop: v })),
      switchRow('Show on all desktops', null, state.settings.allWorkspaces, (v) => saveSettings({ allWorkspaces: v })),
      switchRow('Click-through', 'Clicks pass to the windows below. Turn off with Opt Shift C or the menu bar icon.', state.clickThrough, (v) => setClickThrough(v)),
      h('div', { class: 'set-row' }, h('label', { class: 'what', for: 'opacity' }, h('b', null, 'Opacity')), h('div', { style: 'display:flex;align-items:center;gap:8px' }, slider, opVal)),
      switchRow('Collapse when idle', 'Shrinks to your next task after 10 seconds without focus', state.settings.collapseIdle, (v) => saveSettings({ collapseIdle: v })),
    ]),
    section('Anywhere', SHORTCUTS_GLOBAL.map(([n, k]) => kbd(n, k)), 'shortcuts'),
    section('In the list', SHORTCUTS_LIST.map(([n, k]) => kbd(n, k))),
    section('General', [
      switchRow('Open at login', null, state.autostart, async (v) => { state.autostart = v; renderSettings(); await native.setAutostart(v); }),
      h('div', { class: 'set-row' }, h('b', { style: 'font-weight:500' }, 'Theme'),
        h('div', { class: 'seg' }, themeBtn('auto', 'Auto'), themeBtn('light', 'Light'), themeBtn('dark', 'Dark'))),
      h('div', { class: 'set-row' }, h('div', { class: 'what' }, h('b', null, 'Storage'), h('span', { class: 'small dim' }, 'On this Mac only. No account, no tracking.'))),
      h('button', { class: 'set-row nav', type: 'button', onClick: openAbout },
        h('div', { class: 'what' }, h('b', null, 'About Slate Tasks'), h('span', { class: 'small dim' }, `Created by ${AUTHOR}`)),
        h('span', { class: 'chev' }, chevron(1))),
    ]),
  );
}

function renderAbout() {
  clear(els.aTitlebar).append(
    gap(),
    h('span', { class: 'label center', 'data-tauri-drag-region': true }, 'About'),
    h('button', { class: 'btn quiet', type: 'button', onClick: () => openSettings() }, 'Back'));

  const fact = (name, value) => h('div', { class: 'set-row' }, h('span', { class: 'label' }, name), h('span', { class: 'val' }, value));
  clear(els.aScroll).append(
    h('div', { class: 'about' },
      h('img', { src: 'favicon.svg', alt: '', width: '72', height: '72' }),
      h('h1', null, 'Slate Tasks'),
      state.version ? h('span', { class: 'label' }, `Version ${state.version}`) : null,
      h('p', { class: 'small dim' }, 'A quiet, always-on-top to-do list for Mac, in the look of Slate.')),
    h('section', { class: 'group' }, h('div', { class: 'tile' }, [
      fact('Created by', AUTHOR),
      fact('Copyright', COPYRIGHT),
      fact('Source', h('a', { class: 'link', href: REPO }, 'github.com/Aivarasli/todo_slate')),
    ])),
    h('p', { class: 'small dim about-fine' }, 'Local only: no account, no tracking, no network. Your tasks stay on this Mac.'),
    h('p', { class: 'small dim about-fine' }, 'Fonts: Funnel Display, Funnel Sans and Martian Mono, under the SIL Open Font License 1.1.'),
  );
}

// ---------- collapse ----------
async function collapse(auto) {
  if (state.mode !== 'main') return;
  const size = await native.logicalSize();
  if (size) state.expandedSize = size;
  state.mode = 'collapsed';
  state.autoCollapsed = !!auto;
  render();
  await native.resize(COLLAPSED.w, COLLAPSED.h);
}

async function expand() {
  state.mode = 'main';
  state.autoCollapsed = false;
  skipFlip = true;
  render();
  const s = state.expandedSize || DEFAULT_SIZE;
  await native.resize(s.w, s.h);
}

// ---------- wiring ----------
function isTyping(el) { return !!(el && el.matches && el.matches('input,textarea,select')); }

document.addEventListener('keydown', (e) => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && !e.shiftKey && e.key === ',') {
    e.preventDefault();
    if (state.mode === 'main') openSettings();
    else if (state.mode === 'settings' || state.mode === 'about') leaveSettings();
    return;
  }
  if (meta && !e.shiftKey && e.key === '.') {
    e.preventDefault();
    if (state.mode === 'collapsed') expand(); else collapse(false);
    return;
  }
  if (e.defaultPrevented) return; // a row or the calendar already took this key
  if (isTyping(e.target)) return;
  if (e.metaKey && !e.shiftKey && e.key === 'z' && state.undo) { e.preventDefault(); undo(); return; }
  if (meta || e.altKey) return;
  if (state.mode === 'settings') { if (e.key === 'Escape') { e.preventDefault(); leaveSettings(); } return; }
  if (state.mode === 'about') { if (e.key === 'Escape') { e.preventDefault(); openSettings(); } return; }
  if (state.mode !== 'main') return;
  if (e.target.closest && e.target.closest('.datebar, .sheet')) return;

  const k = e.key;
  if (k === 'n' || k === 'a' || k === '/') { e.preventDefault(); els.input.focus(); }
  else if (k === '?') { e.preventDefault(); openSettings('shortcuts'); }
  else if (k.length === 1 && '1234'.includes(k)) { e.preventDefault(); setFilter(L.FILTERS[Number(k) - 1]); }
  else if (k === '[' || k === ']') {
    e.preventDefault();
    const i = L.FILTERS.indexOf(filter());
    setFilter(L.FILTERS[(i + (k === ']' ? 1 : L.FILTERS.length - 1)) % L.FILTERS.length]);
  } else if (!e.target.classList || !e.target.classList.contains('row')) {
    // Nothing focused yet: arrows or J/K pick up the list from either end.
    const rows = [...els.scroll.querySelectorAll('.row')];
    if (!rows.length) return;
    if (k === 'ArrowDown' || k === 'j') { e.preventDefault(); rows[0].focus(); }
    else if (k === 'ArrowUp' || k === 'k') { e.preventDefault(); rows[rows.length - 1].focus(); }
  }
});

// Tab stays inside the calendar sheet while it is open.
els.sheet.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const f = [...els.sheet.querySelectorAll('button')].filter((b) => b.tabIndex >= 0);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
  e.preventDefault();
  f[next].focus();
});

// Links never navigate the window. They open in the default browser or mail app instead.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault();
  native.openUrl(a.getAttribute('href'));
});
document.addEventListener('auxclick', (e) => { if (e.target.closest && e.target.closest('a[href]')) e.preventDefault(); });

window.addEventListener('blur', () => {
  clearTimeout(idleTimer);
  if (state.settings.collapseIdle && state.mode === 'main' && !state.clickThrough && !state.editingId) {
    idleTimer = setTimeout(() => collapse(true), IDLE_MS);
  }
});
window.addEventListener('focus', () => {
  clearTimeout(idleTimer);
  if (state.autoCollapsed && state.mode === 'collapsed') expand();
});

// Never rebuild the list under an open editor, a drag, or a row that is still leaving.
const busy = () => !!(state.editingId || state.dateId || isReordering() || pendingLeaves > 0);

function reloadTasks() {
  state.tasks = store.load();
  if (busy()) return;
  render();
}
window.addEventListener('storage', (e) => { if (e.key === store.KEY) reloadTasks(); });
native.listen('tasks-changed', (ev) => { if (!ev || !ev.payload || ev.payload.from !== 'main') reloadTasks(); });
native.listen('toggle-clickthrough', () => setClickThrough(!state.clickThrough));

setInterval(() => { if (D.toISO(new Date()) !== state.today && !busy()) render(); }, 30000);

S.apply(state.settings);
native.setOnTop(state.settings.onTop);
native.setAllWorkspaces(state.settings.allWorkspaces);
render();

// Exposed for tests in a plain browser only.
if (!native.inTauri) window.__slate = { state, render, commit };
