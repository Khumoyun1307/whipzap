// Bottom-centre toast pill. One at a time; a new toast replaces the current one immediately.
// Spec: docs/UX.md section 8. Styles live in overlay.html; this module only drives opacity.

const FADE_IN_MS = 150;
const FADE_OUT_MS = 200;

let current = null;

/**
 * @param {HTMLElement} el the #toast element
 * @param {string} text
 * @param {number} ms visible duration before fade out
 * @returns {Promise<void>} resolves when the toast is hidden (or replaced)
 */
export function showToast(el, text, ms) {
  if (current) {
    clearTimeout(current.hideTimer);
    clearTimeout(current.doneTimer);
    current.resolve();
    current = null;
  }
  el.textContent = String(text ?? '');
  el.style.display = 'block';
  el.style.transition = `opacity ${FADE_IN_MS}ms ease-out`;
  // Force a style flush so the transition runs from 0.
  void el.offsetWidth;
  el.style.opacity = '1';

  return new Promise((resolve) => {
    const entry = { resolve, hideTimer: 0, doneTimer: 0 };
    entry.hideTimer = setTimeout(() => {
      el.style.transition = `opacity ${FADE_OUT_MS}ms ease-in`;
      el.style.opacity = '0';
      entry.doneTimer = setTimeout(() => {
        if (current === entry) {
          el.style.display = 'none';
          el.textContent = '';
          current = null;
        }
        resolve();
      }, FADE_OUT_MS);
    }, Math.max(0, Number(ms) || 0));
    current = entry;
  });
}
