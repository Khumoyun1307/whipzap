// Seedable pseudo-random number generator (mulberry32). No dependencies, no Electron.
// Used by the scheduler and by message/sound selection so a seeded session is reproducible.

/**
 * mulberry32: fast 32-bit PRNG with good enough distribution for jitter and picks.
 * @param {number} seed any number; coerced to an unsigned 32-bit integer
 * @returns {() => number} function returning a float in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Wraps mulberry32 with the seed it was created from.
 * @param {number} seed
 * @returns {{ next: () => number, seed: number }}
 */
export function createRng(seed) {
  const normalized = seed >>> 0;
  return { next: mulberry32(normalized), seed: normalized };
}
