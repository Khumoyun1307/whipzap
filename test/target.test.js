import { describe, it, expect } from 'vitest';
import { DEFAULT_ALLOW_PATTERNS, compilePattern, matchesAllowPatterns, decideSanity, isSelf, createTargetStore } from '../src/main/target.js';
import { createFakePlatform } from './fakes/fakePlatform.js';

const P = DEFAULT_ALLOW_PATTERNS;

describe('target rules', () => {
  it('TGT-01 process name matches default patterns', () => {
    expect(matchesAllowPatterns({ processName: 'WindowsTerminal.exe', title: 'x' }, P)).toBe(true);
  });

  it('TGT-02 matching is case-insensitive', () => {
    expect(matchesAllowPatterns({ processName: 'code.EXE', title: '' }, ['Code.exe'])).toBe(true);
  });

  it('TGT-03 title matches when the process does not', () => {
    expect(matchesAllowPatterns({ processName: 'unknown.exe', title: 'claude - PowerShell' }, ['claude'])).toBe(true);
  });

  it('TGT-04 no match for unrelated apps', () => {
    expect(matchesAllowPatterns({ processName: 'slack.exe', title: 'general - Slack' }, P)).toBe(false);
  });

  it('TGT-05 plain patterns are substrings, so codex.exe matches code', () => {
    expect(matchesAllowPatterns({ processName: 'codex.exe', title: '' }, ['code'])).toBe(true);
  });

  it('TGT-06 empty patterns match nothing', () => {
    expect(matchesAllowPatterns({ processName: 'WindowsTerminal.exe', title: 'Windows Terminal' }, [])).toBe(false);
    expect(decideSanity({ processName: 'WindowsTerminal.exe', title: '' }, [])).toBe('confirm');
  });

  it('TGT-07 decideSanity returns allow or confirm', () => {
    expect(decideSanity({ processName: 'wezterm-gui.exe', title: '' }, P)).toBe('allow');
    expect(decideSanity({ processName: 'slack.exe', title: 'Slack' }, P)).toBe('confirm');
  });

  it('TGT-12 default list contains the required entries', () => {
    const required = ['windowsterminal', 'wt.exe', 'cmd.exe', 'powershell', 'pwsh', 'conhost', 'mintty', 'alacritty', 'wezterm', 'kitty', 'ghostty', 'hyper', 'code', 'cursor', 'terminal', 'iterm', 'claude', 'codex'];
    for (const r of required) expect(P).toContain(r);
  });

  it('regex patterns work and invalid ones are ignored', () => {
    expect(matchesAllowPatterns({ processName: 'emacs', title: 'Emacs: foo' }, ['/^Emacs/'])).toBe(true);
    expect(compilePattern('/[unclosed/')).toBe(null);
    expect(compilePattern('')).toBe(null);
    expect(compilePattern(`/${'a'.repeat(2000)}/`)).toBe(null);
  });

  it('isSelf detects own pid and title', () => {
    expect(isSelf({ pid: 10, title: 'x' }, { selfPid: 10 })).toBe(true);
    expect(isSelf({ pid: 11, title: 'WhipZap' }, { selfPid: 10 })).toBe(true);
    expect(isSelf({ pid: 11, title: 'Terminal' }, { selfPid: 10 })).toBe(false);
  });
});

describe('target store', () => {
  const terminal = { id: '100', title: 'Windows Terminal', processName: 'WindowsTerminal.exe', pid: 500 };
  const slack = { id: '200', title: 'general - Slack', processName: 'slack.exe', pid: 600 };

  it('TGT-08 matching window locks without confirm', async () => {
    const platform = createFakePlatform({ foreground: terminal });
    let confirmCalls = 0;
    const store = createTargetStore({ platform, confirm: async () => { confirmCalls += 1; return true; }, selfPid: 1 });
    const result = await store.lockForeground();
    expect(result.ok).toBe(true);
    expect(result.target.id).toBe('100');
    expect(store.get().id).toBe('100');
    expect(confirmCalls).toBe(0);
  });

  it('TGT-09 non-matching window locks after confirm', async () => {
    const platform = createFakePlatform({ foreground: slack });
    const seen = [];
    const store = createTargetStore({ platform, confirm: async (info) => { seen.push(info.title); return true; }, selfPid: 1 });
    const result = await store.lockForeground();
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['general - Slack']);
    expect(store.get().id).toBe('200');
  });

  it('TGT-10 declined confirm leaves no target', async () => {
    const platform = createFakePlatform({ foreground: slack });
    const store = createTargetStore({ platform, confirm: async () => false, selfPid: 1 });
    const result = await store.lockForeground();
    expect(result).toEqual({ ok: false, reason: 'declined' });
    expect(store.get()).toBe(null);
  });

  it('TGT-11 self windows are never lockable', async () => {
    const platform = createFakePlatform({ foreground: { id: '1', title: 'Windows Terminal', processName: 'WindowsTerminal.exe', pid: 1 } });
    const store = createTargetStore({ platform, confirm: async () => true, selfPid: 1 });
    expect(await store.lockForeground()).toEqual({ ok: false, reason: 'self' });
    platform.setForeground({ id: '2', title: 'WhipZap', processName: 'electron.exe', pid: 2 });
    expect(await store.lockForeground()).toEqual({ ok: false, reason: 'self' });
    expect(store.get()).toBe(null);
  });

  it('exists() clears the lock when the window is gone', async () => {
    const platform = createFakePlatform({ foreground: terminal });
    const store = createTargetStore({ platform, confirm: async () => true, selfPid: 1 });
    await store.lockForeground();
    expect(await store.exists()).toBe(true);
    platform.removeWindow('100');
    expect(await store.exists()).toBe(false);
    expect(store.get()).toBe(null);
    expect(await store.exists()).toBe(false);
  });

  it('platform errors during lock are reported, not thrown', async () => {
    const platform = createFakePlatform({ foreground: terminal, failures: { getForegroundWindow: 1 } });
    const store = createTargetStore({ platform, confirm: async () => true, selfPid: 1 });
    const result = await store.lockForeground();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('error');
  });

  it('lastForeground override is used when provided', async () => {
    const platform = createFakePlatform({ foreground: slack });
    const store = createTargetStore({ platform, confirm: async () => false, selfPid: 1, lastForeground: async () => terminal });
    const result = await store.lockForeground();
    expect(result.ok).toBe(true);
    expect(result.target.id).toBe('100');
  });
});
