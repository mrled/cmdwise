// Pake wraps this file in DOMContentLoaded. Keep macOS native editing intact.
(() => {
  if (/mac/i.test(navigator.userAgentData?.platform || navigator.platform || "")) return;

  // WebKitGTK may report Super separately, without DOM metaKey.
  const commandKeys = new Set();
  const isCommandKey = (event) => ["Super", "Meta", "OS"].includes(event.key);
  const hasCommand = (event) => event.metaKey || commandKeys.size > 0;
  // Lost releases must not turn subsequent plain keys into Command shortcuts.
  window.addEventListener("blur", () => commandKeys.clear());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) commandKeys.clear();
  });

  const warn = (action) => console.warn(`[pake-app] ${action} unavailable; try native Ctrl shortcuts`);
  const consume = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // Exclude controls without caret APIs; readonly selection is handled separately.
  const editable = (element) => {
    if (!element || element.disabled || element.readOnly) return false;
    return element.isContentEditable || element.tagName === "TEXTAREA" ||
      (element.tagName === "INPUT" && ["text", "search", "url", "tel", "password"].includes(element.type));
  };
  // Follow open shadow roots, then expand editable descendants to their host.
  function focusedTarget(event) {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    const target = event.composedPath()[0];
    let element = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" ||
      active.isContentEditable) ? active : target || active;
    while (element?.isContentEditable && element.parentElement?.isContentEditable) {
      element = element.parentElement;
    }
    return element;
  }

  // Field selection includes readonly/email inputs; outside editors, select the page.
  function selectAll(element) {
    if (element?.tagName === "INPUT" || element?.tagName === "TEXTAREA") {
      if (element.disabled || (element.tagName === "INPUT" &&
          !["text", "search", "url", "tel", "password", "email"].includes(element.type))) return false;
      element.select();
      return true;
    }
    const scope = element?.isContentEditable ? element : document.body || document.documentElement;
    const selection = window.getSelection();
    if (!scope || !selection) return false;
    const range = document.createRange();
    range.selectNodeContents(scope);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  // Native editing preserves undo history; synthetic Ctrl events cannot authorize it.
  const command = (name, value = null) => {
    try { return document.execCommand(name, false, value); }
    catch (_) { return false; }
  };

  // Segmenter avoids splitting emoji/combining marks and supplies word boundaries.
  function boundaries(text, unit) {
    if (typeof Intl.Segmenter === "function") {
      return [...new Intl.Segmenter(undefined, { granularity: unit }).segment(text)];
    }
    // Older engines fall back to code points, not full grapheme/word segmentation.
    let index = 0;
    return Array.from(text, (segment) => {
      const item = { index, segment, isWordLike: /[\p{L}\p{N}_]/u.test(segment) };
      index += segment.length;
      return item;
    });
  }

  // Text controls expose UTF-16 offsets; line boundaries are literal newlines.
  function destination(text, position, direction, unit) {
    if (unit === "lineboundary") {
      return direction < 0 ? (position === 0 ? 0 : text.lastIndexOf("\n", position - 1) + 1) :
        (text.indexOf("\n", position) < 0 ? text.length : text.indexOf("\n", position));
    }
    const segments = boundaries(text, unit === "word" ? "word" : "grapheme");
    if (direction < 0) {
      const previous = segments.filter((s) => s.index < position && (unit !== "word" || s.isWordLike));
      return previous.length ? previous[previous.length - 1].index : 0;
    }
    const next = segments.find((s) => s.index + s.segment.length > position &&
      (unit !== "word" || s.isWordLike));
    return next ? next.index + next.segment.length : text.length;
  }

  function move(element, direction, unit, extend, remove = false) {
    if (element.isContentEditable) {
      const selection = window.getSelection();
      if (!selection?.modify || !element.contains(selection.anchorNode) ||
          !element.contains(selection.focusNode)) return false;
      // Native Selection.modify supplies word/line semantics for rich text.
      if (!remove || selection.isCollapsed) {
        selection.modify(extend || remove ? "extend" : "move", direction < 0 ? "backward" : "forward", unit);
      }
      if (remove && !command("delete")) warn("word deletion");
      return true;
    }
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (start === null || end === null) return false;
    // Shift preserves the anchor; ordinary character movement collapses a selection.
    const backwards = element.selectionDirection === "backward";
    const focus = backwards ? start : end;
    const anchor = backwards ? end : start;
    let target = destination(element.value, focus, direction, unit);
    if (!extend && start !== end) {
      target = remove || unit === "character" ? (direction < 0 ? start : end) : target;
    }
    if (remove) {
      if (start === end) element.setSelectionRange(Math.min(focus, target), Math.max(focus, target));
      if (!command("delete")) warn("word deletion");
    } else if (extend) {
      element.setSelectionRange(Math.min(anchor, target), Math.max(anchor, target),
        target < anchor ? "backward" : "forward");
    } else {
      element.setSelectionRange(target, target);
    }
    return true;
  }

  async function paste(element) {
    // Real native paste may preserve formats; synthetic Ctrl+V cannot do so.
    if (command("paste")) return;
    const selectionState = () => {
      const selection = element.isContentEditable ? window.getSelection() : null;
      return element.isContentEditable ? [element.innerHTML, selection?.anchorNode,
        selection?.anchorOffset, selection?.focusNode, selection?.focusOffset] :
        [element.value, element.selectionStart, element.selectionEnd];
    };
    // Permission prompts are asynchronous: never paste into a changed selection/editor.
    const snapshot = selectionState();
    try {
      const text = await navigator.clipboard.readText();
      const current = selectionState();
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (!element.isConnected || active !== element || snapshot.some((value, i) => value !== current[i])) return;
      if (text && !command("insertText", text)) warn("paste insertion");
    } catch (_) { warn("clipboard read"); }
  }

  // One buffer per document; neither the system clipboard nor a persistent kill ring.
  let killedText = "";

  function killLine(element) {
    let text;
    if (element.isContentEditable) {
      const selection = window.getSelection();
      if (!selection?.modify || !element.contains(selection.anchorNode) ||
          !element.contains(selection.focusNode)) return false;
      if (selection.isCollapsed) {
        selection.modify("extend", "forward", "lineboundary");
        if (selection.isCollapsed) selection.modify("extend", "forward", "character");
      }
      text = selection.toString();
    } else {
      let start = element.selectionStart, end = element.selectionEnd;
      if (start === null || end === null) return false;
      // A selection is killed unchanged; a caret at line end kills the newline.
      if (start === end) {
        end = destination(element.value, start, 1, "lineboundary");
        if (end === start && end < element.value.length) end++;
        element.setSelectionRange(start, end);
      }
      text = element.value.slice(start, end);
    }
    // Empty/failed kills must not overwrite the last successful kill.
    if (text) {
      if (command("delete")) killedText = text;
      else warn("kill line");
    }
    return true;
  }

  // Prefer Pake's native navigation; denied/missing IPC falls back to page APIs.
  function navigate(action) {
    const fallback = () => action === "reload" ? location.reload() : history[action]();
    const invoke = window.__TAURI__?.core?.invoke;
    if (invoke) invoke("webview_navigate", { action }).catch(fallback);
    else fallback();
  }

  // Capture before document/site handlers, without interfering with IME or dead keys.
  window.addEventListener("keydown", (event) => {
    if (!event.isTrusted || event.isComposing || event.key === "Dead") return;
    if (isCommandKey(event)) {
      commandKeys.add(event.code || event.key);
      return;
    }
    const element = focusedTarget(event);
    const isEditable = editable(element);
    const key = event.key.toLowerCase();

    // Handle real Command gestures directly; leave native Ctrl clipboard bindings alone.
    if (hasCommand(event) && !event.ctrlKey && !event.altKey) {
      if (key === "a" && !event.shiftKey) {
        if (selectAll(element)) consume(event);
        return;
      }
      if (["c", "x", "v", "z"].includes(key)) {
        if (!isEditable && !(key === "c" && window.getSelection()?.toString())) return;
        if (event.shiftKey && key !== "z") return;
        consume(event);
        if (key === "v") { if (!event.repeat) paste(element); }
        else if (!command({ c: "copy", x: "cut", z: event.shiftKey ? "redo" : "undo" }[key])) {
          warn(key === "z" ? "undo/redo" : "clipboard write");
        }
        return;
      }
      if ((key === "f" && !event.shiftKey) || key === "g") {
        if (!window.pakeFind) return;
        consume(event);
        window.pakeFind[key === "f" ? "open" : event.shiftKey ? "previous" : "next"]();
      } else if (!event.shiftKey && ["r", "[", "]"].includes(key)) {
        consume(event);
        if (!event.repeat) navigate({ r: "reload", "[": "back", "]": "forward" }[key]);
      } else if (key === "w" && !event.shiftKey) {
        const appWindow = window.__TAURI__?.window?.getCurrentWindow?.();
        if (!appWindow) return;
        consume(event);
        if (!event.repeat) appWindow.close().catch(() => warn("window close"));
      }
      return;
    }

    if (!isEditable || hasCommand(event)) return;
    let direction, unit, remove = false;
    if (event.ctrlKey && !event.altKey) {
      if (!event.shiftKey && (key === "k" || key === "y")) {
        // Do not retain password-field contents in the kill buffer.
        if (element.type === "password") return;
        if (key === "k") {
          if (killLine(element)) consume(event);
        } else {
          consume(event);
          if (killedText && !command("insertText", killedText)) warn("yank");
        }
        return;
      }
      const action = { a: [-1, "lineboundary"], e: [1, "lineboundary"],
        b: [-1, "character"], f: [1, "character"] }[key];
      if (!action) return;
      [direction, unit] = action;
    } else if (event.altKey && !event.ctrlKey) {
      // Alt can change event.key to a symbol; physical codes retain the intended binding.
      const physical = { KeyB: -1, KeyF: 1, ArrowLeft: -1, ArrowRight: 1,
        Backspace: -1, Delete: 1 }[event.code];
      if (!physical) return;
      direction = physical;
      unit = "word";
      remove = event.code === "Backspace" || event.code === "Delete";
    } else return;
    if (move(element, direction, unit, event.shiftKey, remove)) consume(event);
  }, true);

  // Pake's built-in Ctrl navigation runs on keyup, independently of keydown.
  window.addEventListener("keyup", (event) => {
    if (event.isTrusted && isCommandKey(event)) {
      commandKeys.delete(event.code || event.key);
      return;
    }
    if (event.isTrusted && editable(focusedTarget(event)) &&
        event.ctrlKey && !hasCommand(event) && !event.altKey && ["a", "e", "f", "b", "k", "y"].includes(event.key.toLowerCase())) {
      event.stopImmediatePropagation();
    }
  }, true);
})();
