# pake-app

Generate Pake apps with Mac-style editing shortcuts.
The symlink-safe shim lives in `cmdwise-web/bin/pake-app`; Python needs no extra packages.

```sh
pake-app https://mattermost.awful.club --name mattermost.awful.club \
  --output ~/Applications/mattermost.awful.club --force

~/Applications/mattermost.awful.club/mattermost-awful-club-binary
```

- Uses `pake` on PATH, otherwise `npx pake-cli` (may download/prompt).
  `--pake` overrides this with one executable, not a shell command.
- Linux builds a user-owned executable; macOS/Windows keep native packaging.
  Build prerequisites: Node/Rust and platform libraries; Linux runtime needs GTK/WebKit.
- `--generate-only` skips compilation; `--force` replaces generated config/injection.
  Regenerate after moving the output directory; injection paths are absolute.
- `--targets rpm` / `--targets appimage` or `--bundle` enables Linux packaging.
  RPMs can inherit restrictive cached asset modes; raw executables avoid that issue.
- See `pake-app --help` for icon, size, identifier, and activation options.
  Desktop launcher entries are not installed automatically.

## Shortcuts

Linux/Windows injection only; macOS keeps native editing and menus.
Command means Meta/Super; Option means Alt.

| Shortcut                      | Action                                                     |
| ----------------------------- | ---------------------------------------------------------- |
| Cmd-X/C                       | Cut/copy through WebView editing commands                  |
| Cmd-V                         | Native paste attempt, then permission-dependent plain text |
| Cmd-A                         | Select focused field/editor, otherwise the document        |
| Cmd-Z / Shift-Cmd-Z           | Undo/redo                                                  |
| Cmd-F / Cmd-G / Shift-Cmd-G   | Find / next / previous                                     |
| Cmd-R / Cmd-[ / Cmd-]         | Reload / back / forward                                    |
| Cmd-W                         | Close current window, if Tauri permits                     |
| Ctrl-A/E                      | Current line start/end                                     |
| Ctrl-B/F                      | Previous/next character                                    |
| Ctrl-K                        | Kill selection or line tail; at line end, kill newline     |
| Ctrl-Y                        | Yank last killed plain text                                |
| Option-B/F, Option-Left/Right | Previous/next word                                         |
| Option-Backspace/Delete       | Delete previous/next word, or selection                    |
| Shift + movement              | Extend selection                                           |

## Limits

- Cmd-T/N/Q, Cmd-arrow/zoom, and Option-Up/Down are not added off macOS.
- Use native Ctrl-V for images/files/rich text; clipboard permission and WebView
  editing support vary. Kill/yank uses one document-local buffer, excludes passwords,
  and has no kill ring. Textarea line movement follows newlines, not visual wrapping.
- Compositor bindings, cross-origin iframes, and custom editor models can interfere.
  Tests mock DOM/build boundaries; real desktop behavior still needs verification.
- KDE/Wayland titlebar buttons: rebuild with `--wayland-titlebar-workaround`.
  This briefly toggles maximize/restore after startup; native state/user-action races
  remain possible, and failed IPC can leave the window maximized.
  Fullscreen is skipped. Alternatively use `GDK_BACKEND=x11 /path/to/app-binary`.

## Tests

```sh
python3 -m unittest discover -s cmdwise-web/lib/pakeapps/tests -v
node --test cmdwise-web/lib/pakeapps/tests/*.test.cjs
```
