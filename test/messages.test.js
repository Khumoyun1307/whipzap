import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validatePack, normalizeExtras, mergePacks, loadPack, tierForCount, pickMessage, TIERS } from '../src/main/messages.js';
import { mulberry32 } from '../src/main/prng.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultPack = JSON.parse(readFileSync(path.join(here, '..', 'assets', 'messages', 'default.json'), 'utf8'));

function countAll(pack) {
  return TIERS.reduce((n, t) => n + pack.tiers[t].length, 0);
}

describe('messages', () => {
  it('MSG-01 default pack validates', () => {
    expect(validatePack(defaultPack).errors).toEqual([]);
  });

  it('MSG-02 every tier has at least 5 messages', () => {
    for (const tier of TIERS) expect(defaultPack.tiers[tier].length).toBeGreaterThanOrEqual(5);
  });

  it('MSG-03 tier selection stays inside the tier', () => {
    const rng = mulberry32(1);
    let last;
    for (let i = 0; i < 200; i++) {
      const m = pickMessage(defaultPack, 'spicy', rng, last);
      expect(defaultPack.tiers.spicy).toContain(m);
      last = m;
    }
  });

  it('MSG-04 unknown tier throws', () => {
    expect(() => pickMessage(defaultPack, 'nuclear', mulberry32(1))).toThrow(/Unknown tier "nuclear"/);
  });

  it('MSG-05 extra merge adds to mild', () => {
    const { pack } = loadPack(defaultPack, { extra: [{ tier: 'mild', text: 'MOVE IT' }], replace: false });
    expect(pack.tiers.mild.length).toBe(defaultPack.tiers.mild.length + 1);
    expect(pack.tiers.mild).toContain('MOVE IT');
    expect(countAll(pack)).toBe(countAll(defaultPack) + 1);
  });

  it('MSG-06 replace uses only extras', () => {
    const extra = [
      { tier: 'mild', text: 'a' },
      { tier: 'medium', text: 'b' },
      { tier: 'spicy', text: 'c' },
    ];
    const { pack, warnings } = loadPack(defaultPack, { extra, replace: true });
    expect(pack.tiers).toEqual({ mild: ['a'], medium: ['b'], spicy: ['c'] });
    expect(warnings).toEqual([]);
  });

  it('MSG-07 replace with a missing tier falls back to the default tier with a warning', () => {
    const extra = [
      { tier: 'mild', text: 'a' },
      { tier: 'medium', text: 'b' },
    ];
    const { pack, warnings } = loadPack(defaultPack, { extra, replace: true });
    expect(pack.tiers.spicy).toEqual(defaultPack.tiers.spicy);
    expect(warnings.some((w) => w.includes('spicy'))).toBe(true);
  });

  it('MSG-08 no immediate repeat when the pool is larger than one', () => {
    const rng = mulberry32(99);
    let last;
    for (let i = 0; i < 500; i++) {
      const m = pickMessage(defaultPack, 'mild', rng, last);
      expect(m).not.toBe(last);
      last = m;
    }
  });

  it('MSG-09 a pool of one returns it repeatedly', () => {
    const pack = { version: 1, tiers: { mild: ['only'], medium: ['x'], spicy: ['y'] } };
    const rng = mulberry32(3);
    let last;
    for (let i = 0; i < 10; i++) {
      last = pickMessage(pack, 'mild', rng, last);
      expect(last).toBe('only');
    }
  });

  it('MSG-10 a message longer than 200 characters fails extras validation (built-ins cap at 80)', () => {
    const long = 'x'.repeat(201);
    const { entries, warnings } = normalizeExtras([long]);
    expect(entries).toEqual([]);
    expect(warnings.length).toBe(1);
    const { errors } = validatePack({ version: 1, tiers: { mild: ['x'.repeat(81)], medium: ['a'], spicy: ['b'] } });
    expect(errors.some((e) => e.includes('exceeds 80'))).toBe(true);
  });

  it('MSG-11 control characters fail validation', () => {
    for (const bad of ['a\nb', 'a\rb', 'a\tb', 'a\u0007b']) {
      expect(validatePack({ version: 1, tiers: { mild: [bad], medium: ['a'], spicy: ['b'] } }).errors.length).toBeGreaterThan(0);
      expect(normalizeExtras([bad]).entries).toEqual([]);
    }
  });

  it('MSG-12 whitespace is trimmed on load', () => {
    const { pack } = loadPack({ version: 1, tiers: { mild: ['  hi  '], medium: ['a'], spicy: ['b'] } }, { extra: ['  yo  '] });
    expect(pack.tiers.mild).toEqual(['hi', 'yo']);
  });

  it('MSG-13 empty text is rejected', () => {
    const { entries, warnings } = normalizeExtras([{ tier: 'mild', text: '   ' }]);
    expect(entries).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(validatePack({ version: 1, tiers: { mild: ['  '], medium: ['a'], spicy: ['b'] } }).errors.length).toBeGreaterThan(0);
  });

  it('MSG-14 same seed gives the same pick sequence', () => {
    const seqA = [];
    const seqB = [];
    const a = mulberry32(2024);
    const b = mulberry32(2024);
    let lastA;
    let lastB;
    for (let i = 0; i < 50; i++) {
      lastA = pickMessage(defaultPack, 'medium', a, lastA);
      lastB = pickMessage(defaultPack, 'medium', b, lastB);
      seqA.push(lastA);
      seqB.push(lastB);
    }
    expect(seqA).toEqual(seqB);
  });

  it('tierForCount follows 0-4 mild, 5-11 medium, 12+ spicy', () => {
    expect(tierForCount(0)).toBe('mild');
    expect(tierForCount(4)).toBe('mild');
    expect(tierForCount(5)).toBe('medium');
    expect(tierForCount(11)).toBe('medium');
    expect(tierForCount(12)).toBe('spicy');
    expect(tierForCount(500)).toBe('spicy');
  });

  it('validatePack reports duplicates and unknown tiers', () => {
    const { errors } = validatePack({ version: 1, tiers: { mild: ['a', 'a'], medium: ['b'], spicy: ['c'], nuclear: [] } });
    expect(errors.some((e) => e.includes('duplicates'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown tier'))).toBe(true);
  });

  it('mergePacks fills an empty tier from a lower tier when nothing else exists', () => {
    const { pack, warnings } = mergePacks({ version: 1, tiers: { mild: ['a'], medium: [], spicy: [] } }, [], false);
    expect(pack.tiers.medium).toEqual(['a']);
    expect(pack.tiers.spicy).toEqual(['a']);
    expect(warnings.length).toBe(2);
  });
});
