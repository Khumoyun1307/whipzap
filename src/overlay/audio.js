// Crack sound playback in the overlay renderer. One HTMLAudioElement per file, created at preload
// so the first play has no decode latency. Spec: docs/ARCHITECTURE.md section 11.

/**
 * @param {(file: string) => string} soundUrlFn maps a bare file name to a playable URL
 * @param {typeof Audio} [AudioCtor] injectable for tests
 */
export function createAudio(soundUrlFn, AudioCtor = globalThis.Audio) {
  const elements = new Map();

  function create(file) {
    const el = new AudioCtor(soundUrlFn(file));
    el.preload = 'auto';
    elements.set(file, el);
    return el;
  }

  return {
    preload(files) {
      for (const file of files) {
        if (elements.has(file)) continue;
        try {
          create(file);
        } catch (err) {
          console.warn('whipzap: could not preload sound', file, err);
        }
      }
    },
    play(file, volume = 0.8) {
      let el;
      try {
        el = elements.get(file) ?? create(file);
      } catch (err) {
        console.warn('whipzap: could not load sound', file, err);
        return;
      }
      const v = Math.min(1, Math.max(0, Number(volume)));
      let instance = el;
      if (!el.paused && !el.ended) {
        // Still playing from a rapid previous crack: overlap with a clone instead of cutting it off.
        instance = el.cloneNode(true);
      } else {
        try {
          el.currentTime = 0;
        } catch {
          /* not seekable yet */
        }
      }
      instance.volume = Number.isFinite(v) ? v : 0.8;
      const p = instance.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err) => console.warn('whipzap: audio play failed', err && err.message ? err.message : err));
      }
    },
  };
}
