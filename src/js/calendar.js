// A small month calendar in the Slate style, used instead of the system date picker.
// It owns only its own view (which month is showing, which day has focus). The caller
// gets `onPick(iso)` and `onClose()`.
import { h, clear, chevron } from './dom.js';
import * as D from './dates.js';

export function createCalendar({ value, today, onPick, onClose }) {
  let focus = D.parseISO(value) ? value : today; // the day that has keyboard focus
  let shown = focus; // any day inside the month on screen

  const title = h('h3', { class: 'cal-title', 'aria-live': 'polite' });
  const grid = h('div', { class: 'cal-grid', role: 'grid' });
  const root = h('div', { class: 'cal', role: 'group', 'aria-label': 'Choose a date' });

  const navBtn = (dir, label) => h('button', {
    class: 'cal-nav', type: 'button', 'aria-label': label,
    onClick: () => { shown = D.addMonths(shown, dir); focus = D.addMonths(focus, dir); draw(false); },
  }, chevron(dir));

  root.append(
    h('div', { class: 'cal-head' },
      title,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn quiet cal-today', type: 'button', onClick: () => { shown = today; focus = today; draw(false); } }, 'Today'),
      navBtn(-1, 'Previous month'), navBtn(1, 'Next month')),
    h('div', { class: 'cal-dow', 'aria-hidden': 'true' }, D.WEEKDAYS_MIN.map((d) => h('span', null, d))),
    grid);

  function draw(takeFocus) {
    title.textContent = D.monthLabel(shown);
    clear(grid);
    const cells = D.monthGrid(shown);
    for (const iso of cells) {
      const day = Number(iso.slice(8));
      const inMonth = D.sameMonth(iso, shown);
      const cls = 'day' + (inMonth ? '' : ' out') + (iso === today ? ' today' : '') + (iso === value ? ' sel' : '') + (iso < today ? ' past' : '');
      grid.append(h('button', {
        class: cls, type: 'button', 'data-date': iso, tabindex: iso === focus ? '0' : '-1',
        'aria-pressed': String(iso === value), 'aria-current': iso === today ? 'date' : null,
        'aria-label': D.longDate(iso) + (iso === today ? ', today' : ''),
        onClick: () => onPick(iso),
      }, String(day)));
    }
    if (takeFocus) {
      const el = grid.querySelector(`[data-date="${focus}"]`);
      if (el) el.focus();
    }
  }

  const move = (iso) => {
    focus = iso;
    if (!D.sameMonth(iso, shown)) shown = iso;
    draw(true);
  };

  root.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (!e.target.classList || !e.target.classList.contains('day')) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[k];
    if (step) { e.preventDefault(); move(D.addDays(focus, step)); }
    else if (k === 'PageUp' || k === 'PageDown') { e.preventDefault(); move(D.addMonths(focus, (k === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1))); }
    else if (k === 'Home') { e.preventDefault(); move(D.addDays(focus, -D.weekdayIndex(focus))); }
    else if (k === 'End') { e.preventDefault(); move(D.addDays(focus, 6 - D.weekdayIndex(focus))); }
    else if (k === 't') { e.preventDefault(); move(today); }
  });

  draw(false);
  root.focusDay = () => draw(true);
  return root;
}
