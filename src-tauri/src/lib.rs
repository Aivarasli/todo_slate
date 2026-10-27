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
    let quick_add = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    let show_hide = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyT);
    let click_through = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyC);

    tauri::Builder::default()
        // Remember where the window sits. Size is not restored, so a collapsed strip never comes back stuck.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION)
                .with_denylist(&["quickadd"])
                .build(),
        )
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
        .invoke_handler(tauri::generate_handler![clickthrough_changed])
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
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
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
