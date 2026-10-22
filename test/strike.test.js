import { describe, it, expect } from 'vitest';
import { createStrike, stepStrike, mulberry32, STRIKE_MS, REDUCED_MS } from '../src/overlay/strike.js';

describe('strike flash', () => {
  it('derives the same geometry from the same seed', () => {
    const a = createStrike({ seed: 1234, width: 1920, height: 1080 });
    const b = createStrike({ seed: 1234, width: 1920, height: 1080 });
    expect(a.angleDeg).toBe(b.angleDeg);
    expect(a.direction).toBe(b.direction);
    expect(a.start).toEqual(b.start);
    expect(a.end).toEqual(b.end);
  });

  it('keeps the lash angle between 25 and 65 degrees and both directions reachable', () => {
    const dirs = new Set();
    for (let seed = 0; seed < 200; seed++) {
      const s = createStrike({ seed, width: 1920, height: 1080 });
      expect(s.angleDeg).toBeGreaterThanOrEqual(25);
      expect(s.angleDeg).toBeLessThanOrEqual(65);
      dirs.add(s.direction);
    }
    expect(dirs).toEqual(new Set(['tlbr', 'trbl']));
  });

  it('spans from one screen edge to the opposite edge', () => {
    const s = createStrike({ seed: 7, width: 1920, height: 1080 });
    const onEdge = (p) => p.x <= 1e-6 || p.y <= 1e-6 || Math.abs(p.x - 1920) <= 1e-6 || Math.abs(p.y - 1080) <= 1e-6;
    expect(onEdge(s.start)).toBe(true);
    expect(onEdge(s.end)).toBe(true);
  });

  it('becomes inactive after 600 ms', () => {
    const s = createStrike({ seed: 1, width: 800, height: 600 });
    expect(stepStrike(s, STRIKE_MS - 1)).toBe(true);
    expect(stepStrike(s, 1)).toBe(false);
    expect(s.active).toBe(false);
  });

  it('reduced motion becomes inactive after 200 ms', () => {
    const s = createStrike({ seed: 1, width: 800, height: 600, reduceMotion: true });
    expect(stepStrike(s, REDUCED_MS - 1)).toBe(true);
    expect(stepStrike(s, 1)).toBe(false);
  });

  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
