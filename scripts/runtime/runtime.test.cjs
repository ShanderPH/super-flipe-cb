const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
function runtime() {
  const context = vm.createContext({ window: {}, console, setTimeout() {}, clearTimeout() {} });
  for (const [file, name] of [['emulator.js', 'EmulatorJS'], ['GameManager.js', 'EJS_GameManager'], ['gamepad.js', 'GamepadHandler']]) {
    vm.runInContext(fs.readFileSync(path.join(root, 'vendor/emulatorjs/data/src', file), 'utf8') + `\nglobalThis.${name}=${name};`, context);
  }
  const engine = Object.create(context.EmulatorJS.prototype);
  engine.initControlVars();
  Object.assign(engine, {
    started: true, paused: false, controls: engine.defaultControllers,
    controlPopup: { parentElement: { parentElement: { getAttribute: () => '' } } },
    settingsMenu: { style: { display: 'none' } }, isPopupOpen: () => false,
    getSettingValue: () => 'disabled', gamepadSelection: ['Xbox_1'],
    gamepad: { gamepads: [{ id: 'Xbox', index: 1 }] },
  });
  const forwarded = [];
  const manager = Object.create(context.EJS_GameManager.prototype);
  Object.assign(manager, { EJS: engine, functions: { simulateInput: (...args) => forwarded.push(args) } });
  engine.gameManager = manager;
  engine.setupKeys();
  return { engine, manager, forwarded, context };
}
test('physical indexes 1/2 survive twenty disconnect/reconnect cycles', () => {
  const { engine, forwarded } = runtime();
  for (let cycle = 0; cycle < 20; cycle++) {
    const index = 1 + cycle % 2;
    engine.gamepad.gamepads = [{ id: 'Xbox', index }];
    engine.gamepadSelection = [`Xbox_${index}`];
    engine.gamepadEvent({ gamepadIndex: index, type: 'buttondown', label: 'BUTTON_1' });
    engine.gamepad.gamepads = [];
    engine.gamepadEvent({ gamepadIndex: index, type: 'buttonup', label: 'BUTTON_1' });
  }
  assert.equal(forwarded.length, 20);
});
test('paused runtime rejects input presses but accepts releases', () => {
  const { engine, manager, forwarded } = runtime();
  engine.paused = true;
  manager.simulateInput(0, 8, 1);
  manager.simulateInput(0, 8, 0);
  assert.deepEqual(forwarded, [[0, 8, 0]]);
});
test('gamepad permission denial does not kill the polling loop', () => {
  const { context } = runtime();
  context.navigator = { getGamepads() { throw new Error('SecurityError'); } };
  const reader = new context.GamepadHandler();
  assert.equal(reader.gamepads.length, 0);
});
test('product profile and runtime policy both suppress hidden special hotkeys', async () => {
  const { controls } = await import('../../apps/tv-client/public/player/controls.js');
  const { engine, manager, forwarded } = runtime();
  engine.config = { superFlip: { allowInput: () => true } };
  engine.controls = controls();
  engine.setupKeys();
  manager.quickSave = () => { throw new Error('Unexpected quick save'); };
  manager.quickLoad = () => { throw new Error('Unexpected quick load'); };
  for (let code = 49; code <= 51; code++) engine.keyChange({ keyCode: code, type: 'keydown', preventDefault() {} });
  for (let index = 24; index <= 29; index++) manager.simulateInput(0, index, 1);
  assert.equal(forwarded.length, 0);
  engine.gamepadEvent({ gamepadIndex: 1, type: 'buttondown', label: 'BUTTON_1' });
  assert.deepEqual(forwarded, [[0, 0, 1]]);
});
test('server-owned SRAM uses volatile FS and does not load stale IndexedDB', async () => {
  const { manager, engine } = runtime();
  engine.config = { superFlip: {} };
  const directories = [];
  manager.mkdir = path => directories.push(path);
  manager.FS = { mount() { throw new Error('Must not mount stale SRAM'); } };
  await manager.mountFileSystems();
  assert.deepEqual(directories, ['/data', '/data/saves']);
});
