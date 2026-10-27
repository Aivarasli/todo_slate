// The main window: list, settings and the collapsed strip.
import { h, clear, checkIcon } from './dom.js';
import * as D from './dates.js';
import * as L from './logic.js';
import * as store from './store.js';
import * as S from './settings.js';
import { native } from './native.js';

const COLLAPSED = { w: 420, h: 56 };
const DEFAULT_SIZE = { w: 360, h: 560 };
const IDLE_MS = 10000;
const UNDO_MS = 8000;

const state = {
  tasks: store.load(),
  settings: S.load(),
  filter: 'today', // today | all | done
  mode: 'main', // main | settings | collapsed
  today: D.toISO(new Date()),
  editingId: null,
  dateId: null,
  focusId: null,
  dragId: null,
  undo: null, // { tasks } snapshot to restore
  message: null, // text shown in the footer
  saveError: false,
  clickThrough: false, // never persisted
  autostart: false,
  expandedSize: null,
  autoCollapsed: false,
};
let undoTimer = null;
let idleTimer = null;

// ---------- shell (built once) ----------
const els = {
  main: h('div', { class: 'view' }),
  settings: h('div', { class: 'view' }),
  strip: h('div', { class: 'view' }),
  titlebar: h('div', { class: 'titlebar', 'data-tauri-drag-region': true }),
  head: h('div', { class: 'head' }),
  tabs: h('div', { class: 'tabs', role: 'group', 'aria-label': 'Filter' }),
  scroll: h('div', { class: 'scroll' }),
  foot: h('div', { class: 'foot' }),
  sTitlebar: h('div', { class: 'titlebar', 'data-tauri-drag-region': true }),
  sScroll: h('div', { class: 'scroll', style: 'padding-top:16px' }),
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
els.strip.append();
els.win = h('div', { class: 'win' }, els.main, els.settings, els.strip);
document.getElementById('root').append(els.win);

// ---------- state changes ----------
function commit(tasks, opts = {}) {
  state.tasks = tasks;
  if (opts.focusId !== undefined) state.focusId = opts.focusId;
  const ok = store.save(tasks);
  state.saveError = !ok;
  if (ok) native.emit('tasks-changed', { from: 'main' });
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

function toggle(id) {
  commit(L.toggleDone(state.tasks, id), { focusId: id });
}

function remove(id, siblings) {
  const prev = state.tasks;
  const i = siblings ? siblings.findIndex((t) => t.id === id) : -1;
  const neighbour = siblings ? (siblings[i + 1] || siblings[i - 1]) : null;
  setUndo(prev, 'Task deleted.');
  commit(L.removeTask(prev, id), { focusId: neighbour ? neighbour.id : null });
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
  if (state.filter === 'done') state.filter = 'today';
  commit(state.tasks.concat([task]));
}

function startEdit(id) {
  state.editingId = id;
  state.dateId = null;
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
  commit(L.setDue(state.tasks, id, due), { focusId: id });
}

function reorder(id, beforeId) {
  const next = L.moveBefore(state.tasks, id, beforeId);
  if (next !== state.tasks) commit(next, { focusId: id });
}

// The task that follows `t` in the stored order, ignoring `skipId`.
function successorId(t, skipId) {
  const i = state.tasks.findIndex((x) => x.id === t.id);
  let nx = state.tasks[i + 1];
  if (nx && nx.id === skipId) nx = state.tasks[i + 2];
  return nx ? nx.id : null;
}

// ---------- rendering ----------
function render() {
  state.today = D.toISO(new Date());
  document.body.classList.toggle('clickthrough', state.clickThrough);
  els.main.hidden = state.mode !== 'main';
  els.settings.hidden = state.mode !== 'settings';
  els.strip.hidden = state.mode !== 'collapsed';
  if (state.mode === 'main') { renderTitlebar(); renderHead(); renderTabs(); renderList(); renderFoot(); }
  else if (state.mode === 'settings') renderSettings();
  else renderStrip();
  if (state.focusId) {
    const el = els.scroll.querySelector(`[data-id="${CSS.escape(state.focusId)}"]`);
    if (el) el.focus();
    state.focusId = null;
  }
}

function gap() { return h('div', { class: 'lights-gap', 'data-tauri-drag-region': true }); }

function renderTitlebar() {
  const open = L.counts(state.tasks, state.today).all;
  clear(els.titlebar).append(
    gap(),
    h('span', { class: 'label center', 'data-tauri-drag-region': true },
      state.clickThrough ? h('span', { class: 'pill on' }, 'Click-through') : `${open} open`),
    h('button', { class: 'btn', type: 'button', 'aria-pressed': String(state.settings.onTop), onClick: () => saveSettings({ onTop: !state.settings.onTop }) },
      h('span', { class: 'dot' + (state.settings.onTop ? ' on' : '') }), 'On top'),
  );
}

function renderHead() {
  const now = new Date();
  const title = state.filter === 'all' ? 'All tasks' : state.filter === 'done' ? 'Done' : 'Today';
  clear(els.head).append(
    h('h1', null, title),
    h('div', { class: 'dateline' },
      h('span', { class: 'label' }, D.datelineEN(now)),
      h('span', { class: 'small dim' }, D.datelineLT(now))),
  );
}

function renderTabs() {
  const c = L.counts(state.tasks, state.today);
  const tab = (key, label, n) => h('button', {
    class: 'btn', type: 'button', 'aria-pressed': String(state.filter === key),
    onClick: () => { state.filter = key; state.dateId = null; render(); },
  }, `${label} ${n}`);
  clear(els.tabs).append(tab('today', 'Today', c.today), tab('all', 'All', c.all), tab('done', 'Done', c.done));
}

function renderList() {
  const groups = L.groupTasks(state.tasks, state.filter, state.today);
  clear(els.scroll);
  if (!groups.length) {
    els.scroll.append(h('p', { class: 'label empty' }, 'No tasks here'));
    return;
  }
  for (const g of groups) {
    const n = g.key === 'done' ? g.tasks.length : g.tasks.filter((t) => !t.done).length;
    els.scroll.append(h('section', { class: 'group' },
      h('div', { class: 'group-head' },
        h('h2', { class: 'section-label' }, g.title),
        h('span', { class: 'label' }, String(n)),
        h('span', { class: 'grow' }),
        g.key === 'done' ? h('button', { class: 'btn quiet', type: 'button', onClick: clearDone }, 'Clear') : null),
      h('ul', { class: 'tile' }, g.tasks.map((t) => rowEl(t, g)))));
  }
}

function rowEl(t, g) {
  const editing = state.editingId === t.id;
  const canDrag = !editing && g.key !== 'done';
  const li = h('li', {
    class: 'row' + (t.done ? ' done' : '') + (editing ? ' editing' : ''),
    tabindex: '0', draggable: canDrag ? 'true' : null, 'data-id': t.id, 'data-group': g.key,
  });

  li.append(h('button', {
    class: 'check' + (t.done ? ' on' : ''), type: 'button', tabindex: '-1', 'aria-pressed': String(t.done),
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
    li.append(h('span', { class: 't', onDblclick: () => startEdit(t.id) }, t.title));
    const label = t.due ? D.formatDue(t.due, state.today, t.time) : '';
    li.append(label
      ? h('button', {
        class: 'pill' + (t.due < state.today && !t.done ? ' on' : ''), type: 'button', tabindex: '-1', 'aria-label': `Due: ${label}. Change date`,
        onClick: (e) => { e.stopPropagation(); state.dateId = state.dateId === t.id ? null : t.id; render(); },
      }, label)
      : h('span'));
    // Rows without a date get a "Date" button on hover, in the same spot the pill would be.
    if (!label) {
      li.append(h('div', { class: 'acts' },
        h('button', { class: 'btn', type: 'button', tabindex: '-1', onClick: (e) => { e.stopPropagation(); state.dateId = state.dateId === t.id ? null : t.id; render(); } }, 'Date')));
    }
  }

  if (state.dateId === t.id && !editing) li.append(dateBar(t, g));

  li.addEventListener('keydown', (e) => { if (e.target === li) onRowKey(e, t, g); });
  if (canDrag) wireDrag(li, t, g);
  return li;
}

function dateBar(t, g) {
  const today = state.today;
  const pick = (label, due) => h('button', { class: 'btn', type: 'button', 'aria-pressed': String(t.due === due && due !== null), onClick: () => applyDue(t.id, due) }, label);
  const input = h('input', {
    class: 'input date', type: 'date', value: t.due || '', 'aria-label': 'Pick a date',
    onChange: () => applyDue(t.id, input.value || null),
  });
  const bar = h('div', { class: 'datebar' },
    pick('Today', today), pick('Tomorrow', D.addDays(today, 1)), pick('Next week', D.nextMonday(today)),
    h('button', { class: 'btn quiet', type: 'button', onClick: () => applyDue(t.id, null) }, 'No date'), input,
    // Deleting takes a second step on purpose: it is never under the cursor by accident. Undo is offered after.
    h('button', { class: 'btn quiet', type: 'button', 'aria-label': 'Delete: ' + t.title, onClick: () => { state.dateId = null; remove(t.id, g.tasks); } }, 'Delete'));
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); state.dateId = null; state.focusId = t.id; render(); }
  });
  return bar;
}

