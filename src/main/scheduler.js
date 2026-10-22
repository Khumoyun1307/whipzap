// Auto-mode scheduler: seeded jittered timer with tiers and a session cap. Pure; clock and rng injected.

import { createRng } from './prng.js';
import { tierForCount } from './messages.js';

const MIN_INTERVAL_SEC = 20;

/**
 * @param {{ config: { baseIntervalSec: number, jitterSec: number, sessionCap: number, seed: number|null },
 *           clock?: { now: () => number, setTimeout: Function, clearTimeout: Function },
 *           rng?: () => number,
 *           onFire: (payload: { count: number, tier: string }) => (void|Promise<void>),
 *           onStop?: (payload: { reason: string }) => void }} deps
 */
export function createScheduler({ config, clock, rng, onFire, onStop }) {
  const clk = clock ?? { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t) };
  let running = false;
  let paused = false;
  let count = 0;
  let timer = null;
  let nextAt = null;
  let seed = null;
  let next = rng ?? null;
  let firing = false;

  // config may be an object or a getter so that a config reload applies to the running session.
  function src() {
    return typeof config === 'function' ? config() : config;
  }

  function cfg() {
    const c = src();
    return {
      base: Number(c.baseIntervalSec) || 180,
      jitter: Number(c.jitterSec) || 0,
      cap: Number(c.sessionCap) || 20,
    };
  }

  function drawIntervalSec() {
    const { base, jitter } = cfg();
    const r = next();
    const raw = base + (r * 2 - 1) * jitter;
    return Math.max(MIN_INTERVAL_SEC, raw);
  }

  function clearTimer() {
    if (timer !== null) {
      clk.clearTimeout(timer);
      timer = null;
    }
    nextAt = null;
  }

  function schedule() {
    clearTimer();
    const sec = drawIntervalSec();
    const ms = Math.round(sec * 1000);
    nextAt = clk.now() + ms;
    timer = clk.setTimeout(fire, ms);
  }

  async function fire() {
    timer = null;
    nextAt = null;
    if (!running || paused) return;
    firing = true;
    count += 1;
    const payload = { count, tier: tierForCount(count - 1) };
    try {
      await onFire(payload);
    } catch {
      /* an error in one crack must not end the auto session */
    } finally {
      firing = false;
    }
    if (!running) return;
    if (count >= cfg().cap) {
      stop('cap');
      return;
    }
    if (!paused) schedule();
  }

  function stop(reason) {
    if (!running) return;
    running = false;
    paused = false;
    clearTimer();
    if (reason && onStop) onStop({ reason });
  }

  return {
    /** Starts a new auto session: resets the count, draws a seed when none is configured. */
    start() {
      if (running) return;
      count = 0;
      paused = false;
      if (!rng) {
        const s = src().seed;
        seed = s == null ? (clk.now() ^ 0x9e3779b9) >>> 0 : s >>> 0;
        next = createRng(seed).next;
      }
      running = true;
      schedule();
    },
    /** Stops without an onStop callback (user action). Idempotent. */
    stop() {
      stop(null);
    },
    pause() {
      if (!running || paused) return;
      paused = true;
      clearTimer();
    },
    resume() {
      if (!running || !paused) return;
      paused = false;
      if (!firing) schedule();
    },
    isRunning() {
      return running;
    },
    state() {
      return { running, paused, count, nextAt, seed, tier: tierForCount(count) };
    },
  };
}

export { MIN_INTERVAL_SEC };
