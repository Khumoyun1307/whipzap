import { describe, it, expect } from 'vitest';
import { sameOwner, createTargetStore, compilePattern } from '../src/main/target.js';
import { HelperError, HELPER_CODES } from '../src/main/platform/errors.js';

describe('target liveness (recycled window ids, D-2)', () => {
  it('TGT-13: same pid and process name is the same window', () => {
    expect(sameOwner({ pid: 10, processName: 'WindowsTerminal' }, { pid: 10, processName: 'windowsterminal' })).toBe(true);
  });
  it('TGT-14: a different pid is a different window even with the same id', () => {
    expect(sameOwner({ pid: 10, processName: 'WindowsTerminal' }, { pid: 11, processName: 'WindowsTerminal' })).toBe(false);
  });
  it('TGT-15: a different process name is a different window', () => {
    expect(sameOwner({ pid: 0, processName: 'Code' }, { pid: 0, processName: 'chrome' })).toBe(false);
  });
  it('TGT-16: missing pid or process name (Linux without _NET_WM_PID) does not fail the check', () => {
    expect(sameOwner({ pid: 0, processName: '' }, { pid: 0, processName: '' })).toBe(true);
    expect(sameOwner({ pid: 42, processName: 'xterm' }, { pid: 0, processName: '' })).toBe(true);
  });
  it('TGT-17: exists() clears the lock when the id now belongs to another process', async () => {
    const platform = {
      getForegroundWindow: async () => ({ id: '1', title: 'term', processName: 'wt', pid: 5 }),
      getWindowInfo: async () => ({ id: '1', title: 'Slack', processName: 'slack', pid: 99 }),
    };
    const store = createTargetStore({ platform, confirm: async () => true, selfPid: 1 });
    expect((await store.lockForeground()).ok).toBe(true);
    expect(await store.exists()).toBe(false);
    expect(store.get()).toBe(null);
  });
  it('TGT-18: exists() clears the lock on code 3 and rethrows other errors', async () => {
    let fail = new HelperError(HELPER_CODES.TARGET_GONE, 'gone');
    const platform = {
      getForegroundWindow: async () => ({ id: '1', title: 'term', processName: 'wt', pid: 5 }),
      getWindowInfo: async () => {
        throw fail;
      },
    };
    const store = createTargetStore({ platform, confirm: async () => true, selfPid: 1 });
    await store.lockForeground();
    expect(await store.exists()).toBe(false);
    await store.lockForeground();
    fail = new HelperError(HELPER_CODES.OTHER, 'timeout');
    await expect(store.exists()).rejects.toThrow('timeout');
  });
});

describe('allow pattern regex flags', () => {
  it('TGT-19: g and y flags are stripped so matching is stateless', () => {
    const p = compilePattern('/term/g');
    expect(p.test('terminal')).toBe(true);
    expect(p.test('terminal')).toBe(true);
    expect(p.test('terminal')).toBe(true);
  });
});
