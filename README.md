# cmdwise

Apple Unix variants --- macOS, Mac OS X, and even A/UX --- have a keyboarding advantage that Linux graphical environments have so far refused to copy: the command key. This is really too bad, because it's a key that is dedicated for GUI operations, and gives terminals and text editors full use of <kbd>ctrl</kbd> and <kbd>alt</kbd> keys.

There is no reason to remember that your terminal needs <kbd>ctrl</kbd>-<kbd>shift</kbd>-<kbd>x</kbd>/<kbd>c</kbd>/<kbd>v</kbd> for cut/copy/paste. If your environment used <kbd>cmd</kbd>-<kbd>x</kbd>/<kbd>c</kbd>/<kbd>v</kbd> for these functions instead, you'd have consistency everywhere.

This also would allow text fields to support Emacs keybindings even in other apps, like <kbd>ctrl</kbd>-<kbd>a</kbd>/<kbd>e</kbd> for beginning/end of line, or <kbd>alt</kbd>-<kbd>b</kbd>/<kbd>f</kbd> for backward/forward word.

## Philosophy

It's good to have consistent keybindings across all apps, including terminals and advanced text editors. It makes sense to use a different shortcut key for GUI operations compared to Unix/terminal ones.

It's worth asking app developers, commercial vendors, desktop environment projects, and so forth for first party command key support. Keyboard conventions work best as conventions followed by all parties.

Note that in some cases, the easiest way to achieve cmdwise apps is to use macOS keybindings wholesale. The goal is not to clone the macOS experience, but to steal the command key feature from them; this just happens to be the most expedient way to do so.

## Application configuration

To do this, you need to configure apps individually.

You can go a long way with KDE, Ghostty, VS Code, and Firefox.

* [KDE](./kde)
* [Ghostty](./ghostty)
* Firefox: `about:config`, `ui.key.accelKey` = `91`, restart the app
* Visual Studio Code: someone has already done the hard work for us with the [VSCode Default Keybindings](https://marketplace.visualstudio.com/items?itemName=jbro.vscode-default-keybindings) extension
* [Web apps](./cmdwise-web)

## Why cmdwise apps instead of a macOS key remapper

* It might be useful to run both, restricting the key remapper to window classes that are not possible to remap another way
* Native app support is more direct, and has fewer things that can go wrong like stuck key states or interference with what the window manager is doing
* cmdwise is about using the right key for the right job; macOS remappers are about making Linux feel like a Mac
* cmdwise gives us an opportunity to ask for what we want from app developers

