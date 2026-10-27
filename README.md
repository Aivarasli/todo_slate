# Slate Tasks

A quiet, always-on-top to-do list for Mac, in the look of [Slate](https://github.com/Aivarasli/slate).
Local only: no account, no tracking, no network.

## What it does

- **Stays on top** of other windows, on every desktop. Toggle it with the `On top` pill.
- **Click-through.** Clicks pass to the windows underneath. It always starts off, and you can turn it off three ways: `Opt Shift C`, the menu bar icon, or by relaunching.
- **Opacity** from 30% to 100%, so the list can sit over your work.
- **Quick add.** `Opt Space` opens a small bar anywhere: type, press Enter, done.
- **Collapse** to a one-line strip showing your next task, manually or after 10 seconds idle.
- **Today / Open / All / Done** views, overdue first, with the Lithuanian date line Slate always shows. *Open* hides everything already ticked off. The tab you used last is remembered.
- **Click a task's title to tick it off.** Hovering the title previews the tick. The tick draws in, the title is struck through, and the row slides out of views it no longer belongs in.
- **Links in a task are clickable.** `https://…`, `www.…`, bare domains like `figma.com/file/…`, and email addresses open in your browser or mail app.
- **Quick delete:** a small x in a circle sits beside every task's date. Undo brings it back.
- **Calendar.** Pick a date from a Slate-styled month calendar that slides up over the list, or use Today, Tomorrow and Next week.
- **Drag to reorder.** Rows slide aside as you drag, and glide into place on every reorder, tick and delete.
- **Pictures on tasks.** Drag an image from Finder onto a task (or paste one with `Cmd V` on a focused task). It is resized to fit 1280×720 (720×1280 for portrait, never enlarged) and shown as a small circle beside the date. Click it for a lightbox; right-click it, or press `Del` in the lightbox, to remove it. Dropping on the Add field makes a new task named after the file. Settings shows how many pictures there are and can remove them all.
- **About** page in Settings.
- Light and dark, following the system.

### Shortcuts

Anywhere:

| Keys | Does |
| --- | --- |
| `Opt Space` | Quick add |
| `Opt Shift T` | Show or hide the list |
| `Opt Shift C` | Turn click-through on or off |

In the list:

| Keys | Does |
| --- | --- |
| `N`, `A` or `/` | Focus the add field |
| `1` `2` `3` `4` | Today, Open, All, Done |
| `[` `]` | Previous or next list |
| `Up` `Down`, `J` `K` | Move between tasks (`Home` `End` for first and last) |
| `Space` or `X` | Tick or untick the task |
| `Enter` or `E` | Edit the title |
| `Backspace` | Delete (`Cmd Z` or Undo brings it back) |
| `Alt Up` / `Alt Down` | Move the task within its group |
| `D` | Open the task bar (dates, edit, delete) |
| `C` | Open the calendar |
| `T` `M` `W` | Due today, tomorrow, next Monday |
| `0` | Clear the date |
| `O` | Open the first link in the task |
| `V` | View the task's picture (`Esc` closes, `Del` removes it) |
| `Cmd V` | Paste a picture from the clipboard onto the task |
| `Cmd ,` | Settings |
| `Cmd .` | Collapse or expand |
| `?` | Show the shortcuts |

In the calendar: arrows move by day and week, `PageUp` `PageDown` by month (with `Shift`, by year), `Home` `End` to the week's ends, `T` for today, `Enter` to choose, `Esc` to close.

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
src/js/calendar.js  the month calendar
src/js/reorder.js   drag to reorder, with rows sliding aside
src/js/pictures.js  resizing dropped images and keeping them in IndexedDB
src/js/app.js       the list, settings, about and collapsed strip
src/js/quickadd.js  the quick-add bar
src-tauri/          window, global shortcuts, menu bar icon, open at login, opening links
```

## Notes

- Tasks live in the app's local storage on this Mac. A damaged store is kept aside under a `slate-tasks:v1:backup:` key before anything is overwritten.
- Opacity uses a transparent window, which on macOS needs Tauri's `macos-private-api`. That rules out the Mac App Store, and does not matter for a downloaded app.
- Pictures are stored as JPEG blobs in IndexedDB (the full image) with a 96 px thumbnail on the task. Files no task uses are removed a few seconds after the undo window closes.
- Links open through a small `open_url` command that only accepts `http`, `https` and `mailto` addresses.
- The app icon is built from Slate's favicon (`src-tauri/icons/icon.svg`) with a soft top light.
- Fonts (Funnel Display, Funnel Sans, Martian Mono) are self-hosted under the SIL Open Font License 1.1. See `src/fonts/OFL.txt`.
