// Platform adapter factory. Every adapter implements the contract in docs/ARCHITECTURE.md:
//   isSupported()            -> Promise<{ok, reason?}>
//   checkPermissions()       -> Promise<{ok, message?}>
//   getForegroundWindow()    -> Promise<WindowInfo>   WindowInfo = {id, title, processName, pid}
//   getWindowInfo(id)        -> Promise<WindowInfo>   throws HelperError(3) when gone
//   focusWindow(id)          -> Promise<boolean>
//   typeText(id, text, {pressEnter}) -> Promise<void> throws HelperError
//   start()/stop()           -> optional lifecycle for adapters that keep a worker process
//
// Electron is never imported here so the adapters can be exercised from plain Node (see test/helpers).

import { createWindowsPlatform } from './win.js';
import { createMacPlatform } from './mac.js';
import { createLinuxPlatform } from './linux.js';

export { HelperError, HELPER_CODES } from './errors.js';

/**
 * @param {string} [platform] defaults to process.platform
 */
export function createPlatform(platform = process.platform) {
  switch (platform) {
    case 'win32':
      return createWindowsPlatform();
    case 'darwin':
      return createMacPlatform();
    case 'linux':
      return createLinuxPlatform();
    default:
      return createUnsupportedPlatform(platform);
  }
}

function createUnsupportedPlatform(name) {
  const reason = `Platform ${name} is not supported`;
  const reject = () => Promise.reject(new Error(reason));
  return {
    name,
    isSupported: async () => ({ ok: false, reason }),
    checkPermissions: async () => ({ ok: false, message: reason }),
    getForegroundWindow: reject,
    getWindowInfo: reject,
    focusWindow: reject,
    typeText: reject,
  };
}
