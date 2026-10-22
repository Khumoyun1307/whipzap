// Manual clock for deterministic timer tests. `advance(ms)` runs every timer due by then, in order.

export function createFakeClock(start = 0) {
  let current = start;
  let nextId = 1;
  const timers = new Map();

  function runDue(until) {
    for (;;) {
      let soonest = null;
      for (const t of timers.values()) {
        if (t.at <= until && (soonest === null || t.at < soonest.at || (t.at === soonest.at && t.id < soonest.id))) {
          soonest = t;
        }
      }
      if (!soonest) break;
      timers.delete(soonest.id);
      current = Math.max(current, soonest.at);
      soonest.fn();
    }
    current = Math.max(current, until);
  }

  return {
    now: () => current,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { id, fn, at: current + Math.max(0, ms) });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    /** Advances time, firing due timers. Returns a promise so awaiting lets microtasks settle. */
    async advance(ms) {
      runDue(current + ms);
      await Promise.resolve();
      await Promise.resolve();
    },
    /** Resolves after `ms` of fake time has been advanced. */
    sleep(ms) {
      return new Promise((resolve) => {
        const id = nextId++;
        timers.set(id, { id, fn: resolve, at: current + ms });
      });
    },
    /** Runs all pending timers regardless of time, in order. */
    async flush() {
      while (timers.size > 0) {
        const max = Math.max(...[...timers.values()].map((t) => t.at));
        runDue(max);
        await Promise.resolve();
        await Promise.resolve();
      }
    },
    pendingCount: () => timers.size,
  };
}
