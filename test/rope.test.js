import { describe, it, expect } from 'vitest';
import { createRope, stepRope, tipSpeed, crackThreshold, isOffscreen, ropeLength, STEP_MS } from '../src/overlay/rope.js';

const W = 1920;
const H = 1080;
const SEG = Math.min(W, H) / 45;

function makeRope(x = 960, y = 100) {
  return createRope({ x, y, segmentLength: SEG, width: W, height: H });
}

function run(rope, head, steps, dt = STEP_MS) {
  for (let i = 0; i < steps; i++) stepRope(rope, head, dt);
}

describe('rope physics', () => {
  it('conserves total length within 2% after 1000 steps with a still head', () => {
    const rope = makeRope();
    const head = { x: 960, y: 100 };
    run(rope, head, 1000);
    const expected = rope.n * SEG;
    expect(Math.abs(ropeLength(rope) - expected) / expected).toBeLessThan(0.02);
  });

  it('hangs below the head at rest', () => {
    const rope = makeRope();
    const head = { x: 960, y: 100 };
    // The unfurl starts a slow swing that takes roughly 20 s to damp at 0.992 per step.
    run(rope, head, 3000);
    const tip = rope.points[rope.n];
    expect(tip.y).toBeGreaterThan(head.y + rope.n * SEG * 0.9);
    expect(Math.abs(tip.x - head.x)).toBeLessThan(SEG);
  });

  it('a sudden 400 px head jump pushes tip speed above the crack threshold within 10 steps', () => {
    const rope = makeRope();
    run(rope, { x: 960, y: 100 }, 600);
    let maxSpeed = 0;
    for (let i = 0; i < 10; i++) {
      stepRope(rope, { x: 960 + 400, y: 100 }, STEP_MS);
      maxSpeed = Math.max(maxSpeed, tipSpeed(rope));
    }
    expect(maxSpeed).toBeGreaterThan(crackThreshold(rope));
  });

  it('is deterministic for identical inputs', () => {
    const a = makeRope();
    const b = makeRope();
    for (let i = 0; i < 300; i++) {
      const head = { x: 960 + Math.sin(i / 10) * 200, y: 100 + Math.cos(i / 7) * 50 };
      stepRope(a, head, 16);
      stepRope(b, head, 16);
    }
    expect(a.points).toEqual(b.points);
  });

  it('gives the same result for 8 ms and 16 ms frames over the same wall time', () => {
    const a = makeRope();
    const b = makeRope();
    const headAt = (t) => (t <= 300 ? { x: 960 + 2 * t, y: 100 } : { x: 1560, y: 100 });
    // 300 ms drag, then a hold long enough for the swing to settle (pendulum period is about 2 s,
    // and the swing takes roughly 20 s to damp at 0.992 per step).
    const total = 25000;
    for (let t = 8; t <= total; t += 8) stepRope(a, headAt(t), 8);
    for (let t = 16; t <= total; t += 16) stepRope(b, headAt(t), 16);
    let maxDev = 0;
    let sumDev = 0;
    for (let i = 0; i <= a.n; i++) {
      const d = Math.hypot(a.points[i].x - b.points[i].x, a.points[i].y - b.points[i].y);
      maxDev = Math.max(maxDev, d);
      sumDev += d;
    }
    expect(maxDev, `max deviation ${maxDev.toFixed(1)} px`).toBeLessThan(SEG);
    expect(sumDev / (a.n + 1), `mean deviation ${(sumDev / (a.n + 1)).toFixed(1)} px`).toBeLessThan(SEG * 0.25);
  });

  it('falls off screen within 1.5 s after being dropped', () => {
    const rope = makeRope(960, 500);
    run(rope, { x: 960, y: 500 }, 300);
    const steps = Math.ceil(1500 / STEP_MS);
    run(rope, null, steps);
    expect(isOffscreen(rope)).toBe(true);
  });

  it('exposes a positive crack threshold proportional to segment length', () => {
    const rope = makeRope();
    expect(crackThreshold(rope)).toBeCloseTo(rope.crackFactor * SEG);
    expect(crackThreshold(rope)).toBeGreaterThan(0);
  });
});
