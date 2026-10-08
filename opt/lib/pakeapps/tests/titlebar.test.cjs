const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../titlebar.js'), 'utf8');

function setup({ platform = 'Linux', maximized = false, fullscreen = false, failAt = 0,
  visibility = 'visible', marker = null, api = true } = {}) {
  const state = { maximized, calls: 0, warnings: [], delays: [], marker };
  const document = { visibilityState: visibility };
  const appWindow = { async toggleMaximize() {
    state.calls++;
    if (state.calls === failAt) throw new Error('IPC denied');
    state.maximized = !state.maximized;
  } };
  const context = {
    navigator: { platform }, document,
    window: { pakeConfig: { fullscreen },
      __TAURI__: api ? { window: { getCurrentWindow: () => appWindow } } : undefined },
    sessionStorage: { getItem: () => state.marker, setItem: (_, value) => { state.marker = value; } },
    console: { warn: (...args) => state.warnings.push(args) },
    setTimeout(callback, delay) {
      state.delays.push(delay);
      // Simulate a hidden startup window becoming visible on the next check.
      document.visibilityState = 'visible';
      callback();
    },
  };
  return { state, done: vm.runInNewContext(source, context) };
}

test('maximize round trip restores either starting state', async () => {
  for (const maximized of [false, true]) {
    const { state, done } = setup({ maximized }); await done;
    assert.equal(state.calls, 2); assert.equal(state.maximized, maximized);
    assert.deepEqual(state.delays, [300, 200]); assert.equal(state.marker, '1');
  }
});
test('wait for hidden window to be shown before toggling', async () => {
  const { state, done } = setup({ visibility: 'hidden' }); await done;
  assert.deepEqual(state.delays, [250, 300, 200]); assert.equal(state.calls, 2);
});
test('skip other platforms, fullscreen, missing API, or an already refreshed session', async () => {
  for (const options of [{ platform: 'MacIntel' }, { fullscreen: true }, { api: false }, { marker: '1' }]) {
    const { state, done } = setup(options); await done;
    assert.equal(state.calls, 0);
  }
});
test('IPC failures warn and do not mark the session successful', async () => {
  for (const failAt of [1, 2]) {
    const { state, done } = setup({ failAt }); await done;
    assert.equal(state.calls, failAt); assert.equal(state.marker, null);
    assert.equal(state.warnings.length, 1);
  }
});
