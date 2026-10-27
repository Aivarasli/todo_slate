// Pointer-driven reordering inside one list. While a row is dragged the others slide aside
// to make room; on release the caller re-renders and the row settles into its slot.
// This replaces the browser's drag and drop, which cannot animate the rows around the drag.
let active = false;
export const isReordering = () => active;

const THRESHOLD = 5; // px of movement before a press becomes a drag, so plain clicks still tick tasks
const EDGE = 36; // px from the list's edge where dragging starts to scroll it

// Stops the click that follows a drag from ticking the task under the pointer.
function swallowClick() {
  const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', stop, true);
  setTimeout(() => window.removeEventListener('click', stop, true), 60);
}

// onDrop receives null when the drag was cancelled, otherwise
// { id, before, lastId, changed }: `before` is the id of the row it now sits above (null when last),
// `lastId` the id of the last other row in the list.
export function wireReorder(li, { scroller, onDrop }) {
  li.addEventListener('pointerdown', (e) => {
    if (active || e.button !== 0 || e.isPrimary === false) return;
    if (e.target.closest('button, a, input, textarea, select, .datebar')) return;
    const list = li.parentElement;
    const rows = [...list.children].filter((r) => r.classList.contains('row') && !r.classList.contains('editing'));
    const from = rows.indexOf(li);
    if (from < 0 || rows.length < 2) return;

    const pid = e.pointerId;
    const startY = e.clientY;
    const startScroll = scroller.scrollTop;
    let lastY = startY;
    let started = false;
    let raf = 0;
    let geo = null;
    let target = from;

    const frame = () => {
      raf = 0;
      if (!started) return;
      const sr = scroller.getBoundingClientRect();
      const atEdge = lastY < sr.top + EDGE || lastY > sr.bottom - EDGE;
      if (lastY < sr.top + EDGE) scroller.scrollTop -= Math.ceil((sr.top + EDGE - lastY) / 3);
      else if (lastY > sr.bottom - EDGE) scroller.scrollTop += Math.ceil((lastY - (sr.bottom - EDGE)) / 3);

      const last = geo.length - 1;
      const lo = geo[0].top - geo[from].top;
      const hi = geo[last].top + geo[last].h - geo[from].top - geo[from].h;
      const dy = Math.max(lo, Math.min(hi, (lastY - startY) + (scroller.scrollTop - startScroll)));
      li.style.transform = `translateY(${dy}px)`;

      // Where it would land. A row above stays above until the dragged row's top edge crosses its middle;
      // a row below moves above once the dragged row's bottom edge passes its middle. Using the edges
      // (not the dragged row's own middle) lets tall rows, such as two-line titles, reach the very top.
      const top = geo[from].top + dy;
      const bottom = top + geo[from].h;
      let j = 0;
      for (let i = 0; i < rows.length; i++) {
        if (i === from) continue;
        const mid = geo[i].top + geo[i].h / 2;
        if (i < from ? top >= mid : bottom > mid) j++;
      }
      target = j;

      let k = 0; // position among the other rows
      for (let i = 0; i < rows.length; i++) {
        if (i === from) continue;
        let shift = 0;
        if (i > from && k < j) shift = -geo[from].h; // slides up into the gap it left
        else if (i < from && k >= j) shift = geo[from].h; // slides down to make room
        rows[i].style.transform = shift ? `translateY(${shift}px)` : '';
        k++;
      }
      if (atEdge) raf = requestAnimationFrame(frame); // keep scrolling while held at the edge
    };
    const tick = () => { if (!raf) raf = requestAnimationFrame(frame); };

    const begin = () => {
      started = true;
      active = true;
      geo = rows.map((r) => { const b = r.getBoundingClientRect(); return { top: b.top + scroller.scrollTop, h: b.height }; });
      li.classList.add('dragging');
      list.classList.add('reordering');
      document.body.classList.add('reordering');
      try { li.setPointerCapture(pid); } catch { /* the window listeners still work */ }
    };

    const onMove = (ev) => {
      if (ev.pointerId !== pid) return;
      lastY = ev.clientY;
      if (!started) {
        if (Math.abs(lastY - startY) < THRESHOLD) return;
        begin();
      }
      tick();
    };

    const detach = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
    };

    const finish = (keep) => {
      detach();
      if (raf) cancelAnimationFrame(raf);
      if (!started) return;
      active = false;
      document.body.classList.remove('reordering');
      swallowClick();
      if (!keep) { onDrop(null); return; }
      const others = rows.filter((r) => r !== li);
      onDrop({
        id: li.dataset.id,
        before: target < others.length ? others[target].dataset.id : null,
        lastId: others[others.length - 1].dataset.id,
        changed: target !== from,
      });
    };

    const onUp = (ev) => { if (ev.pointerId === pid) finish(true); };
    const onCancel = (ev) => { if (ev.pointerId === pid) finish(false); };
    const onKey = (ev) => { if (ev.key === 'Escape' && started) { ev.preventDefault(); ev.stopPropagation(); finish(false); } };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  });
}
