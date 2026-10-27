// The quick-add bar: a small window that appears on the global shortcut.
// Type, press Enter, it is added and the bar hides. Esc or clicking away hides it too.
import { h } from './dom.js';
import * as D from './dates.js';
import * as L from './logic.js';
import * as store from './store.js';
import * as S from './settings.js';
import { native } from './native.js';

document.body.classList.add('quick');
S.apply(S.load());
window.addEventListener('storage', (e) => { if (e.key === S.KEY) S.apply(S.load()); });
native.listen('settings-changed', () => S.apply(S.load()));

const state = { when: 'today', custom: null, showDate: false };

const input = h('input', {
  class: 'input', type: 'text', placeholder: 'Add a task', 'aria-label': 'New task', maxlength: String(L.MAX_TITLE), autocomplete: 'off', spellcheck: 'false',
  onKeydown: (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  },
});
const dateInput = h('input', {
  class: 'input date', type: 'date', 'aria-label': 'Pick a date', hidden: true,
  onChange: () => { state.custom = dateInput.value || null; state.when = state.custom ? 'custom' : 'today'; renderChips(); },
});
const chips = h('div', { class: 'actions' });
const bar = h('div', { class: 'bar' }, input, chips);
document.getElementById('root').append(bar);

function dueISO() {
  const today = D.toISO(new Date());
  if (state.when === 'tomorrow') return D.addDays(today, 1);
  if (state.when === 'custom' && state.custom) return state.custom;
  return today;
}

function renderChips() {
  const chip = (id, label) => h('button', {
    class: 'btn', type: 'button', 'aria-pressed': String(state.when === id),
    onClick: () => { state.when = id; state.showDate = false; dateInput.hidden = true; renderChips(); input.focus(); },
  }, label);
  while (chips.firstChild) chips.removeChild(chips.firstChild);
  chips.append(
    chip('today', 'Today'), chip('tomorrow', 'Tomorrow'),
    h('button', {
      class: 'btn', type: 'button', 'aria-pressed': String(state.when === 'custom'),
      onClick: () => { state.showDate = true; dateInput.hidden = false; dateInput.focus(); },
    }, state.when === 'custom' && state.custom ? D.formatDue(state.custom, D.toISO(new Date())) : 'Due date…'),
    dateInput, h('span', { class: 'grow' }), h('span', { class: 'label' }, 'Enter to add, Esc to close'));
}

function reset() {
  input.value = '';
  state.when = 'today';
  state.custom = null;
  dateInput.value = '';
  dateInput.hidden = true;
  renderChips();
  input.focus();
}

function close() {
  reset();
  native.hide();
}

function submit() {
  const task = L.createTask({ title: input.value, due: dueISO() });
  if (!task) { if (!input.value.trim()) input.value = ''; return; }
  const ok = store.save(L.appendTask(store.load(), task));
  if (!ok) { input.setAttribute('aria-invalid', 'true'); input.placeholder = 'Could not save. Try again.'; return; }
  native.emit('tasks-changed', { from: 'quickadd' });
  close();
}

native.listen('quickadd-open', reset);
window.addEventListener('focus', () => input.focus());
// Hide when focus leaves, but give a native date picker a moment: it can blur the window briefly.
window.addEventListener('blur', () => {
  if (!native.inTauri) return;
  setTimeout(() => { if (!document.hasFocus() && document.activeElement !== dateInput) native.hide(); }, 150);
});
reset();
