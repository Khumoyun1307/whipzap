import { describe, it, expect } from 'vitest';
import { createCrack } from '../src/main/crack.js';
import { createTargetStore } from '../src/main/target.js';
import { createFakePlatform } from './fakes/fakePlatform.js';
import { createFakeClock } from './fakes/fakeClock.js';

const PACK = {
  version: 1,
  tiers: {
    mild: ['FASTER!', 'Tick tock.'],
    medium: ['Medium one', 'Medium two'],
    spicy: ['Spicy one', 'Spicy two'],
  },
};
const TERMINAL = { id: '100', title: 'Windows Terminal', processName: 'WindowsTerminal.exe', pid: 500 };

function setup({ target = TERMINAL, state = {}, platformOpts = {}, muted = false } = {}) {
  const platform = createFakePlatform({ foreground: target ?? undefined, ...platformOpts });
  const targets = createTargetStore({ platform, confirm: async () => true, selfPid: 1 });
  if (target) targets.set(target);
  const clock = createFakeClock(1000);
  const events = [];
  const toasts = [];
  const st = { delivery: 'safe', muted, autoOn: false, autoCount: 0, lastMessage: null, typingAvailable: true, ...state };
  const lost = [];
  const seq = [0.1, 0.6, 0.3, 0.9, 0.2, 0.7];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  const deps = {
    platform,
    targets,
    getPack: () => PACK,
    rng,
    state: st,
    audio: { play: (file, volume) => events.push({ ev: 'audio.play', file, volume }) },
    overlay: { strike: (p) => events.push({ ev: 'overlay.strike', ...p }) },
    toast: (text, ms) => { toasts.push({ text, ms }); events.push({ ev: 'toast', text }); },
    clock: {
      now: () => clock.now(),
      sleep: (ms) => { events.push({ ev: 'sleep', ms }); return Promise.resolve(); },
    },
    log: { info() {}, debug() {}, error() {} },
    sounds: ['crack-1.wav', 'crack-2.wav', 'crack-3.wav'],
    getConfig: () => ({ sound: { volume: 0.8 } }),
    onTargetLost: () => lost.push(1),
  };
  // Record platform calls into the same event stream for ordering assertions.
  const originalFocus = platform.focusWindow.bind(platform);
  platform.focusWindow = async (id) => { events.push({ ev: 'platform.focusWindow', id }); return originalFocus(id); };
  const originalType = platform.typeText.bind(platform);
  platform.typeText = async (id, text, options) => { events.push({ ev: 'platform.typeText', id, text, options }); return originalType(id, text, options); };
  const originalInfo = platform.getWindowInfo.bind(platform);
  platform.getWindowInfo = async (id) => { events.push({ ev: 'platform.getWindowInfo', id }); return originalInfo(id); };
  return { platform, targets, clock, events, toasts, state: st, lost, crack: createCrack(deps).crack, deps };
}

