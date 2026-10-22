import { describe, it, expect } from 'vitest';
import { createScheduler, MIN_INTERVAL_SEC } from '../src/main/scheduler.js';
import { createFakeClock } from './fakes/fakeClock.js';

const BASE = { baseIntervalSec: 180, jitterSec: 90, sessionCap: 20, seed: 42 };

function make(configOverrides = {}, { rng, onFire, onStop } = {}) {
  const clock = createFakeClock(0);
  const fires = [];
  const stops = [];
  const scheduler = createScheduler({
    config: { ...BASE, ...configOverrides },
    clock,
    rng,
    onFire: onFire ?? ((p) => { fires.push({ ...p, at: clock.now() }); }),
    onStop: onStop ?? ((p) => stops.push(p)),
  });
  return { clock, scheduler, fires, stops };
}

async function runFires(ctx, n) {
  for (let i = 0; i < n; i++) {
    const { nextAt } = ctx.scheduler.state();
    if (nextAt == null) break;
    await ctx.clock.advance(nextAt - ctx.clock.now());
  }
}

describe('scheduler', () => {
  it('SCH-01 same seed, same sequence', async () => {
    const a = make({ seed: 42 });
    const b = make({ seed: 42 });
    a.scheduler.start();
    b.scheduler.start();
    await runFires(a, 20);
    await runFires(b, 20);
    expect(a.fires.length).toBe(20);
    expect(a.fires.map((f) => f.at)).toEqual(b.fires.map((f) => f.at));
  });

  it('SCH-02 different seeds differ', async () => {
    const firsts = [];
    for (const seed of [1, 2, 3]) {
      const ctx = make({ seed });
      ctx.scheduler.start();
      firsts.push(ctx.scheduler.state().nextAt);
    }
    expect(new Set(firsts).size).toBeGreaterThan(1);
  });

  it('SCH-03 intervals stay within [base - jitter, base + jitter]', async () => {
    const ctx = make({ seed: 7, sessionCap: 500, baseIntervalSec: 180, jitterSec: 90 });
    ctx.scheduler.start();
    let prev = 0;
    for (let i = 0; i < 400; i++) {
      const { nextAt } = ctx.scheduler.state();
      const interval = (nextAt - prev) / 1000;
      expect(interval).toBeGreaterThanOrEqual(90);
      expect(interval).toBeLessThanOrEqual(270);
      await ctx.clock.advance(nextAt - ctx.clock.now());
      prev = nextAt;
    }
  });

  it('SCH-04 minimum interval clamp', async () => {
    const low = make({ baseIntervalSec: 10, jitterSec: 0 });
    low.scheduler.start();
    expect(low.scheduler.state().nextAt).toBe(MIN_INTERVAL_SEC * 1000);
    const ctx = make({ baseIntervalSec: 25, jitterSec: 10, sessionCap: 500 });
    ctx.scheduler.start();
    let prev = 0;
    for (let i = 0; i < 200; i++) {
      const { nextAt } = ctx.scheduler.state();
      expect((nextAt - prev) / 1000).toBeGreaterThanOrEqual(20);
      await ctx.clock.advance(nextAt - ctx.clock.now());
      prev = nextAt;
    }
  });

  it('SCH-05 zero jitter is exact', async () => {
    const ctx = make({ baseIntervalSec: 60, jitterSec: 0, sessionCap: 10 });
    ctx.scheduler.start();
    await runFires(ctx, 10);
    expect(ctx.fires.map((f) => f.at)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => n * 60000));
  });

  it('SCH-06 tier progression', async () => {
    const ctx = make({ sessionCap: 20, jitterSec: 0 });
    ctx.scheduler.start();
    await runFires(ctx, 20);
    const tiers = ctx.fires.map((f) => f.tier);
    expect(tiers.slice(0, 5).every((t) => t === 'mild')).toBe(true);
    expect(tiers.slice(5, 12).every((t) => t === 'medium')).toBe(true);
    expect(tiers.slice(12).every((t) => t === 'spicy')).toBe(true);
  });

  it('SCH-07 session cap delivers the last fire and sets no further timer', async () => {
    const ctx = make({ sessionCap: 20, jitterSec: 0 });
    ctx.scheduler.start();
    await runFires(ctx, 25);
    expect(ctx.fires.length).toBe(20);
    expect(ctx.scheduler.isRunning()).toBe(false);
    expect(ctx.scheduler.state().nextAt).toBe(null);
    expect(ctx.clock.pendingCount()).toBe(0);
    expect(ctx.stops).toEqual([{ reason: 'cap' }]);
  });

  it('SCH-08 onStop called exactly once at the cap', async () => {
    const ctx = make({ sessionCap: 3, jitterSec: 0 });
    ctx.scheduler.start();
    await runFires(ctx, 3);
    await ctx.clock.advance(10 * 60 * 1000);
    expect(ctx.stops.length).toBe(1);
  });

  it('SCH-09 start after stop resets the count', async () => {
    const ctx = make({ sessionCap: 20, jitterSec: 0 });
    ctx.scheduler.start();
    await runFires(ctx, 6);
    expect(ctx.scheduler.state().count).toBe(6);
    ctx.scheduler.stop();
    ctx.scheduler.start();
    expect(ctx.scheduler.state().count).toBe(0);
    expect(ctx.scheduler.state().tier).toBe('mild');
    await runFires(ctx, 1);
    expect(ctx.fires.at(-1).count).toBe(1);
    expect(ctx.fires.at(-1).tier).toBe('mild');
  });

  it('SCH-10 pause clears the timer and nothing fires', async () => {
    const ctx = make({ jitterSec: 0 });
    ctx.scheduler.start();
    ctx.scheduler.pause();
    expect(ctx.clock.pendingCount()).toBe(0);
    await ctx.clock.advance(60 * 60 * 1000);
    expect(ctx.fires.length).toBe(0);
    expect(ctx.scheduler.state().paused).toBe(true);
  });

  it('SCH-11 resume schedules from the resume time', async () => {
    const ctx = make({ baseIntervalSec: 60, jitterSec: 0 });
    ctx.scheduler.start();
    await ctx.clock.advance(30000);
    ctx.scheduler.pause();
    await ctx.clock.advance(100000);
    ctx.scheduler.resume();
    expect(ctx.scheduler.state().nextAt).toBe(130000 + 60000);
  });

  it('SCH-12 stop is idempotent', async () => {
    const ctx = make();
    ctx.scheduler.start();
    ctx.scheduler.stop();
    expect(() => ctx.scheduler.stop()).not.toThrow();
    expect(ctx.stops.length).toBe(0);
  });

  it('SCH-13 fire payload has a 1-based count and tier', async () => {
    const ctx = make({ jitterSec: 0 });
    ctx.scheduler.start();
    await runFires(ctx, 2);
    expect(ctx.fires[0]).toMatchObject({ count: 1, tier: 'mild' });
    expect(ctx.fires[1]).toMatchObject({ count: 2, tier: 'mild' });
  });

  it('SCH-14 null seed draws from the clock and still fires within bounds', async () => {
    const ctx = make({ seed: null });
    ctx.scheduler.start();
    expect(typeof ctx.scheduler.state().seed).toBe('number');
    const { nextAt } = ctx.scheduler.state();
    expect(nextAt / 1000).toBeGreaterThanOrEqual(90);
    expect(nextAt / 1000).toBeLessThanOrEqual(270);
    await runFires(ctx, 1);
    expect(ctx.fires.length).toBe(1);
  });

  it('awaits onFire before scheduling the next interval', async () => {
    const clock = createFakeClock(0);
    let resolveFire;
    const scheduler = createScheduler({
      config: { ...BASE, jitterSec: 0 },
      clock,
      onFire: () => new Promise((r) => { resolveFire = r; }),
    });
    scheduler.start();
    await clock.advance(180000);
    expect(scheduler.state().nextAt).toBe(null);
    resolveFire();
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.state().nextAt).toBe(360000);
  });

  it('injected rng is used', () => {
    const ctx = make({ baseIntervalSec: 100, jitterSec: 50 }, { rng: () => 1 });
    ctx.scheduler.start();
    expect(ctx.scheduler.state().nextAt).toBe(150000);
  });
});
