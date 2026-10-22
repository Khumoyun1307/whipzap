// Fake platform adapter for unit tests. Records every call in order; failures are configured with HelperError codes.
import { HelperError } from '../../src/main/platform/errors.js';

/**
 * @param {{ foreground?: object, windows?: Record<string, object>, focusResult?: boolean,
 *           failures?: { getForegroundWindow?: number, getWindowInfo?: number, focusWindow?: number, typeText?: number } }} [opts]
 */
export function createFakePlatform(opts = {}) {
  const calls = [];
  const failures = { ...(opts.failures ?? {}) };
  const windows = { ...(opts.windows ?? {}) };
  let foreground = opts.foreground ?? null;
  if (foreground) windows[String(foreground.id)] = foreground;
  let focusResult = opts.focusResult ?? true;

  function maybeFail(method) {
    const code = failures[method];
    if (code != null) {
      throw new HelperError(code, `fake ${method} failed with code ${code}`);
    }
  }

  return {
    name: 'fake',
    calls,
    failures,
    windows,
    setForeground(info) {
      foreground = info;
      if (info) windows[String(info.id)] = info;
    },
    setFocusResult(value) {
      focusResult = value;
    },
    removeWindow(id) {
      delete windows[String(id)];
    },
    async isSupported() {
      calls.push({ method: 'isSupported' });
      return { ok: true };
    },
    async checkPermissions() {
      calls.push({ method: 'checkPermissions' });
      return { ok: true };
    },
    async getForegroundWindow() {
      calls.push({ method: 'getForegroundWindow' });
      maybeFail('getForegroundWindow');
      if (!foreground) throw new HelperError(3, 'no foreground window');
      return foreground;
    },
    async getWindowInfo(id) {
      calls.push({ method: 'getWindowInfo', id: String(id) });
      maybeFail('getWindowInfo');
      const info = windows[String(id)];
      if (!info) throw new HelperError(3, 'window gone');
      return info;
    },
    async focusWindow(id) {
      calls.push({ method: 'focusWindow', id: String(id) });
      maybeFail('focusWindow');
      return focusResult;
    },
    async typeText(id, text, options) {
      calls.push({ method: 'typeText', id: String(id), text, options: { ...(options ?? {}) } });
      maybeFail('typeText');
    },
    async openAccessibilitySettings() {
      calls.push({ method: 'openAccessibilitySettings' });
    },
  };
}
