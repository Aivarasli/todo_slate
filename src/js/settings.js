import { LANG_CODES } from './dates.js';
// Settings. Click-through is deliberately not stored: the app always starts
// with clicks working, so it can never launch into a state you cannot get out of.
export const KEY = 'slate-tasks:settings';

export const DEFAULTS = Object.freeze({
  onTop: true,
  allWorkspaces: true,
  collapseIdle: false,
  language: 'lt', // second language for the date line: off, or a code from dates.js
  dimCollapsed: true, // fade the collapsed strip
  dimLevel: 70, // percent of normal opacity while collapsed, 30 to 100
  idleSecs: 10, // seconds without focus before collapsing, 1 to 15
  opacity: 100, // percent, 30 to 100
  theme: 'auto', // auto | light | dark
  filter: 'today', // the list tab last used: today | open | all | done
  syncDir: null, // a folder that holds the tasks and pictures (Dropbox, iCloud Drive...), or null for this Mac only
});

export const MIN_OPACITY = 30;
const clampInt = (v, lo, hi, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

export const validDir = (d) => typeof d === 'string' && d.length > 0 && d.length <= 4096 && !d.includes('\0') && /^(\/|[A-Za-z]:[\\/])/.test(d);

export function clean(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const op = Number(r.opacity);
  return {
    onTop: typeof r.onTop === 'boolean' ? r.onTop : DEFAULTS.onTop,
    allWorkspaces: typeof r.allWorkspaces === 'boolean' ? r.allWorkspaces : DEFAULTS.allWorkspaces,
    collapseIdle: typeof r.collapseIdle === 'boolean' ? r.collapseIdle : DEFAULTS.collapseIdle,
    language: typeof r.language === 'string' && LANG_CODES.includes(r.language) ? r.language : DEFAULTS.language,
    dimLevel: clampInt(r.dimLevel, MIN_OPACITY, 100, DEFAULTS.dimLevel),
    idleSecs: clampInt(r.idleSecs, 1, 15, DEFAULTS.idleSecs),
    dimCollapsed: typeof r.dimCollapsed === 'boolean' ? r.dimCollapsed : DEFAULTS.dimCollapsed,
    opacity: Number.isFinite(op) ? Math.min(100, Math.max(MIN_OPACITY, Math.round(op))) : DEFAULTS.opacity,
    theme: ['auto', 'light', 'dark'].includes(r.theme) ? r.theme : DEFAULTS.theme,
    filter: ['today', 'open', 'all', 'done'].includes(r.filter) ? r.filter : DEFAULTS.filter,
    syncDir: validDir(r.syncDir) ? r.syncDir : null,
  };
}

export function load() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(KEY);
    return clean(raw ? JSON.parse(raw) : null);
  } catch {
    return clean(null);
  }
}

export function save(settings) {
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(clean(settings)));
    return true;
  } catch {
    return false;
  }
}

// Applies theme and opacity to the page. Safe to call from any window.
export function apply(settings, doc = globalThis.document) {
  if (!doc) return;
  const root = doc.documentElement;
  if (settings.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
  root.classList.toggle('dim-collapsed', !!settings.dimCollapsed);
  root.style.setProperty('--dim', String(settings.dimLevel / 100));
  root.style.setProperty('--win-opacity', String(settings.opacity / 100));
}
