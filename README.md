# Slate Tasks

A quiet, always-on-top to-do list for Mac, in the look of [Slate](https://github.com/Aivarasli/slate).
Local only: no account, no tracking, no network.

## What it does

- **Stays on top** of other windows, on every desktop. Toggle it with the `On top` pill.
- **Click-through.** Clicks pass to the windows underneath. It always starts off, and you can turn it off three ways: `Opt Shift C`, the menu bar icon, or by relaunching.
- **Opacity** from 30% to 100%, so the list can sit over your work.
- **Quick add.** `Opt Space` opens a small bar anywhere: type, press Enter, done.
- **Collapse** to a one-line strip showing your next task, manually or after 10 seconds idle.
- Today / All / Done views, overdue first, with the Lithuanian date line Slate always shows.
- Light and dark, following the system.

### Shortcuts

| Keys | Does |
| --- | --- |
| `Opt Space` | Quick add, from anywhere |
| `Opt Shift T` | Show or hide the list |
| `Opt Shift C` | Turn click-through on or off |
| `N` or `/` | Focus the add field |
| `Space` or `X` on a row | Mark done |
| `Enter` on a row | Edit the title (or double-click) |
| `D` on a row | Change the date |
| `Backspace` on a row | Delete (Cmd Z or Undo brings it back) |
| `Alt Up / Down` on a row | Move it within its group (or drag) |

If another app already owns a shortcut, Slate Tasks still starts; that shortcut is just not registered.

## Install

Every push builds a universal `.dmg` (Apple silicon and Intel) in GitHub Actions: open the latest run under **Actions**, download the `slate-tasks-macos` artifact, open the `.dmg` and drag the app to Applications.

The app is not signed or notarised yet, so macOS will refuse the first launch. Right-click the app, choose **Open**, then **Open** again. Or run:

```sh
xattr -cr "/Applications/Slate Tasks.app"
```

## Develop

Needs [Rust](https://rustup.rs) and Node 22+.

```sh
npm install      # installs the Tauri CLI
npm run dev      # runs the app
npm run build    # builds the .app and .dmg into src-tauri/target/release/bundle
npm test         # unit tests, no dependencies
```

The interface is plain HTML, CSS and ES modules in `src/`, with no build step and no runtime dependencies.
To work on it in a browser without Tauri, run `npm run serve` and open http://localhost:5173. Every native call is guarded and does nothing there.

```
src/js/logic.js     tasks and grouping (pure, tested)
src/js/dates.js     dates and the Lithuanian date line (pure, tested)
src/js/store.js     persistence, with a backup when stored data is damaged
src/js/settings.js  settings; click-through is deliberately never saved
src/js/native.js    the only file that talks to Tauri
src/js/app.js       the list, settings and collapsed strip
src/js/quickadd.js  the quick-add bar
src-tauri/          window, global shortcuts, menu bar icon, open at login
```

## Notes

- Tasks live in the app's local storage on this Mac. A damaged store is kept aside under a `slate-tasks:v1:backup:` key before anything is overwritten.
- Opacity uses a transparent window, which on macOS needs Tauri's `macos-private-api`. That rules out the Mac App Store, and does not matter for a downloaded app.
- Fonts (Funnel Display, Funnel Sans, Martian Mono) are self-hosted under the SIL Open Font License 1.1. See `src/fonts/OFL.txt`.
