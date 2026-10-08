const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../shortcuts.js'), 'utf8');

function setup(platform = 'Linux') {
  const listeners = {}, commands = [];
  const field = {
    tagName: 'TEXTAREA', value: 'hello world', selectionStart: 11, selectionEnd: 11,
    selectionDirection: 'none', isConnected: true,
    setSelectionRange(start, end, direction) {
      this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
    },
    select() { this.setSelectionRange(0, this.value.length); },
  };
  const selection = { scope: null, removeAllRanges() { this.scope = null; },
    addRange(range) { this.scope = range.scope; } };
  const document = { activeElement: field, body: { tagName: 'BODY' },
    addEventListener(type, handler) { listeners[type] = handler; },
    createRange() { return { selectNodeContents(scope) { this.scope = scope; } }; },
    execCommand(name, _, value) {
    commands.push([name, value]); return name !== 'paste';
  } };
  const window = { getSelection: () => selection,
    addEventListener(type, handler) { listeners[type] = handler; } };
  const navigator = { platform };
  vm.runInNewContext(source, { window, document, navigator, Intl, console });
  function key(key, modifiers = {}) {
    const event = { key, code: key, isTrusted: true, composedPath: () => [field],
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...modifiers };
    listeners.keydown?.(event);
    return event;
  }
  return { field, key, commands, listeners, window, navigator, document, selection };
}

