// Error type shared by all platform adapters.
// Codes follow the helper contract in docs/ARCHITECTURE.md:
//   1 other, 2 permission, 3 target gone, 4 unsupported, 5 focus failed.

export const HELPER_CODES = Object.freeze({
  OTHER: 1,
  PERMISSION: 2,
  TARGET_GONE: 3,
  UNSUPPORTED: 4,
  FOCUS_FAILED: 5,
});

export class HelperError extends Error {
  /**
   * @param {number} code one of HELPER_CODES
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'HelperError';
    this.code = code;
  }
}