function onRowKey(e, t, g) {
  const k = e.key;
  if (k === ' ' || k === 'x') { e.preventDefault(); toggle(t.id); }
  else if (k === 'Enter') { e.preventDefault(); startEdit(t.id); }
  else if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); remove(t.id, g.tasks); }
  else if (k === 'd') { e.preventDefault(); state.dateId = state.dateId === t.id ? null : t.id; render(); }
  else if (k === 'Escape') { e.target.blur(); }
  else if (k === 'ArrowUp' || k === 'ArrowDown') {
    e.preventDefault();
    const dir = k === 'ArrowUp' ? -1 : 1;
    if (e.altKey) {
      if (g.key === 'done') return;
      const i = g.tasks.findIndex((x) => x.id === t.id);
      const neighbour = g.tasks[i + dir];
      if (!neighbour) return;
      reorder(t.id, dir < 0 ? neighbour.id : successorId(neighbour, t.id));
    } else {
      const rows = [...els.scroll.querySelectorAll('.row')];
      const next = rows[rows.indexOf(e.target) + dir];
      if (next) next.focus();
    }
  }
}

function wireDrag(li, t, g) {
  const clearMarks = () => li.classList.remove('drop-before', 'drop-after');
  li.addEventListener('dragstart', (e) => {
    state.dragId = t.id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', t.id); } catch { /* not needed everywhere */ }
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => {
    state.dragId = null;
    els.scroll.querySelectorAll('.dragging,.drop-before,.drop-after').forEach((n) => n.classList.remove('dragging', 'drop-before', 'drop-after'));
  });
  li.addEventListener('dragover', (e) => {
    if (!state.dragId || state.dragId === t.id) return;
    const dragged = state.tasks.find((x) => x.id === state.dragId);
    if (!dragged || L.groupOf(dragged, state.today) !== g.key) return; // only reorder inside a group
    e.preventDefault();
    const after = e.offsetY > li.clientHeight / 2;
    li.classList.toggle('drop-after', after);
    li.classList.toggle('drop-before', !after);
  });
  li.addEventListener('dragleave', clearMarks);
  li.addEventListener('drop', (e) => {
    if (!state.dragId) return;
    e.preventDefault();
    const after = li.classList.contains('drop-after');
    const dragId = state.dragId;
    state.dragId = null;
    clearMarks();
    reorder(dragId, after ? successorId(t, dragId) : t.id);
  });
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
    h('button', { class: 'btn quiet', type: 'button', onClick: openSettings }, 'Settings'),
  );
}

