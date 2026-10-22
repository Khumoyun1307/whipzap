import { describe, it, expect } from 'vitest';
import { registerHotkeys, describeAccelerator } from '../src/main/hotkeys.js';

function fakeShortcut(taken = []) {
  const registered = [];
  return {
    registered,
    register(acc, fn) {
      if (taken.includes(acc)) return false;
      registered.push([acc, fn]);
      return true;
    },
    unregister() {},
  };
}

describe('hotkeys', () => {
  it('HK-01: registers own handlers and reports taken accelerators', () => {
    const gs = fakeShortcut(['CommandOrControl+Alt+A']);
    const handlers = { crack: () => {}, armWhip: () => {}, toggleAuto: () => {} };
    const result = registerHotkeys(gs, { crack: 'CommandOrControl+Alt+W', armWhip: 'CommandOrControl+Alt+Shift+W', toggleAuto: 'CommandOrControl+Alt+A' }, handlers);
    expect(result.registered).toEqual(['CommandOrControl+Alt+W', 'CommandOrControl+Alt+Shift+W']);
    expect(result.failed).toEqual(['CommandOrControl+Alt+A']);
  });
  it('HK-02: never binds inherited names such as constructor (config cannot register Ctrl+C)', () => {
    const gs = fakeShortcut();
    const handlers = { crack: () => {} };
    const result = registerHotkeys(gs, { constructor: 'Control+C', toString: 'Escape', crack: 'Alt+W' }, handlers);
    expect(gs.registered.map(([acc]) => acc)).toEqual(['Alt+W']);
    expect(result.failed).toEqual([]);
  });
  it('HK-03: describeAccelerator renders platform names', () => {
    expect(describeAccelerator('CommandOrControl+Alt+W', 'win32')).toBe('Ctrl+Alt+W');
    expect(describeAccelerator('CommandOrControl+Alt+W', 'darwin')).toBe('Cmd+Alt+W');
  });
});
