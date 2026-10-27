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
  hide: () => guard(() => win().hide()),
  emit: (name, payload) => guard(() => T.event.emit(name, payload)),
  invoke: (cmd, args) => guard(() => T.core.invoke(cmd, args)),
  async listen(name, cb) {
    return guard(() => T.event.listen(name, cb));
  },
  async logicalSize() {
    return guard(async () => {
      const s = await win().innerSize();
      const f = await win().scaleFactor();
      return { w: Math.round(s.width / f), h: Math.round(s.height / f) };
    });
  },
  // Open at login, through the autostart plugin's own commands.
  autostartEnabled: () => guard(() => T.core.invoke('plugin:autostart|is_enabled')),
  setAutostart: (on) => guard(() => T.core.invoke(on ? 'plugin:autostart|enable' : 'plugin:autostart|disable')),
};
