import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, configPath, validateConfig, parseConfig, loadConfig, saveConfig, watchConfig } from '../src/main/config.js';
import { createFakeFs } from './fakes/fakeFs.js';

const FILE = '/data/whipzap/config.json';

describe('config', () => {
  it('CFG-01 missing file returns defaults and writes them', async () => {
    const fs = createFakeFs();
    const { config, warnings } = await loadConfig({ configPath: FILE, fs });
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnings).toEqual([]);
    expect(fs.files.has(FILE)).toBe(true);
    expect(JSON.parse(fs.files.get(FILE))).toEqual(DEFAULT_CONFIG);
  });

  it('CFG-02 partial file merges with defaults', async () => {
    const fs = createFakeFs({ [FILE]: JSON.stringify({ sound: { muted: true } }) });
    const { config } = await loadConfig({ configPath: FILE, fs });
    expect(config.sound.muted).toBe(true);
    expect(config.sound.volume).toBe(0.8);
    expect(config.delivery).toBe('safe');
  });

  it('CFG-03 invalid JSON is moved to .bak and defaults are written', async () => {
    const fs = createFakeFs({ [FILE]: '{ nope' });
    const { config, warnings } = await loadConfig({ configPath: FILE, fs });
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(fs.files.get(`${FILE}.bak`)).toBe('{ nope');
    expect(JSON.parse(fs.files.get(FILE))).toEqual(DEFAULT_CONFIG);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('CFG-04 unknown keys are dropped with a warning', () => {
    const { config, warnings } = validateConfig({ turbo: true });
    expect(config).not.toHaveProperty('turbo');
    expect(warnings.some((w) => w.includes('turbo'))).toBe(true);
  });

  it('CFG-05 version handling', () => {
    expect(validateConfig({ delivery: 'btw' }).config.version).toBe(1);
    const { config, warnings } = validateConfig({ version: 99, delivery: 'btw' });
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnings.some((w) => w.includes('version'))).toBe(true);
  });

  it('CFG-06 accelerator validation', () => {
    expect(validateConfig({ hotkeys: { crack: 'Ctrl+Alt+W' } }).config.hotkeys.crack).toBe('Ctrl+Alt+W');
    const { config, warnings } = validateConfig({ hotkeys: { crack: 'banana' } });
    expect(config.hotkeys.crack).toBe(DEFAULT_CONFIG.hotkeys.crack);
    expect(warnings.some((w) => w.includes('hotkeys.crack'))).toBe(true);
    expect(validateConfig({ hotkeys: { crack: 'Ctrl+Alt+W!' } }).config.hotkeys.crack).toBe(DEFAULT_CONFIG.hotkeys.crack);
  });

  it('CFG-07 delivery enum', () => {
    expect(validateConfig({ delivery: 'btw' }).config.delivery).toBe('btw');
    const { config, warnings } = validateConfig({ delivery: 'esc' });
    expect(config.delivery).toBe('safe');
    expect(warnings.length).toBe(1);
  });

  it('CFG-08 auto bounds', () => {
    expect(validateConfig({ auto: { baseIntervalSec: 5 } }).config.auto.baseIntervalSec).toBe(20);
    expect(validateConfig({ auto: { sessionCap: 0 } }).config.auto.sessionCap).toBe(1);
    expect(validateConfig({ auto: { sessionCap: 10000 } }).config.auto.sessionCap).toBe(500);
    expect(validateConfig({ auto: { baseIntervalSec: 30, jitterSec: 100 } }).config.auto.jitterSec).toBe(30);
    expect(validateConfig({ auto: { seed: 42 } }).config.auto.seed).toBe(42);
    expect(validateConfig({ auto: { seed: -1 } }).config.auto.seed).toBe(null);
    expect(validateConfig({ auto: { seed: null } }).config.auto.seed).toBe(null);
  });

  it('CFG-09 volume bounds', () => {
    expect(validateConfig({ sound: { volume: 7 } }).config.sound.volume).toBe(1);
    expect(validateConfig({ sound: { volume: -1 } }).config.sound.volume).toBe(0);
  });

  it('CFG-10 save then load round trips', async () => {
    const fs = createFakeFs();
    const { config } = validateConfig({ delivery: 'btw', sound: { muted: true, volume: 0.5 }, messages: { extra: ['yo'] } });
    await saveConfig({ configPath: FILE, fs }, config);
    expect(fs.files.has(`${FILE}.tmp`)).toBe(false);
    const loaded = await loadConfig({ configPath: FILE, fs });
    expect(loaded.config).toEqual(config);
    expect(loaded.warnings).toEqual([]);
  });

  it('CFG-11 non-array allowPatterns falls back with a warning', () => {
    const { config, warnings } = validateConfig({ target: { allowPatterns: 'nope' } });
    expect(config.target.allowPatterns).toEqual([]);
    expect(warnings.some((w) => w.includes('allowPatterns'))).toBe(true);
  });

  it('configPath joins userData and config.json', () => {
    expect(configPath('/x/y')).toMatch(/[\\/]x[\\/]y[\\/]config\.json$/);
  });

  it('DEFAULT_CONFIG is deep frozen', () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.auto)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.hotkeys)).toBe(true);
  });

  it('parseConfig reports a parse error', () => {
    const result = parseConfig('nope');
    expect(result.parseError).toBeTruthy();
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  it('messages.extra keeps strings and { tier, text } objects, drops junk', () => {
    const { config, warnings } = validateConfig({ messages: { extra: ['a', { tier: 'spicy', text: 'b' }, 42, { tier: 'nuclear', text: 'c' }] } });
    expect(config.messages.extra).toEqual(['a', { tier: 'spicy', text: 'b' }, { text: 'c' }]);
    expect(warnings.length).toBe(2);
  });

  it('watchConfig returns a closable handle even when watch throws', () => {
    const handle = watchConfig({ configPath: FILE, fs: createFakeFs(), watch: () => { throw new Error('no watch'); } }, () => {});
    expect(typeof handle.close).toBe('function');
    handle.close();
  });
});
