// Preload bridge for the overlay renderer. Runs with sandbox: true, so CommonJS only.
// Exposes a minimal, allowlisted API as window.whipzap. See docs/ARCHITECTURE.md section 3.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const TO_OVERLAY = new Set([
  'overlay:strike',
  'overlay:spawnWhip',
  'overlay:dropWhip',
  'overlay:toast',
  'overlay:playSound',
  'overlay:setReduceMotion',
  'overlay:setMouseMode',
]);

const TO_MAIN = new Set([
  'overlay:cracked',
  'overlay:dropped',
  'overlay:clicked',
  'overlay:animationIdle',
  'overlay:ready',
]);

const SOUND_NAME = /^[a-z0-9-]+\.wav$/;

contextBridge.exposeInMainWorld('whipzap', {
  /** Subscribe to a main-to-overlay channel. Returns an unsubscribe function. */
  on(channel, fn) {
    if (!TO_OVERLAY.has(channel)) throw new Error(`whipzap: channel not allowed: ${channel}`);
    if (typeof fn !== 'function') throw new TypeError('whipzap: listener must be a function');
    const listener = (_event, payload) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  /** Send a plain JSON payload on an overlay-to-main channel. */
  send(channel, payload) {
    if (!TO_MAIN.has(channel)) throw new Error(`whipzap: channel not allowed: ${channel}`);
    ipcRenderer.send(channel, payload == null ? {} : payload);
  },
  /** URL for a shipped sound file, served by the whipzap-asset protocol. */
  soundUrl(file) {
    if (typeof file !== 'string' || !SOUND_NAME.test(file)) throw new Error(`whipzap: invalid sound file: ${file}`);
    return `whipzap-asset://sounds/${file}`;
  },
});