test('macOS keeps native shortcuts', () => {
  assert.deepEqual(setup('MacIntel').listeners, {});
});
test('Ctrl-A/E use line boundaries, not select-all or Find', () => {
  const { field, key } = setup();
  field.value = '\nhello\nworld';
  field.setSelectionRange(0, 0);
  key('a', { ctrlKey: true });
  assert.equal(field.selectionStart, 0);
  field.setSelectionRange(9, 9);
  key('a', { ctrlKey: true });
  assert.equal(field.selectionStart, 7);
  key('e', { ctrlKey: true });
  assert.equal(field.selectionStart, 12);
});
test('Ctrl-B/F move over graphemes; Shift extends', () => {
  const { field, key } = setup();
  field.value = 'a😀b'; field.setSelectionRange(3, 3);
  key('b', { ctrlKey: true }); assert.equal(field.selectionStart, 1);
  key('f', { ctrlKey: true, shiftKey: true });
  assert.equal(field.selectionStart, 1); assert.equal(field.selectionEnd, 3);
});
test('Option word movement uses physical keys', () => {
  const { field, key } = setup();
  key('∫', { altKey: true, code: 'KeyB' });
  assert.equal(field.selectionStart, 6);
  key('Backspace', { altKey: true });
  assert.deepEqual([field.selectionStart, field.selectionEnd], [0, 6]);
});
test('Command shortcuts execute real editing commands; reject synthetic events', () => {
  const { key, commands } = setup();
  key('c', { metaKey: true }); key('x', { metaKey: true });
  key('z', { metaKey: true, shiftKey: true });
  key('c', { metaKey: true, isTrusted: false });
  assert.deepEqual(commands.map(([name]) => name), ['copy', 'cut', 'redo']);
});
test('Command-A selects all focused input text', () => {
  const { field, key } = setup();
  assert.equal(key('a', { metaKey: true }).prevented, true);
  assert.deepEqual([field.selectionStart, field.selectionEnd], [0, field.value.length]);
});
test('Super+A works when GTK omits metaKey; releasing/blur clears tracking', () => {
  const { field, key, listeners } = setup();
  key('Super', { code: 'MetaLeft' });
  assert.equal(key('a').prevented, true);
  assert.deepEqual([field.selectionStart, field.selectionEnd], [0, field.value.length]);
  listeners.keyup({ key: 'Super', code: 'MetaLeft', isTrusted: true });
  assert.equal(key('a').prevented, undefined);
  key('Super', { code: 'MetaRight' }); listeners.blur();
  assert.equal(key('a').prevented, undefined);
});
test('overlapping Super keys and page hiding do not leave Command sticky', () => {
  const { key, listeners, document } = setup();
  key('Super', { code: 'MetaLeft' }); key('Super', { code: 'MetaRight' });
  listeners.keyup({ key: 'Super', code: 'MetaLeft', isTrusted: true });
  assert.equal(key('a').prevented, true);
  document.hidden = true; listeners.visibilitychange();
  assert.equal(key('a').prevented, undefined);
  key('Super', { code: 'MetaLeft', isTrusted: false });
  assert.equal(key('a').prevented, undefined);
});
test('Command-A selects the document outside editors', () => {
  const { field, key, selection, document } = setup();
  field.tagName = 'DIV';
  assert.equal(key('a', { metaKey: true }).prevented, true);
  assert.equal(selection.scope, document.body);
});
test('nested contenteditable selects the editing host, not the inner span', () => {
  const { field, key, selection } = setup();
  const host = { tagName: 'DIV', isContentEditable: true };
  field.tagName = 'SPAN'; field.isContentEditable = true; field.parentElement = host;
  key('a', { metaKey: true });
  assert.equal(selection.scope, host);
});
test('select-all resolves focused shadow input and supports readonly fields', () => {
  const { field, key, document } = setup();
  const host = { tagName: 'DIV', shadowRoot: { activeElement: field } };
  document.activeElement = host; field.readOnly = true;
  key('a', { metaKey: true, composedPath: () => [host] });
  assert.deepEqual([field.selectionStart, field.selectionEnd], [0, field.value.length]);
});
test('unsupported focused controls do not select the document', () => {
  const { field, key, selection } = setup();
  field.tagName = 'INPUT'; field.type = 'number';
  assert.equal(key('a', { metaKey: true }).prevented, undefined);
  assert.equal(selection.scope, null);
});
test('Ctrl-K kills the line tail, Ctrl-Y yanks without clipboard access', () => {
  const { field, key, commands } = setup();
  field.value = 'hello world\nnext'; field.setSelectionRange(6, 6);
  assert.equal(key('k', { ctrlKey: true }).prevented, true);
  assert.deepEqual([field.selectionStart, field.selectionEnd], [6, 11]);
  key('y', { ctrlKey: true });
  assert.deepEqual(commands, [['delete', null], ['insertText', 'world']]);
});
test('Ctrl-K at line end kills the newline; selected text is killed unchanged', () => {
  const { field, key, commands } = setup();
  field.value = 'hello\nnext'; field.setSelectionRange(5, 5);
  key('k', { ctrlKey: true }); key('y', { ctrlKey: true });
  assert.deepEqual(commands[1], ['insertText', '\n']);
  field.setSelectionRange(0, 2);
  key('k', { ctrlKey: true }); key('y', { ctrlKey: true });
  assert.deepEqual(commands[3], ['insertText', 'he']);
});
test('empty kill does not replace buffer; password fields are excluded', () => {
  const { field, key, commands } = setup();
  field.setSelectionRange(6, 11); key('k', { ctrlKey: true });
  field.setSelectionRange(11, 11); key('k', { ctrlKey: true });
  key('y', { ctrlKey: true });
  assert.deepEqual(commands, [['delete', null], ['insertText', 'world']]);
  field.type = 'password';
  assert.equal(key('k', { ctrlKey: true }).prevented, undefined);
  assert.equal(key('y', { ctrlKey: true }).prevented, undefined);
});
test('Command-F calls Find; unsupported tab/quit remain untouched', () => {
  const { key, window } = setup();
  let opened = false; window.pakeFind = { open() { opened = true; } };
  assert.equal(key('f', { metaKey: true }).prevented, true);
  assert.equal(opened, true);
  for (const letter of ['t', 'n', 'q']) assert.equal(key(letter, { metaKey: true }).prevented, undefined);
});
test('delayed plain-text paste aborts if caret moved', async () => {
  const { field, key, navigator, commands } = setup();
  let resolve;
  navigator.clipboard = { readText: () => new Promise((done) => { resolve = done; }) };
  key('v', { metaKey: true }); field.setSelectionRange(0, 0);
  resolve('secret'); await new Promise(setImmediate);
  assert.deepEqual(commands.map(([name]) => name), ['paste']);
});
