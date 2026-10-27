import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/js/logic.js';

const mk = (id, over = {}) => ({ id, title: id, done: false, doneAt: null, due: null, time: null, createdAt: 1, updatedAt: 1, ord: 0, ...over });
const ids = (ts) => ts.map((t) => t.id).join('');

test('appendTask puts a task last with room to move', () => {
  let ts = [];
  ts = L.appendTask(ts, mk('a')); ts = L.appendTask(ts, mk('b')); ts = L.appendTask(ts, mk('c'));
  assert.deepEqual(ts.map((t) => t.ord), [0, 1000, 2000]);
});

test('every edit stamps updatedAt later than before, even with a stuck clock', () => {
  let ts = [mk('a', { updatedAt: 5000 })];
  ts = L.toggleDone(ts, 'a', 10);
  assert.equal(ts[0].updatedAt, 5001);
  ts = L.renameTask(ts, 'a', 'x');
  assert.ok(ts[0].updatedAt > 5001);
  ts = L.setDue(ts, 'a', '2026-10-27');
  ts = L.setImage(ts, 'a', null);
  assert.ok(ts[0].updatedAt > 5002);
});

test('moveBefore changes only the moved task and keeps positions sorted', () => {
  const a = [mk('a', { ord: 0 }), mk('b', { ord: 1000 }), mk('c', { ord: 2000 })];
  const out = L.moveBefore(a, 'c', 'b', 9);
  assert.equal(ids(out), 'acb'.replace('acb', 'acb') && 'acb');
  assert.equal(out[0], a[0]); // untouched object
  assert.equal(out[2], a[1]);
  assert.equal(out[1].ord, 500);
  assert.ok(out[1].updatedAt >= 9);
  assert.equal(ids(L.moveBefore(a, 'c', 'a')), 'cab');
  assert.equal(L.moveBefore(a, 'c', 'a')[0].ord, -1000);
  assert.equal(ids(L.moveBefore(a, 'a', null)), 'bca');
  assert.equal(L.moveBefore(a, 'a', null)[2].ord, 3000);
});

test('moveBefore renumbers when a gap is used up', () => {
  const a = [mk('a', { ord: 1 }), mk('b', { ord: 1 + Number.EPSILON }), mk('c', { ord: 5 })];
  const out = L.moveBefore(a, 'c', 'b');
  assert.equal(ids(out), 'acb');
  assert.deepEqual(out.map((t) => t.ord), [0, 1000, 2000]);
});

test('normalize gives old lists positions and sorts new ones', () => {
  const old = L.normalize({ tasks: [{ id: 'x', title: 'x' }, { id: 'y', title: 'y' }] }).tasks;
  assert.deepEqual(old.map((t) => t.ord), [0, 1000]);
  assert.ok(Number.isFinite(old[0].updatedAt));
  const sorted = L.normalize({ tasks: [mk('b', { ord: 20 }), mk('a', { ord: 10 })] }).tasks;
  assert.equal(ids(sorted), 'ab');
});

test('merge: newest edit per task wins, both sides keep their own changes', () => {
  const a = { tasks: [mk('1', { title: 'one A', updatedAt: 10, ord: 0 }), mk('2', { ord: 1000, updatedAt: 5 })], deleted: {} };
  const b = { tasks: [mk('1', { title: 'one B', updatedAt: 7, ord: 0 }), mk('2', { title: 'two B', ord: 1000, updatedAt: 9 })], deleted: {} };
  const m = L.mergeStores(a, b);
  assert.equal(m.tasks.find((t) => t.id === '1').title, 'one A');
  assert.equal(m.tasks.find((t) => t.id === '2').title, 'two B');
  assert.deepEqual(L.mergeStores(b, a, 100).tasks.map((t) => t.title), m.tasks.map((t) => t.title)); // same either way round
});

test('merge: tasks added on either side are all kept, in position order', () => {
  const a = { tasks: [mk('a', { ord: 0 }), mk('c', { ord: 2000 })], deleted: {} };
  const b = { tasks: [mk('a', { ord: 0 }), mk('b', { ord: 1000 })], deleted: {} };
  assert.equal(ids(L.mergeStores(a, b).tasks), 'abc');
});

test('merge: a delete beats an older copy, but not a later edit', () => {
  const now = Date.now();
  const alive = { tasks: [mk('1', { updatedAt: now - 5000 })], deleted: {} };
  const gone = { tasks: [], deleted: { 1: now - 1000 } };
  assert.equal(L.mergeStores(alive, gone, now).tasks.length, 0);
  assert.equal(L.mergeStores(gone, alive, now).tasks.length, 0);
  const edited = { tasks: [mk('1', { updatedAt: now })], deleted: {} };
  const m = L.mergeStores(edited, gone, now);
  assert.equal(m.tasks.length, 1);
  assert.equal(m.deleted['1'], undefined);
});

test('delete then undo survives a merge with the other machine', () => {
  const now = Date.now();
  const before = [mk('1', { updatedAt: now - 9000 })];
  let deleted = L.trackDeleted({}, before, [], now - 4000);
  assert.deepEqual(Object.keys(deleted), ['1']);
  const revived = L.revive(before, [], now - 2000);
  deleted = L.trackDeleted(deleted, [], revived, now - 2000);
  assert.deepEqual(deleted, {});
  const other = { tasks: before, deleted: {} };
  assert.equal(L.mergeStores({ tasks: revived, deleted }, other, now).tasks.length, 1);
});

test('old delete markers are dropped', () => {
  const now = Date.now();
  const d = L.cleanDeleted({ a: now - 46 * 864e5, b: now - 1000, c: 'x', '': 5 }, now);
  assert.deepEqual(Object.keys(d), ['b']);
});

test('sameTasks compares by value', () => {
  assert.ok(L.sameTasks([mk('a')], [mk('a')]));
  assert.ok(!L.sameTasks([mk('a')], [mk('a', { title: 'z' })]));
  assert.ok(!L.sameTasks([mk('a')], []));
});
