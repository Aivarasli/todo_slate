// Settings. Click-through is deliberately not stored: the app always starts
// with clicks working, so it can never launch into a state you cannot get out of.
export const KEY = 'slate-tasks:settings';

export const DEFAULTS = Object.freeze({
  onTop: true,
  allWorkspaces: true,
  collapseIdle: false,
  opacity: 100, // percent, 30 to 100
  theme: 'auto', // auto | light | dark
});

export const MIN_OPACITY = 30;

export function clean(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const op = Number(r.opacity);
  return {
    onTop: typeof r.onTop === 'boolean' ? r.onTop : DEFAULTS.onTop,
    allWorkspaces: typeof r.allWorkspaces === 'boolean' ? r.allWorkspaces : DEFAULTS.allWorkspaces,
    collapseIdle: typeof r.collapseIdle === 'boolean' ? r.collapseIdle : DEFAULTS.collapseIdle,
    opacity: Number.isFinite(op) ? Math.min(100, Math.max(MIN_OPACITY, Math.round(op))) : DEFAULTS.opacity,
    theme: ['auto', 'light', 'dark'].includes(r.theme) ? r.theme : DEFAULTS.theme,
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
  root.style.setProperty('--win-opacity', String(settings.opacity / 100));
}
