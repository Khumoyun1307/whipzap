import { describe, it, expect } from 'vitest';
import { mulberry32, createRng } from '../src/main/prng.js';

describe('prng', () => {
  it('PRNG-01 same seed produces the same first 100 values', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('PRNG-02 values are in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('PRNG-03 deciles are roughly uniform over 10000 draws', () => {
    const r = mulberry32(12345);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 10000; i++) buckets[Math.floor(r() * 10)] += 1;
    for (const count of buckets) {
      expect(count / 10000).toBeGreaterThanOrEqual(0.08);
      expect(count / 10000).toBeLessThanOrEqual(0.12);
    }
  });

  it('PRNG-04 createRng exposes the normalized seed', () => {
    const rng = createRng(-1);
    expect(rng.seed).toBe(4294967295);
    expect(typeof rng.next()).toBe('number');
  });

  it('PRNG-05 different seeds differ', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
