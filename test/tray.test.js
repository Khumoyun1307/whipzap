import { describe, it, expect } from 'vitest';
import { buildMenuTemplate, iconNameForState, tooltipForState } from '../src/main/tray.js';

const handlers = {
  armWhip: () => {}, dropWhip: () => {}, crackNow: () => {}, toggleAuto: () => {}, setDelivery: () => {},
  toggleMute: () => {}, openConfig: () => {}, lockTarget: () => {}, quit: () => {},
};
const base = { target: null, whipArmed: false, autoOn: false, autoCount: 0, autoCap: 20, delivery: 'safe', muted: false };

describe('tray menu (UX.md section 3)', () => {
  it('W-02: exact order and labels', () => {
    const labels = buildMenuTemplate(base, handlers).map((i) => i.type === 'separator' ? '---' : i.label);
    expect(labels).toEqual(['Arm whip', 'Crack now', 'Auto mode', '---', 'Delivery', 'Mute', '---', 'Open config', 'Lock target', '---', 'Quit']);
  });
  it('Delivery is a submenu with two radio items reflecting state', () => {
    const delivery = buildMenuTemplate({ ...base, delivery: 'btw' }, handlers).find((i) => i.label === 'Delivery');
    expect(delivery.submenu.map((i) => [i.label, i.type, i.checked])).toEqual([
      ['Safe (queued message)', 'radio', false],
      ['/btw (side question)', 'radio', true],
    ]);
  });
  it('checkboxes mirror state', () => {
    const items = buildMenuTemplate({ ...base, whipArmed: true, autoOn: true, muted: true }, handlers);
    const byLabel = Object.fromEntries(items.filter((i) => i.label).map((i) => [i.label, i]));
    expect(byLabel['Arm whip'].checked).toBe(true);
    expect(byLabel['Auto mode'].checked).toBe(true);
    expect(byLabel['Mute'].checked).toBe(true);
  });
  it('Arm whip toggles between arm and drop handlers', () => {
    const calls = [];
    const h = { ...handlers, armWhip: () => calls.push('arm'), dropWhip: () => calls.push('drop') };
    buildMenuTemplate(base, h).find((i) => i.label === 'Arm whip').click();
    buildMenuTemplate({ ...base, whipArmed: true }, h).find((i) => i.label === 'Arm whip').click();
    expect(calls).toEqual(['arm', 'drop']);
  });
});

describe('tray icon and tooltip (UX.md section 2)', () => {
  it('precedence armed > auto > locked > idle', () => {
    const t = { id: '1', title: 'Windows Terminal', processName: 'WindowsTerminal', pid: 1 };
    expect(iconNameForState({ ...base }, 'win32')).toBe('tray-idle.png');
    expect(iconNameForState({ ...base, target: t }, 'win32')).toBe('tray-locked.png');
    expect(iconNameForState({ ...base, target: t, autoOn: true }, 'win32')).toBe('tray-auto.png');
    expect(iconNameForState({ ...base, target: t, autoOn: true, whipArmed: true }, 'win32')).toBe('tray-armed.png');
    expect(iconNameForState({ ...base }, 'darwin')).toBe('trayTemplate.png');
  });
  it('tooltips', () => {
    const t = { id: '1', title: 'A'.repeat(50), processName: 'x', pid: 1 };
    expect(tooltipForState(base)).toBe('WhipZap: no target locked');
    expect(tooltipForState({ ...base, target: t })).toBe(`WhipZap: locked on ${'A'.repeat(39)}…`);
    expect(tooltipForState({ ...base, target: t, autoOn: true, autoCount: 3 })).toBe('WhipZap: auto mode, 3 of 20');
    expect(tooltipForState({ ...base, target: t, whipArmed: true })).toBe('WhipZap: whip armed');
  });
});
