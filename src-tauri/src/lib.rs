mod sync;

use serde::Serialize;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_window_state::StateFlags;

/// Keeps the tray's "Click-through" tick in step with the window, whichever way it was toggled.
struct TrayState {
    clickthrough: CheckMenuItem<tauri::Wry>,
}

#[tauri::command]
fn clickthrough_changed(state: State<'_, TrayState>, on: bool) {
    let _ = state.clickthrough.set_checked(on);
}

// Opens a link from a task in the default browser or mail app. Only web and mail links are
// accepted, and the address is passed as a single argument, never through a shell.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    let allowed = lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:");
    if !allowed || url.len() > 2048 || url.chars().any(|c| c.is_control()) {
        return Err("unsupported link".into());
    }
    std::thread::spawn(move || {
        let _ = open_in_default_app(&url);
    });
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_in_default_app(url: &str) -> std::io::Result<std::process::ExitStatus> {
    std::process::Command::new("open").arg(url).status()
}

// rundll32 takes the address as one argument and never goes through cmd.exe, so `&` or `^` in a link is harmless.
#[cfg(target_os = "windows")]
fn open_in_default_app(url: &str) -> std::io::Result<std::process::ExitStatus> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(url)
        .creation_flags(CREATE_NO_WINDOW)
        .status()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn open_in_default_app(url: &str) -> std::io::Result<std::process::ExitStatus> {
    std::process::Command::new("xdg-open").arg(url).status()
}

// ---------- folder storage (see sync.rs) ----------
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatOut {
    exists: bool,
    mtime_ms: u64,
    len: u64,
}

impl From<sync::Stat> for StatOut {
    fn from(s: sync::Stat) -> Self {
        StatOut { exists: s.exists, mtime_ms: s.mtime_ms, len: s.len }
    }
}

#[tauri::command]
async fn sync_stat(dir: String) -> Result<StatOut, String> {
    sync::tasks_stat(&dir).map(Into::into)
}

#[tauri::command]
async fn sync_read(dir: String) -> Result<Option<String>, String> {
    sync::read_tasks(&dir)
}

#[tauri::command]
async fn sync_write(dir: String, text: String) -> Result<StatOut, String> {
    sync::write_tasks(&dir, &text).map(Into::into)
}

#[tauri::command]
async fn sync_extras(dir: String) -> Result<Vec<String>, String> {
    sync::list_extras(&dir)
}

#[tauri::command]
async fn sync_read_extra(dir: String, name: String) -> Result<Option<String>, String> {
    sync::read_extra(&dir, &name)
}

#[tauri::command]
async fn sync_remove_extra(dir: String, name: String) -> Result<(), String> {
    sync::remove_extra(&dir, &name)
}

#[tauri::command]
async fn pic_write(dir: String, id: String, data: String) -> Result<(), String> {
    sync::write_picture(&dir, &id, &data)
}

#[tauri::command]
async fn pic_read(dir: String, id: String) -> Result<Option<String>, String> {
    sync::read_picture(&dir, &id)
}

#[tauri::command]
async fn pic_list(dir: String) -> Result<Vec<(String, u64)>, String> {
    sync::list_pictures(&dir)
}

#[tauri::command]
async fn pic_remove(dir: String, id: String) -> Result<(), String> {
    sync::remove_picture(&dir, &id)
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

fn show_quick_add(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quickadd") {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to("quickadd", "quickadd-open", ());
    }
}

// Asks the list window to flip click-through. The window owns the state, so a shortcut
// or the tray can always turn it off, even when the window itself ignores the mouse.
fn toggle_clickthrough(app: &AppHandle) {
    let _ = app.emit_to("main", "toggle-clickthrough", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // On Windows Alt Space belongs to the window menu and Alt Shift switches keyboard layouts,
    // so the global keys use Ctrl Alt there.
    #[cfg(target_os = "windows")]
    let (quick_add, show_hide, click_through) = {
        let m = Modifiers::CONTROL | Modifiers::ALT;
        (
            Shortcut::new(Some(m), Code::Space),
            Shortcut::new(Some(m), Code::KeyT),
            Shortcut::new(Some(m), Code::KeyC),
        )
    };
    #[cfg(not(target_os = "windows"))]
    let (quick_add, show_hide, click_through) = (
        Shortcut::new(Some(Modifiers::ALT), Code::Space),
        Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyT),
        Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyC),
    );

    tauri::Builder::default()
        // Remember where the window sits. Size is not restored, so a collapsed strip never comes back stuck.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION)
                .with_denylist(&["quickadd"])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut == &quick_add {
                        show_quick_add(app);
                    } else if shortcut == &show_hide {
                        toggle_main(app);
                    } else if shortcut == &click_through {
                        toggle_clickthrough(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            clickthrough_changed,
            open_url,
            sync_stat,
            sync_read,
            sync_write,
            sync_extras,
            sync_read_extra,
            sync_remove_extra,
            pic_write,
            pic_read,
            pic_list,
            pic_remove
        ])
        .setup(move |app| {
            // A shortcut another app already owns must not stop Slate Tasks from starting.
            for s in [quick_add, show_hide, click_through] {
                if let Err(e) = app.global_shortcut().register(s) {
                    eprintln!("could not register shortcut {s:?}: {e}");
                }
            }

            let toggle = MenuItem::with_id(app, "toggle", "Show or hide", true, None::<&str>)?;
            let click_item = CheckMenuItem::with_id(
                app,
                "clickthrough",
                "Click-through",
                true,
                false,
                None::<&str>,
            )?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = PredefinedMenuItem::quit(app, Some("Quit Slate Tasks"))?;
            let menu = Menu::with_items(app, &[&toggle, &click_item, &sep, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_main(app),
                    "clickthrough" => toggle_clickthrough(app),
                    _ => {}
                });
            // A plain "S_" with no background, drawn as a template image so macOS tints it for
            // light and dark menu bars like every other menu bar app. Falls back to the app icon.
            #[cfg(target_os = "macos")]
            match tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png")) {
                Ok(icon) => tray = tray.icon(icon).icon_as_template(true),
                Err(_) => {
                    if let Some(icon) = app.default_window_icon() {
                        tray = tray.icon(icon.clone());
                    }
                }
            }
            // The taskbar tray has no template images: it shows the coloured app icon.
            #[cfg(not(target_os = "macos"))]
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone()).tooltip("Slate Tasks");
            }
            tray.build(app)?;

            app.manage(TrayState {
                clickthrough: click_item,
            });
            Ok(())
        })
        // Closing the list hides it instead of quitting: the shortcut and the menu bar icon bring it back.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Slate Tasks");
}
