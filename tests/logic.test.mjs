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

test('second-language date line', () => {
  const d = new Date(2026, 9, 27);
  assert.equal(D.dateline(d, 'lt'), 'Antradienis, spalio 27 d.');
  assert.equal(D.dateline(d, 'off'), '');
  assert.equal(D.dateline(d, 'xx'), '');
  assert.match(D.dateline(d, 'de'), /^Dienstag/);
  assert.match(D.dateline(d, 'fr'), /^Mardi/);
  for (const [c] of D.LANGUAGES) assert.ok(D.dateline(d, c).length > 4, c);
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
  assert.deepEqual(keys('open'), ['overdue:over', 'today:today', 'later:later', 'nodate:none']); // only what is still to do
  assert.deepEqual(keys('all'), ['overdue:over', 'today:today,todayDone', 'later:later', 'nodate:none', 'done:oldDone']);
  assert.deepEqual(keys('done'), ['done:oldDone,todayDone']); // newest first
  assert.deepEqual(L.counts(tasks, TODAY), { today: 2, open: 4, all: 6, done: 2 });
  assert.deepEqual(L.FILTERS, ['today', 'open', 'all', 'done']);
});

test('nextUp prefers overdue, then today, then anything open', () => {
  const mk = (id, due, done = false) => ({ id, title: id, due, done, time: null });
  assert.equal(L.nextUp([mk('l', '2026-11-01'), mk('o', '2026-10-20'), mk('t', TODAY)], TODAY).id, 'o');
  assert.equal(L.nextUp([mk('l', '2026-11-01'), mk('t', TODAY)], TODAY).id, 't');
  assert.equal(L.nextUp([mk('l', '2026-11-01')], TODAY).id, 'l');
  assert.equal(L.nextUp([mk('d', TODAY, true)], TODAY), null);
  assert.equal(L.nextUp([], TODAY), null);
});

test('open filter never lists a done task, wherever it is dated', () => {
  const mk = (id, due, done) => ({ id, title: id, due, done, doneAt: done ? 1 : null, time: null });
  const tasks = [mk('a', TODAY, true), mk('b', '2026-10-01', true), mk('c', null, true), mk('d', TODAY, false)];
  const ids = L.groupTasks(tasks, 'open', TODAY).flatMap((g) => g.tasks.map((t) => t.id));
  assert.deepEqual(ids, ['d']);
  assert.deepEqual(L.groupTasks(tasks.slice(0, 3), 'open', TODAY), []);
});

// ---- links ----
const links = (s) => L.tokenize(s).filter((t) => t.href).map((t) => [t.text, t.href]);

test('tokenize finds http links, www, bare domains and email, and keeps the rest as text', () => {
  assert.deepEqual(links('Send https://example.com/a?b=1 to Nora'), [['https://example.com/a?b=1', 'https://example.com/a?b=1']]);
  assert.deepEqual(links('See www.slate.lt then call'), [['www.slate.lt', 'https://www.slate.lt']]);
  assert.deepEqual(links('Review figma.com/file/abc123'), [['figma.com/file/abc123', 'https://figma.com/file/abc123']]);
  assert.deepEqual(links('Mail nora@studio.com today'), [['nora@studio.com', 'mailto:nora@studio.com']]);
  const t = L.tokenize('a https://x.com/y b');
  assert.deepEqual(t.map((x) => x.text).join(''), 'a https://x.com/y b');
});

test('tokenize leaves sentence punctuation and unbalanced brackets out of the link', () => {
  assert.deepEqual(links('Look at https://x.com/y.'), [['https://x.com/y', 'https://x.com/y']]);
  assert.deepEqual(links('(see https://x.com/y)'), [['https://x.com/y', 'https://x.com/y']]);
  assert.deepEqual(links('https://en.wikipedia.org/wiki/Foo_(bar)'), [['https://en.wikipedia.org/wiki/Foo_(bar)', 'https://en.wikipedia.org/wiki/Foo_(bar)']]);
  assert.deepEqual(links('Try example.com, then stop'), [['example.com', 'https://example.com']]);
});

test('tokenize ignores things that are not links', () => {
  for (const s of ['Reply to Nora about invoice 0142', 'node.js and v2.0 and e.g. nothing', 'foo_bar.com', 'example.community', 'ftp://x.com', 'javascript:alert(1)', 'localhost:3000', '']) {
    assert.deepEqual(links(s), [], s);
  }
  assert.deepEqual(L.tokenize(''), [{ text: '' }]);
});

test('hrefFor only ever returns web or mail addresses', () => {
  assert.equal(L.hrefFor('javascript:alert(1)'), null);
  assert.equal(L.hrefFor('file:///etc/passwd'), null);
  assert.equal(L.hrefFor('https://a.co'), 'https://a.co');
  assert.equal(L.hrefFor('a@b.co'), 'mailto:a@b.co');
});

test('firstLink gives the first link or null', () => {
  assert.equal(L.firstLink('read slate.lt and figma.com'), 'https://slate.lt');
  assert.equal(L.firstLink('nothing here'), null);
});

// ---- calendar dates ----
test('monthGrid is six Monday-first weeks around the month', () => {
  const g = D.monthGrid('2026-10-27');
  assert.equal(g.length, 42);
  assert.equal(g[0], '2026-09-28'); // Monday before Thu 1 Oct
  assert.equal(g[3], '2026-10-01');
  assert.equal(g[33], '2026-10-31');
  assert.equal(g[41], '2026-11-08');
  assert.equal(D.monthGrid('2024-01-15')[0], '2024-01-01'); // 1 Jan 2024 is a Monday
  assert.deepEqual(D.monthGrid('nope'), []);
});

test('addMonths clamps to the end of a shorter month and crosses years', () => {
  assert.equal(D.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(D.addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(D.addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(D.addMonths('2026-01-15', -1), '2025-12-15');
  assert.equal(D.addMonths('2026-10-27', 12), '2027-10-27');
});

test('weekday index, month label and date labels', () => {
  assert.equal(D.weekdayIndex('2026-10-26'), 0); // Monday
  assert.equal(D.weekdayIndex('2026-11-01'), 6); // Sunday
  assert.equal(D.monthLabel('2026-10-27'), 'October 2026');
  assert.equal(D.shortDate('2026-10-29'), 'Thu 29 Oct');
  assert.equal(D.longDate('2026-10-29'), 'Thursday 29 October 2026');
  assert.equal(D.sameMonth('2026-10-01', '2026-10-31'), true);
  assert.equal(D.sameMonth('2026-10-31', '2026-11-01'), false);
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

test('the last list tab is remembered, and a bad one falls back to Today', () => {
  assert.equal(S.clean({ filter: 'open' }).filter, 'open');
  assert.equal(S.clean({ filter: 'nope' }).filter, 'today');
  assert.equal(S.clean(null).filter, 'today');
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
