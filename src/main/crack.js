// The crack routine: one function shared by hotkey, tray, whip mode, and auto mode.
// Order: pick message -> sound -> strike visual -> verify target -> focus -> 150 ms -> type + Enter.
// The only platform input call is typeText with { pressEnter: true }. Nothing else is ever sent.

import { HelperError, HELPER_CODES } from './platform/errors.js';
import { pickMessage, tierForCount } from './messages.js';
import { formatForDelivery, sanitizeForTyping } from './delivery.js';

const BUSY_WINDOW_MS = 300;
const SETTLE_MS = 150;

/**
 * @param {{
 *   platform: object, targets: object, getPack: () => object, rng: () => number, state: object,
 *   audio: { play: (file: string, volume: number) => void },
 *   overlay: { strike: (payload: { message: string, tier: string, prefix: string }) => void },
 *   toast: (text: string, ms: number) => void,
 *   clock: { now: () => number, sleep: (ms: number) => Promise<void> },
 *   log: { info: Function, debug: Function, error: Function },
 *   sounds: string[], getConfig: () => object, onTargetLost?: () => void
 * }} deps
 */
export function createCrack(deps) {
  const { platform, targets, getPack, rng, state, audio, overlay, toast, clock, log, sounds, getConfig } = deps;
  let lastStart = -Infinity;
  let inFlight = false;
  let accessibilityPrompted = false;

  function pickSound() {
    if (!sounds || sounds.length === 0) return null;
    return sounds[Math.min(sounds.length - 1, Math.floor(rng() * sounds.length))];
  }

  /**
   * @param {{ source: 'hotkey'|'whip'|'auto'|'tray' }} opts
   * @returns {Promise<{ typed: boolean, message?: string, tier?: string, skipped?: string, error?: string }>}
   */
  async function crack({ source = 'hotkey' } = {}) {
    const now = clock.now();
    if (inFlight || now - lastStart < BUSY_WINDOW_MS) {
      log.debug('crack skipped: busy');
      return { typed: false, skipped: 'busy' };
    }
    lastStart = now;
    inFlight = true;
    try {
      return await run(source);
    } finally {
      inFlight = false;
    }
  }

  async function run(source) {
    const tier = state.autoOn ? tierForCount(state.autoCount) : source === 'whip' ? 'medium' : 'mild';
    if (state.autoOn) state.autoCount = (state.autoCount ?? 0) + 1;

    const message = pickMessage(getPack(), tier, rng, state.lastMessage);
    state.lastMessage = message;
    const text = sanitizeForTyping(formatForDelivery(message, state.delivery));
    const config = getConfig();

    if (!state.muted) {
      const file = pickSound();
      if (file) audio.play(file, config?.sound?.volume ?? 0.8);
    }
    overlay.strike({ message, tier, prefix: state.delivery === 'btw' ? '/btw' : '' });
    log.info(`crack source=${source} tier=${tier}`);
    log.debug(`crack text=${text}`);

    const target = targets.get();
    if (!target) {
      toast('No target locked', 2500);
      return { typed: false, message, tier, error: 'no-target' };
    }

    let alive;
    try {
      alive = await targets.exists();
    } catch (err) {
      log.error('target check failed', err);
      toast('Typing failed', 3000);
      return { typed: false, message, tier, error: 'typing-failed' };
    }
    if (!alive) {
      toast('Target window closed', 3000);
      deps.onTargetLost?.();
      return { typed: false, message, tier, error: 'target-gone' };
    }

    let focused;
    try {
      focused = await platform.focusWindow(target.id);
    } catch (err) {
      if (err instanceof HelperError && err.code === HELPER_CODES.TARGET_GONE) {
        targets.clear();
        toast('Target window closed', 3000);
        deps.onTargetLost?.();
        return { typed: false, message, tier, error: 'target-gone' };
      }
      focused = false;
      log.error('focus failed', err);
    }
    if (!focused) {
      toast('Could not focus target', 3000);
      return { typed: false, message, tier, error: 'focus-failed' };
    }

    await clock.sleep(SETTLE_MS);

    try {
      await platform.typeText(target.id, text, { pressEnter: true });
    } catch (err) {
      if (err instanceof HelperError) {
        switch (err.code) {
          case HELPER_CODES.PERMISSION:
            state.typingAvailable = false;
            toast('Accessibility permission required', 3000);
            if (!accessibilityPrompted) {
              accessibilityPrompted = true;
              platform.openAccessibilitySettings?.();
            }
            return { typed: false, message, tier, error: 'permission' };
          case HELPER_CODES.TARGET_GONE:
            targets.clear();
            toast('Target window closed', 3000);
            deps.onTargetLost?.();
            return { typed: false, message, tier, error: 'target-gone' };
          case HELPER_CODES.UNSUPPORTED:
            toast(err.message, 3000);
            return { typed: false, message, tier, error: 'unsupported' };
          case HELPER_CODES.FOCUS_FAILED:
            toast('Could not focus target', 3000);
            return { typed: false, message, tier, error: 'focus-failed' };
          default:
            break;
        }
      }
      toast('Typing failed', 3000);
      log.error('typing failed', err);
      return { typed: false, message, tier, error: 'typing-failed' };
    }

    return { typed: true, message, tier };
  }

  return { crack };
}