function renderStrip() {
  const t = L.nextUp(state.tasks, state.today);
  const more = Math.max(0, L.counts(state.tasks, state.today).all - (t ? 1 : 0));
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
  if (on) state.mode = state.mode === 'settings' ? 'main' : state.mode; // the way out must stay visible
  render();
  await native.setClickThrough(on);
  native.invoke('clickthrough_changed', { on });
}

async function openSettings() {
  state.mode = 'settings';
  render();
  const on = await native.autostartEnabled();
  if (typeof on === 'boolean' && on !== state.autostart) { state.autostart = on; if (state.mode === 'settings') renderSettings(); }
}

function switchRow(label, desc, checked, onToggle) {
  return h('div', { class: 'set-row' },
    h('div', { class: 'what' }, h('b', null, label), desc ? h('span', { class: 'small dim' }, desc) : null),
    h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(checked), 'aria-label': label, onClick: () => onToggle(!checked) }));
}

function renderSettings() {
  clear(els.sTitlebar).append(
    gap(),
    h('span', { class: 'label center', 'data-tauri-drag-region': true }, 'Settings'),
    h('button', { class: 'btn quiet', type: 'button', onClick: () => { state.mode = 'main'; render(); } }, 'Done'));

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
  const section = (title, rows) => h('section', { class: 'group' },
    h('div', { class: 'group-head' }, h('h2', { class: 'section-label' }, title)),
    h('div', { class: 'tile' }, rows));
  const kbd = (name, keys) => h('div', { class: 'set-row' }, h('b', { style: 'font-weight:500' }, name), h('span', { class: 'kbd' }, keys));

  clear(els.sScroll).append(
    section('Window', [
      switchRow('Keep on top', 'Stays above other windows', state.settings.onTop, (v) => saveSettings({ onTop: v })),
      switchRow('Show on all desktops', null, state.settings.allWorkspaces, (v) => saveSettings({ allWorkspaces: v })),
      switchRow('Click-through', 'Clicks pass to the windows below. Turn off with Opt Shift C or the menu bar icon.', state.clickThrough, (v) => setClickThrough(v)),
      h('div', { class: 'set-row' }, h('label', { class: 'what', for: 'opacity' }, h('b', null, 'Opacity')), h('div', { style: 'display:flex;align-items:center;gap:8px' }, slider, opVal)),
      switchRow('Collapse when idle', 'Shrinks to your next task after 10 seconds without focus', state.settings.collapseIdle, (v) => saveSettings({ collapseIdle: v })),
    ]),
    section('Shortcuts', [
      kbd('Quick add', 'Opt Space'),
      kbd('Show or hide', 'Opt Shift T'),
      kbd('Click-through', 'Opt Shift C'),
    ]),
    section('General', [
      switchRow('Open at login', null, state.autostart, async (v) => { state.autostart = v; renderSettings(); await native.setAutostart(v); }),
      h('div', { class: 'set-row' }, h('b', { style: 'font-weight:500' }, 'Theme'),
        h('div', { class: 'seg' }, themeBtn('auto', 'Auto'), themeBtn('light', 'Light'), themeBtn('dark', 'Dark'))),
      h('div', { class: 'set-row' }, h('div', { class: 'what' }, h('b', null, 'Storage'), h('span', { class: 'small dim' }, 'On this Mac only. No account, no tracking.'))),
    ]),
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
  render();
  const s = state.expandedSize || DEFAULT_SIZE;
  await native.resize(s.w, s.h);
}

// ---------- wiring ----------
function isTyping(el) { return !!(el && el.matches && el.matches('input,textarea,select')); }

document.addEventListener('keydown', (e) => {
  if (isTyping(e.target)) return;
  if (e.metaKey && !e.shiftKey && e.key === 'z' && state.undo) { e.preventDefault(); undo(); return; }
  if (state.mode !== 'main' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'n' || e.key === '/') { e.preventDefault(); els.input.focus(); }
});

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

function reloadTasks() {
  state.tasks = store.load();
  if (state.editingId || state.dateId) return; // never rebuild under an open editor
  render();
}
window.addEventListener('storage', (e) => { if (e.key === store.KEY) reloadTasks(); });
native.listen('tasks-changed', (ev) => { if (!ev || !ev.payload || ev.payload.from !== 'main') reloadTasks(); });
native.listen('toggle-clickthrough', () => setClickThrough(!state.clickThrough));

setInterval(() => { if (D.toISO(new Date()) !== state.today && !state.editingId && !state.dateId) render(); }, 30000);

S.apply(state.settings);
native.setOnTop(state.settings.onTop);
native.setAllWorkspaces(state.settings.allWorkspaces);
render();

// Exposed for tests in a plain browser only.
if (!native.inTauri) window.__slate = { state, render, commit };
