// The only file that talks to Tauri. Every call is guarded, so the same frontend
// also runs in a plain browser (for development and tests), where these do nothing.
const T = globalThis.__TAURI__;

export const inTauri = !!T;

const win = () => T.window.getCurrentWindow();

async function guard(fn) {
  if (!T) return undefined;
  try {
    return await fn();
  } catch (e) {
    console.warn('[native]', e);
    return undefined;
  }
}

export const native = {
  inTauri,
  setOnTop: (on) => guard(() => win().setAlwaysOnTop(on)),
  setAllWorkspaces: (on) => guard(() => win().setVisibleOnAllWorkspaces(on)),
  setClickThrough: (on) => guard(() => win().setIgnoreCursorEvents(on)),
  resize: (w, h) => guard(() => win().setSize(new T.dpi.LogicalSize(w, h))),
  // Glides the window to a new size, one setSize per frame, each waiting for the last.
  // `alive()` lets a newer move cancel this one.
  async glide(from, to, ms, alive) {
    if (!T || !from) return this.resize(to.w, to.h);
    const t0 = performance.now();
    for (;;) {
      if (!alive()) return false;
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      await this.resize(Math.round(from.w + (to.w - from.w) * e), Math.round(from.h + (to.h - from.h) * e));
      if (k >= 1) return true;
      await new Promise((r) => requestAnimationFrame(r));
    }
  },
  hide: () => guard(() => win().hide()),
  emit: (name, payload) => guard(() => T.event.emit(name, payload)),
  invoke: (cmd, args) => guard(() => T.core.invoke(cmd, args)),
  // Like invoke, but errors reach the caller (folder storage needs to know when something failed).
  call: (cmd, args) => (T ? T.core.invoke(cmd, args) : Promise.reject(new Error('not in the app'))),
  // A native folder chooser. Resolves with the path, or null when cancelled.
  pickFolder: () => guard(async () => {
    const r = await T.dialog.open({ directory: true, multiple: false, title: 'Choose a folder to keep your tasks in' });
    return typeof r === 'string' ? r : null;
  }),
  async listen(name, cb) {
    return guard(() => T.event.listen(name, cb));
  },
  // Whether the pointer is over this window. A window that is not focused may not get hover
  // events from the webview, so the strip asks the system instead.
  async pointerOver() {
    return guard(async () => {
      const w = win();
      const [c, p, s] = await Promise.all([w.cursorPosition(), w.outerPosition(), w.outerSize()]);
      return c.x >= p.x && c.x < p.x + s.width && c.y >= p.y && c.y < p.y + s.height;
    });
  },
  async logicalSize() {
    return guard(async () => {
      const s = await win().innerSize();
      const f = await win().scaleFactor();
      return { w: Math.round(s.width / f), h: Math.round(s.height / f) };
    });
  },
  // Links open in the default browser or mail app. Only http(s) and mailto are ever passed on.
  async openUrl(url) {
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return;
    if (!T) { globalThis.open && globalThis.open(url, '_blank', 'noopener,noreferrer'); return; }
    await guard(() => T.core.invoke('open_url', { url }));
  },
  version: () => guard(() => T.app.getVersion()),
  // Open at login, through the autostart plugin's own commands.
  autostartEnabled: () => guard(() => T.core.invoke('plugin:autostart|is_enabled')),
  setAutostart: (on) => guard(() => T.core.invoke(on ? 'plugin:autostart|enable' : 'plugin:autostart|disable')),
};
