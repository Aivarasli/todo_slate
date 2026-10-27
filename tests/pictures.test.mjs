import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/js/pictures.js';
import * as L from '../src/js/logic.js';

const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const img = (id = 'p1') => ({ id, w: 1280, h: 720, bytes: 30000, thumb: THUMB });

test('fitSize fits landscape into 1280x720 and portrait into 720x1280', () => {
  assert.deepEqual(P.fitSize(4000, 3000), { w: 960, h: 720 });
  assert.deepEqual(P.fitSize(6000, 2000), { w: 1280, h: 427 });
  assert.deepEqual(P.fitSize(3000, 4000), { w: 720, h: 960 });
  assert.deepEqual(P.fitSize(1000, 3000), { w: 427, h: 1280 });
  assert.deepEqual(P.fitSize(2000, 2000), { w: 720, h: 720 });
});

test('fitSize never enlarges', () => {
  assert.deepEqual(P.fitSize(800, 600), { w: 800, h: 600 });
  assert.deepEqual(P.fitSize(1280, 720), { w: 1280, h: 720 });
  assert.deepEqual(P.fitSize(0, 0), { w: 1, h: 1 });
});

test('isImage accepts pictures and refuses everything else', () => {
  assert.ok(P.isImage({ type: 'image/png', name: 'a.png' }));
  assert.ok(P.isImage({ type: 'image/heic', name: 'a.heic' }));
  assert.ok(P.isImage({ type: '', name: 'photo.JPG' }));
  assert.ok(!P.isImage({ type: 'image/svg+xml', name: 'a.svg' }));
  assert.ok(!P.isImage({ type: 'application/pdf', name: 'a.pdf' }));
  assert.ok(!P.isImage({ type: '', name: 'notes.txt' }));
  assert.ok(!P.isImage(null));
});

test('titleFromName and formatBytes', () => {
  assert.equal(P.titleFromName('Fenn_moodboard-v3.png'), 'Fenn moodboard v3');
  assert.equal(P.titleFromName('.png'), '');
  assert.equal(P.formatBytes(27020), '26 KB');
  assert.equal(P.formatBytes(3.5 * 1024 * 1024), '3.5 MB');
});

test('setImage attaches, replaces and removes without touching other tasks', () => {
  const a = L.createTask({ title: 'A' });
  const b = L.createTask({ title: 'B' });
  const t1 = L.setImage([a, b], a.id, img('x'));
  assert.equal(t1[0].img.id, 'x');
  assert.equal(t1[1], b);
  const t2 = L.setImage(t1, a.id, img('y'));
  assert.equal(t2[0].img.id, 'y');
  const t3 = L.setImage(t2, a.id, null);
  assert.ok(!('img' in t3[0]));
  assert.deepEqual([...L.imageIds(t2)], ['y']);
});

test('pictures survive normalize; damaged ones are dropped, the task stays', () => {
  const a = L.createTask({ title: 'A', img: img('keep') });
  const out = L.normalize({ tasks: [a, { id: 'z', title: 'Z', img: { id: 'q', w: 1, h: 1, thumb: 'javascript:alert(1)' } }, { id: 'y', title: 'Y', img: 'nope' }] });
  assert.equal(out.tasks[0].img.id, 'keep');
  assert.ok(!('img' in out.tasks[1]));
  assert.ok(!('img' in out.tasks[2]));
  assert.equal(out.tasks.length, 3);
});

test('tasks without pictures keep their old shape', () => {
  const t = L.createTask({ title: 'Plain' });
  assert.ok(!('img' in t));
});
