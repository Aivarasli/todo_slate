import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/js/dates.js';
import * as L from '../src/js/logic.js';
import * as S from '../src/js/settings.js';
import * as store from '../src/js/store.js';

const TODAY = '2026-10-27';

// ---- dates ----
test('parseISO rejects impossible dates', () => {
  assert.ok(D.parseISO('2026-10-27'));
  assert.equal(D.parseISO('2026-02-30'), null);
  assert.equal(D.parseISO('2026-13-01'), null);
  assert.equal(D.parseISO('nope'), null);
  assert.equal(D.parseISO(null), null);
});

test('addDays crosses month, year and leap day', () => {
  assert.equal(D.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(D.addDays('2026-10-27', -27), '2026-09-30');
});

test('diffDays is not skewed by daylight saving', () => {
  assert.equal(D.diffDays('2026-10-26', '2026-10-25'), 1); // EU clocks go back 25 Oct
  assert.equal(D.diffDays('2026-03-30', '2026-03-28'), 2); // EU clocks go forward 29 Mar
  assert.equal(D.diffDays('2026-10-24', '2026-10-27'), -3);
});

test('nextMonday is always strictly in the future', () => {
  assert.equal(D.nextMonday('2026-10-26'), '2026-11-02'); // Monday -> next Monday
  assert.equal(D.nextMonday('2026-10-27'), '2026-11-02'); // Tuesday
  assert.equal(D.nextMonday('2026-11-01'), '2026-11-02'); // Sunday
});

test('formatDue', () => {
  assert.equal(D.formatDue('2026-10-24', TODAY), 'Overdue 3 d');
  assert.equal(D.formatDue(TODAY, TODAY), 'Today');
  assert.equal(D.formatDue(TODAY, TODAY, '14:00'), '14:00');
  assert.equal(D.formatDue('2026-10-28', TODAY), 'Tomorrow');
  assert.equal(D.formatDue('2026-10-29', TODAY), 'Thu 29 Oct');
  assert.equal(D.formatDue('2026-10-29', TODAY, '10:00'), 'Thu 29 Oct 10:00');
  assert.equal(D.formatDue(null, TODAY), '');
});

test('date lines in English and Lithuanian', () => {
  const d = new Date(2026, 9, 27);
  assert.equal(D.datelineEN(d), 'Tuesday, 27 October');
  assert.equal(D.datelineLT(d), 'Antradienis, spalio 27 d.');
});

// ---- tasks ----
test('createTask trims, collapses spaces, rejects empty, limits length', () => {
  assert.equal(L.createTask({ title: '   ' }), null);
  assert.equal(L.createTask({ title: null }), null);
  assert.equal(L.createTask({ title: '  Call   the  printer ' }).title, 'Call the printer');
  assert.equal(L.createTask({ title: 'x'.repeat(1000) }).title.length, L.MAX_TITLE);
});

test('createTask ignores invalid due and a time without a date', () => {
  assert.equal(L.createTask({ title: 'a', due: '2026-02-30' }).due, null);
  assert.equal(L.createTask({ title: 'a', time: '10:00' }).time, null);
  const t = L.createTask({ title: 'a', due: TODAY, time: '25:99' });
  assert.equal(t.time, null);
  assert.equal(L.createTask({ title: 'a', due: TODAY, time: '09:30' }).time, '09:30');
});

test('normalize survives garbage and fixes duplicates', () => {
  assert.equal(L.normalize(null).ok, false);
  assert.equal(L.normalize('text').ok, false);
  const { tasks, ok } = L.normalize({
    tasks: [
      { id: 'a', title: 'one' },
      { id: 'a', title: 'two' },
      { title: '' },
      null,
      42,
      { id: 'c', title: 'three', done: true, due: 'bad' },
    ],
  });
  assert.equal(ok, true);
  assert.equal(tasks.length, 3);
  assert.equal(new Set(tasks.map((t) => t.id)).size, 3);
  assert.equal(tasks[2].due, null);
  assert.equal(tasks[2].done, true);
  assert.ok(Number.isFinite(tasks[2].doneAt));
});

test('normalize accepts a bare array too', () => {
  assert.equal(L.normalize([{ id: 'a', title: 'x' }]).tasks.length, 1);
});

test('toggleDone sets and clears doneAt, and does not mutate', () => {
  const a = [{ id: '1', title: 'a', done: false, doneAt: null, due: null, time: null, createdAt: 0 }];
  const b = L.toggleDone(a, '1', 123);
  assert.equal(b[0].done, true);
  assert.equal(b[0].doneAt, 123);
  assert.equal(a[0].done, false);
  assert.equal(L.toggleDone(b, '1')[0].doneAt, null);
});

test('renameTask keeps the old title when the new one is empty', () => {
  const a = [{ id: '1', title: 'keep' }];
  assert.equal(L.renameTask(a, '1', '   ')[0].title, 'keep');
  assert.equal(L.renameTask(a, '1', ' new ')[0].title, 'new');
});

test('setDue with an invalid date clears it', () => {
  const a = [{ id: '1', title: 'a', due: TODAY, time: '10:00' }];
  const b = L.setDue(a, '1', '');
  assert.equal(b[0].due, null);
  assert.equal(b[0].time, null);
  assert.equal(L.setDue(a, '1', '2026-11-02')[0].due, '2026-11-02');
});

test('moveBefore reorders and is a no-op when nothing changes', () => {
  const t = (id) => ({ id, title: id });
  const a = [t('a'), t('b'), t('c')];
  assert.deepEqual(L.moveBefore(a, 'c', 'a').map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(L.moveBefore(a, 'a', null).map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(L.moveBefore(a, 'a', 'b').map((x) => x.id), ['a', 'b', 'c']);
  assert.equal(L.moveBefore(a, 'a', 'b'), a);
  assert.equal(L.moveBefore(a, 'zzz', 'a'), a);
});

test('grouping: overdue, today (done stays), later, no date, done tab', () => {
  const mk = (id, due, done = false, doneAt = null) => ({ id, title: id, due, done, doneAt, time: null });
  const tasks = [
    mk('over', '2026-10-24'),
    mk('today', TODAY),
    mk('todayDone', TODAY, true, 5),
    mk('later', '2026-10-30'),
    mk('none', null),
    mk('oldDone', '2026-10-20', true, 9),
  ];
  const keys = (f) => L.groupTasks(tasks, f, TODAY).map((g) => g.key + ':' + g.tasks.map((t) => t.id).join(','));
  assert.deepEqual(keys('today'), ['overdue:over', 'today:today,todayDone']);
  assert.deepEqual(keys('all'), ['overdue:over', 'today:today,todayDone', 'later:later', 'nodate:none']);
  assert.deepEqual(keys('done'), ['done:oldDone,todayDone']); // newest first
  assert.deepEqual(L.counts(tasks, TODAY), { today: 2, all: 4, done: 2 });
});

test('nextUp prefers overdue, then today, then anything open', () => {
  const mk = (id, due, done = false) => ({ id, title: id, due, done, time: null });
  assert.equal(L.nextUp([mk('l', '2026-11-01'), mk('o', '2026-10-20'), mk('t', TODAY)], TODAY).id, 'o');
  assert.equal(L.nextUp([mk('l', '2026-11-01'), mk('t', TODAY)], TODAY).id, 't');
  assert.equal(L.nextUp([mk('l', '2026-11-01')], TODAY).id, 'l');
  assert.equal(L.nextUp([mk('d', TODAY, true)], TODAY), null);
  assert.equal(L.nextUp([], TODAY), null);
});

// ---- settings ----
test('settings.clean clamps opacity and rejects bad values', () => {
  assert.equal(S.clean({ opacity: 5 }).opacity, S.MIN_OPACITY);
  assert.equal(S.clean({ opacity: 500 }).opacity, 100);
  assert.equal(S.clean({ opacity: 'x' }).opacity, 100);
  assert.equal(S.clean({ opacity: 62.4 }).opacity, 62);
  assert.equal(S.clean({ theme: 'pink' }).theme, 'auto');
  assert.equal(S.clean({ onTop: 'yes' }).onTop, true);
  assert.equal(S.clean(null).onTop, true);
});

test('click-through is never part of saved settings', () => {
  assert.equal('clickThrough' in S.clean({ clickThrough: true }), false);
  assert.equal('clickThrough' in S.DEFAULTS, false);
});

// ---- store ----
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    keys: () => [...m.keys()],
    _m: m,
  };
}

test('store round-trips tasks', () => {
  globalThis.localStorage = fakeStorage();
  const tasks = [L.createTask({ title: 'a', due: TODAY })];
  assert.equal(store.save(tasks), true);
  assert.deepEqual(store.load(), tasks);
});

test('store keeps a backup of damaged data instead of silently losing it', () => {
  globalThis.localStorage = fakeStorage({ [store.KEY]: '{not json' });
  assert.deepEqual(store.load(), []);
  const backups = globalThis.localStorage.keys().filter((k) => k.includes(':backup:'));
  assert.equal(backups.length, 1);
  assert.equal(globalThis.localStorage.getItem(backups[0]), '{not json');
});

test('store.save reports failure when storage throws', () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.equal(store.save([]), false);
});

test('store works with no storage at all', () => {
  delete globalThis.localStorage;
  assert.deepEqual(store.load(), []);
  assert.equal(store.save([]), false);
});