describe('crack', () => {
  it('CRK-01 happy path order', async () => {
    const { crack, events } = setup();
    const result = await crack({ source: 'hotkey' });
    expect(result.typed).toBe(true);
    expect(events.map((e) => e.ev)).toEqual([
      'audio.play',
      'overlay.strike',
      'platform.getWindowInfo',
      'platform.focusWindow',
      'sleep',
      'platform.typeText',
    ]);
    expect(events.find((e) => e.ev === 'sleep').ms).toBe(150);
    const typed = events.find((e) => e.ev === 'platform.typeText');
    expect(typed.id).toBe('100');
    expect(typed.text).toBe(result.message);
    expect(typed.options).toEqual({ pressEnter: true });
  });

  it('CRK-02 btw delivery types the prefix but shows the bare message', async () => {
    const { crack, events } = setup({ state: { delivery: 'btw' } });
    const result = await crack({ source: 'hotkey' });
    const typed = events.find((e) => e.ev === 'platform.typeText');
    expect(typed.text).toBe(`/btw ${result.message}`);
    const strike = events.find((e) => e.ev === 'overlay.strike');
    expect(strike.message).toBe(result.message);
    expect(strike.prefix).toBe('/btw');
  });

  it('CRK-03 no target: sound and strike, toast, no platform input', async () => {
    const { crack, events, toasts } = setup({ target: null });
    const result = await crack({ source: 'hotkey' });
    expect(result.typed).toBe(false);
    expect(events.map((e) => e.ev)).toEqual(['audio.play', 'overlay.strike', 'toast']);
    expect(toasts).toEqual([{ text: 'No target locked', ms: 2500 }]);
  });

  it('CRK-04 target gone: toast and lock cleared', async () => {
    const { crack, events, toasts, targets, platform, lost } = setup();
    platform.removeWindow('100');
    const result = await crack({ source: 'hotkey' });
    expect(result.typed).toBe(false);
    expect(toasts).toEqual([{ text: 'Target window closed', ms: 3000 }]);
    expect(targets.get()).toBe(null);
    expect(events.some((e) => e.ev === 'platform.focusWindow')).toBe(false);
    expect(events.some((e) => e.ev === 'platform.typeText')).toBe(false);
    expect(lost.length).toBe(1);
  });

  it('CRK-05 focus fails: no typing, toast, lock kept', async () => {
    const { crack, events, toasts, targets, platform } = setup();
    platform.setFocusResult(false);
    const result = await crack({ source: 'hotkey' });
    expect(result.typed).toBe(false);
    expect(toasts).toEqual([{ text: 'Could not focus target', ms: 3000 }]);
    expect(events.some((e) => e.ev === 'platform.typeText')).toBe(false);
    expect(targets.get().id).toBe('100');
  });

  it('CRK-06 permission error: toast and settings opened once per session', async () => {
    const { crack, toasts, platform, state } = setup({ platformOpts: { failures: { typeText: 2 } } });
    await crack({ source: 'hotkey' });
    expect(toasts.at(-1)).toEqual({ text: 'Accessibility permission required', ms: 3000 });
    expect(state.typingAvailable).toBe(false);
    expect(platform.calls.filter((c) => c.method === 'openAccessibilitySettings').length).toBe(1);
  });

  it('CRK-06b second permission failure does not reopen settings', async () => {
    const ctx = setup({ platformOpts: { failures: { typeText: 2 } } });
    await ctx.crack({ source: 'hotkey' });
    await ctx.clock.advance(1000);
    await ctx.crack({ source: 'hotkey' });
    expect(ctx.platform.calls.filter((c) => c.method === 'openAccessibilitySettings').length).toBe(1);
    expect(ctx.toasts.filter((t) => t.text === 'Accessibility permission required').length).toBe(2);
  });

  it('CRK-07 muted skips audio but still strikes and types', async () => {
    const { crack, events } = setup({ muted: true });
    const result = await crack({ source: 'hotkey' });
    expect(result.typed).toBe(true);
    expect(events.some((e) => e.ev === 'audio.play')).toBe(false);
    expect(events.some((e) => e.ev === 'overlay.strike')).toBe(true);
    expect(events.some((e) => e.ev === 'platform.typeText')).toBe(true);
  });

  it('CRK-08 a second crack within 300 ms is skipped as busy', async () => {
    const { crack, clock, events } = setup();
    const first = crack({ source: 'hotkey' });
    const second = await crack({ source: 'hotkey' });
    await first;
    expect(second).toEqual({ typed: false, skipped: 'busy' });
    expect(events.filter((e) => e.ev === 'platform.typeText').length).toBe(1);
    await clock.advance(400);
    const third = await crack({ source: 'hotkey' });
    expect(third.typed).toBe(true);
  });

  it('CRK-09 tier follows source and auto state', async () => {
    const manual = setup();
    expect((await manual.crack({ source: 'hotkey' })).tier).toBe('mild');
    const whip = setup();
    expect((await whip.crack({ source: 'whip' })).tier).toBe('medium');
    const auto = setup({ state: { autoOn: true, autoCount: 12 } });
    const result = await auto.crack({ source: 'auto' });
    expect(result.tier).toBe('spicy');
    expect(PACK.tiers.spicy).toContain(result.message);
    expect(auto.state.autoCount).toBe(13);
  });

  it('CRK-10 never sends control keys: the only input call is typeText with { pressEnter: true }', async () => {
    const scenarios = [
      setup(),
      setup({ state: { delivery: 'btw' } }),
      setup({ muted: true }),
      setup({ state: { autoOn: true, autoCount: 3 } }),
    ];
    for (const s of scenarios) {
      await s.crack({ source: 'hotkey' });
      const inputCalls = s.platform.calls.filter((c) => !['getWindowInfo', 'getForegroundWindow', 'focusWindow', 'isSupported', 'checkPermissions'].includes(c.method));
      expect(inputCalls.length).toBe(1);
      expect(inputCalls[0].method).toBe('typeText');
      expect(inputCalls[0].options).toEqual({ pressEnter: true });
      // eslint-disable-next-line no-control-regex
      expect(inputCalls[0].text).not.toMatch(/[\u0000-\u001F\u007F]/);
    }
  });

  it('typing failure with an unknown error toasts "Typing failed"', async () => {
    const { crack, toasts } = setup({ platformOpts: { failures: { typeText: 1 } } });
    const result = await crack({ source: 'tray' });
    expect(result.typed).toBe(false);
    expect(toasts.at(-1)).toEqual({ text: 'Typing failed', ms: 3000 });
  });

  it('target gone during typing clears the lock', async () => {
    const { crack, toasts, targets, lost } = setup({ platformOpts: { failures: { typeText: 3 } } });
    await crack({ source: 'tray' });
    expect(toasts.at(-1)).toEqual({ text: 'Target window closed', ms: 3000 });
    expect(targets.get()).toBe(null);
    expect(lost.length).toBe(1);
  });

  it('no immediate message repeat across cracks', async () => {
    const ctx = setup();
    const seen = [];
    for (let i = 0; i < 6; i++) {
      seen.push((await ctx.crack({ source: 'hotkey' })).message);
      await ctx.clock.advance(400);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });
});
