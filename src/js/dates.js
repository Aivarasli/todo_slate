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

// Same day in another month, clamped to the month's last day (31 Jan + 1 month = 28 or 29 Feb).
export function addMonths(iso, n) {
  const d = parseISO(iso);
  if (!d) return null;
  const day = d.getDate();
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(day, last));
  return toISO(first);
}

// Monday = 0 ... Sunday = 6.
export function weekdayIndex(iso) {
  const d = parseISO(iso);
  return d ? (d.getDay() + 6) % 7 : 0;
}

// The six weeks (42 days, Monday first) that cover the month containing `iso`.
export function monthGrid(iso) {
  const d = parseISO(iso);
  if (!d) return [];
  const first = toISO(new Date(d.getFullYear(), d.getMonth(), 1));
  const start = addDays(first, -weekdayIndex(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export const sameMonth = (a, b) => typeof a === 'string' && typeof b === 'string' && a.slice(0, 7) === b.slice(0, 7);

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

// "Thu 29 Oct" and "Thursday 29 October 2026"
export function shortDate(iso) {
  const d = parseISO(iso);
  return d ? `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` : '';
}
export function longDate(iso) {
  const d = parseISO(iso);
  return d ? `${DOW_FULL[d.getDay()]} ${d.getDate()} ${MON_FULL[d.getMonth()]} ${d.getFullYear()}` : '';
}

// "October 2026"
export function monthLabel(iso) {
  const d = parseISO(iso);
  return d ? `${MON_FULL[d.getMonth()]} ${d.getFullYear()}` : '';
}

// Monday-first two-letter headings for the calendar.
export const WEEKDAYS_MIN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function datelineEN(d) {
  return `${DOW_FULL[d.getDay()]}, ${d.getDate()} ${MON_FULL[d.getMonth()]}`;
}

// The second line under the title, in a language of your choice (Lithuanian unless changed).
export const LANGUAGES = Object.freeze([
  ['lt', 'Lietuvių'], ['lv', 'Latviešu'], ['et', 'Eesti'], ['pl', 'Polski'], ['de', 'Deutsch'], ['fr', 'Français'],
  ['es', 'Español'], ['it', 'Italiano'], ['pt', 'Português'], ['nl', 'Nederlands'], ['sv', 'Svenska'], ['nb', 'Norsk'],
  ['da', 'Dansk'], ['fi', 'Suomi'], ['cs', 'Čeština'], ['sk', 'Slovenčina'], ['hu', 'Magyar'], ['ro', 'Română'],
  ['bg', 'Български'], ['el', 'Ελληνικά'], ['uk', 'Українська'], ['hr', 'Hrvatski'],
]);
export const LANG_CODES = ['off', ...LANGUAGES.map(([c]) => c)];

export function datelineLT(d) {
  return `${DOW_LT[d.getDay()]}, ${MON_LT[d.getMonth()]} ${d.getDate()} d.`;
}

// '' for "off" or when the language is not available on this system.
export function dateline(d, lang) {
  if (lang === 'lt') return datelineLT(d);
  if (!LANG_CODES.includes(lang) || lang === 'off') return '';
  try {
    const s = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
    return s.charAt(0).toLocaleUpperCase(lang) + s.slice(1);
  } catch {
    return '';
  }
}
