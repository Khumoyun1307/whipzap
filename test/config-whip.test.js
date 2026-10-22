import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, validateConfig } from '../src/main/config.js';

describe('config.whip (mouse whip tuning)', () => {
  it('CFG-12: defaults present', () => {
    expect(DEFAULT_CONFIG.whip).toEqual({ crackFactor: 3.5, cooldownMs: 600 });
    expect(validateConfig({}).config.whip).toEqual({ crackFactor: 3.5, cooldownMs: 600 });
  });
  it('CFG-13: accepts and clamps values', () => {
    const { config, warnings } = validateConfig({ whip: { crackFactor: 50, cooldownMs: 10 } });
    expect(config.whip).toEqual({ crackFactor: 20, cooldownMs: 100 });
    expect(warnings.some((w) => w.includes('crackFactor clamped'))).toBe(true);
    expect(warnings.some((w) => w.includes('cooldownMs clamped'))).toBe(true);
  });
  it('CFG-14: wrong types fall back with a warning', () => {
    const { config, warnings } = validateConfig({ whip: { crackFactor: 'fast', bogus: 1 } });
    expect(config.whip.crackFactor).toBe(3.5);
    expect(warnings.some((w) => w.includes('whip.crackFactor must be a number'))).toBe(true);
    expect(warnings.some((w) => w.includes('unknown whip key "bogus"'))).toBe(true);
  });
});
