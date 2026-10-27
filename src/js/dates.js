// Date helpers. All dates are local calendar dates as "YYYY-MM-DD" strings,
// which compare correctly as plain strings.

const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, day = +m[3];
  const d = new Date(y, mo, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
  return d;
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// Whole days from b to a (a - b). Uses UTC arithmetic so daylight saving never skews it.
export function diffDays(a, b) {
  const da = parseISO(a), db = parseISO(b);
  if (!da || !db) return 0;
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ua - ub) / 86400000);
}

// The next Monday strictly after `iso`.
export function nextMonday(iso) {
  const d = parseISO(iso);
  if (!d) return null;
  const add = ((8 - d.getDay()) % 7) || 7;
  return addDays(iso, add);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW_LT = ['Sekmadienis', 'Pirmadienis', 'Antradienis', 'Trečiadienis', 'Ketvirtadienis', 'Penktadienis', 'Šeštadienis'];
const MON_LT = ['sausio', 'vasario', 'kovo', 'balandžio', 'gegužės', 'birželio', 'liepos', 'rugpjūčio', 'rugsėjo', 'spalio', 'lapkričio', 'gruodžio'];

// "Overdue 3 d", "Today", "14:00", "Tomorrow", "Thu 29 Oct"
export function formatDue(due, today, time) {
  if (!parseISO(due)) return '';
  const n = diffDays(due, today);
  if (n < 0) return `Overdue ${-n} d`;
  if (n === 0) return time || 'Today';
  const base = n === 1 ? 'Tomorrow' : (() => { const d = parseISO(due); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; })();
  return time ? `${base} ${time}` : base;
}

export function datelineEN(d) {
  return `${DOW_FULL[d.getDay()]}, ${d.getDate()} ${MON_FULL[d.getMonth()]}`;
}

// The Lithuanian date line is part of how Slate speaks: it is always shown.
export function datelineLT(d) {
  return `${DOW_LT[d.getDay()]}, ${MON_LT[d.getMonth()]} ${d.getDate()} d.`;
}
