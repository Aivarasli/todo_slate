// Tiny element builder. Text is always inserted as text nodes, never as HTML,
// so a task title can never inject markup.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function checkIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M2.5 6.3 5 8.7 9.5 3.6');
  svg.append(p);
  return svg;
}

// A thin chevron: dir -1 points left, 1 points right.
export function chevron(dir) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', dir < 0 ? 'M7.5 2.5 4 6l3.5 3.5' : 'M4.5 2.5 8 6 4.5 9.5');
  svg.append(p);
  return svg;
}

// A small x, for the delete button.
export function crossIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M3.5 3.5 8.5 8.5M8.5 3.5 3.5 8.5');
  svg.append(p);
  return svg;
}

// A short dash, for the Windows minimize button.
export function minusIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M3 6h6');
  svg.append(p);
  return svg;
}

// DOM append() turns null, undefined and false into the words "null", "undefined" and "false".
// Optional children are written as `cond ? node : null` all over the app, so drop the empty ones here
// once, for every append and prepend, instead of trusting each call site.
if (typeof Element !== 'undefined') {
  for (const proto of [Element.prototype, DocumentFragment.prototype]) {
    for (const name of ['append', 'prepend']) {
      const orig = proto[name];
      proto[name] = function (...kids) { return orig.apply(this, kids.filter((k) => k != null && k !== false)); };
    }
  }
}
