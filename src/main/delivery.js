// Delivery formatting: turns a chosen message into the exact text that is typed.
// There are exactly two modes (D-1). There is no interrupting mode and none may be added here.

const MODES = Object.freeze(['safe', 'btw']);
const MAX_TYPED_LENGTH = 200;

/**
 * Formats a message for the selected delivery mode. Enter is NOT included; the platform adapter sends it.
 * @param {string} message
 * @param {'safe'|'btw'} mode
 * @returns {string} text to type
 * @throws {Error} on empty message, embedded newlines, or unknown mode
 */
export function formatForDelivery(message, mode) {
  if (!MODES.includes(mode)) {
    throw new Error(`Unknown delivery mode "${mode}". Allowed: ${MODES.join(', ')}`);
  }
  if (typeof message !== 'string') {
    throw new Error('Message must be a string');
  }
  if (/[\r\n]/.test(message)) {
    throw new Error('Message must not contain newlines');
  }
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    throw new Error('Message must not be empty');
  }
  if (mode === 'btw') {
    return `/btw ${trimmed}`;
  }
  // Safe mode: a leading slash would be read as a slash command by the agent. A leading space prevents that.
  return trimmed.startsWith('/') ? ` ${trimmed}` : trimmed;
}

/**
 * Last gate before the helper: strips every control character, collapses whitespace, trims, caps length.
 * Unicode (including emoji) passes through untouched.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeForTyping(text) {
  const str = String(text ?? '');
  // C0 controls (0x00-0x1F incl. \t \r \n), DEL (0x7F), C1 controls (0x80-0x9F).
  // eslint-disable-next-line no-control-regex
  const stripped = str.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_TYPED_LENGTH ? collapsed.slice(0, MAX_TYPED_LENGTH) : collapsed;
}

export const DELIVERY_MODES = MODES;
