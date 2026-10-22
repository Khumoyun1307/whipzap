// Overlay renderer bootstrap. Owns the single requestAnimationFrame loop, routes IPC from the
// preload bridge, and drives the strike, rope, message, and toast layers.
// Spec: docs/ARCHITECTURE.md sections 3, 4.12, 7; docs/UX.md sections 6, 7, 8.

import { createStrike, stepStrike, drawStrike } from './strike.js';
import { createRope, stepRope, drawRope, tipSpeed, crackThreshold, isOffscreen } from './rope.js';
import { showToast } from './toast.js';
import { createAudio } from './audio.js';

const SOUND_FILES = ['crack-1.wav', 'crack-2.wav', 'crack-3.wav'];
const MESSAGE_IN_MS = 120;
const MESSAGE_HOLD_MS = 1200;
const MESSAGE_OUT_MS = 200;
const WHIP_GRACE_MS = 400;
let whipCooldownMs = 600; // overridable per spawn (config.whip.cooldownMs)
const DROP_TIMEOUT_MS = 1500;
const HIT_TEST_FILL = 'rgba(0,0,0,0.004)';

// Feature-detect the bridge so the page can be opened in a plain browser without throwing.
const bridge = globalThis.whipzap ?? {
  on() {
    return () => {};
  },
  send(channel, payload) {
    console.info('whipzap (no bridge):', channel, payload);
  },
  soundUrl(file) {
    return `../../assets/sounds/${file}`;
  },
};

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const messageEl = document.getElementById('message');
const prefixEl = messageEl.querySelector('.prefix');
const textEl = messageEl.querySelector('.text');
const toastEl = document.getElementById('toast');
const audio = createAudio((file) => bridge.soundUrl(file));

let width = 0;
let height = 0;
let strike = null;
let rope = null;
let ropeMode = null; // 'armed' | 'dropping'
let ropeSpawnedAt = 0;
let ropeDropAt = 0;
let lastCrackAt = -Infinity;
let messageActive = false;
let messageTimers = [];
let toastActive = false;
let rafId = null;
let lastNow = 0;
let reduceMotionOverride = null;
const mouse = { x: null, y: null };
const reduceMotionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

function reduceMotion() {
  if (reduceMotionOverride !== null) return reduceMotionOverride;
  return Boolean(reduceMotionQuery && reduceMotionQuery.matches);
}

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function anyActive() {
  return Boolean(strike || rope || messageActive || toastActive);
}

function ensureLoop() {
  if (rafId === null) {
    lastNow = performance.now();
    rafId = requestAnimationFrame(frame);
  }
}

function frame(now) {
  rafId = null;
  const dt = Math.min(100, Math.max(0, now - lastNow));
  lastNow = now;
  ctx.clearRect(0, 0, width, height);

  if (rope) {
    const head = ropeMode === 'armed' ? currentHead() : null;
    stepRope(rope, head, dt);
    if (ropeMode === 'armed') {
      ctx.fillStyle = HIT_TEST_FILL;
      ctx.fillRect(0, 0, width, height);
      detectCrack(now);
    }
    drawRope(rope, ctx);
    if (ropeMode === 'dropping' && (isOffscreen(rope) || now - ropeDropAt > DROP_TIMEOUT_MS)) finishDrop();
  }

  if (strike) {
    if (stepStrike(strike, dt)) drawStrike(strike, ctx);
    else strike = null;
  }

  if (anyActive()) {
    rafId = requestAnimationFrame(frame);
  } else {
    ctx.clearRect(0, 0, width, height);
    hideMessageNow();
    bridge.send('overlay:animationIdle', {});
  }
}

function currentHead() {
  if (mouse.x === null) return { x: width / 2, y: height / 2 };
  return { x: mouse.x, y: mouse.y };
}

function detectCrack(now) {
  if (now - ropeSpawnedAt < WHIP_GRACE_MS) return;
  if (now - lastCrackAt < whipCooldownMs) return;
  const speed = tipSpeed(rope);
  if (speed > crackThreshold(rope)) {
    lastCrackAt = now;
    rope.burstAt = rope.elapsed;
    bridge.send('overlay:cracked', { tipSpeed: speed });
  }
}

function spawnWhip(payload = {}) {
  const head = currentHead();
  if (Number.isFinite(payload.cooldownMs)) whipCooldownMs = payload.cooldownMs;
  rope = createRope({
    x: head.x,
    y: head.y,
    segmentLength: Math.min(width, height) / 45,
    width,
    height,
    ...(Number.isFinite(payload.crackFactor) ? { crackFactor: payload.crackFactor } : {}),
  });
  ropeMode = 'armed';
  ropeSpawnedAt = performance.now();
  lastCrackAt = -Infinity;
  document.body.classList.add('whip');
  ensureLoop();
}

function dropWhip() {
  if (!rope || ropeMode === 'dropping') return;
  ropeMode = 'dropping';
  ropeDropAt = performance.now();
  ensureLoop();
}

function finishDrop() {
  rope = null;
  ropeMode = null;
  document.body.classList.remove('whip');
  bridge.send('overlay:dropped', {});
}

function clearMessageTimers() {
  for (const t of messageTimers) clearTimeout(t);
  messageTimers = [];
}

function hideMessageNow() {
  clearMessageTimers();
  messageActive = false;
  messageEl.style.display = 'none';
  messageEl.style.opacity = '0';
  textEl.textContent = '';
  prefixEl.textContent = '';
}

function showMessage({ message, tier, prefix }) {
  clearMessageTimers();
  messageActive = true;
  textEl.textContent = String(message ?? '');
  prefixEl.textContent = prefix ? String(prefix) : '';
  messageEl.dataset.tier = ['mild', 'medium', 'spicy'].includes(tier) ? tier : 'mild';
  messageEl.style.display = 'block';
  messageEl.style.opacity = '1';
  const base = 'translateX(-50%)';
  const inAnim = reduceMotion()
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        { transform: `${base} scale(1.3)`, opacity: 0 },
        { transform: `${base} scale(0.96)`, opacity: 1, offset: 0.7 },
        { transform: `${base} scale(1)`, opacity: 1 },
      ];
  if (typeof messageEl.animate === 'function') messageEl.animate(inAnim, { duration: MESSAGE_IN_MS, fill: 'forwards' });
  messageTimers.push(
    setTimeout(() => {
      if (typeof messageEl.animate === 'function') {
        messageEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MESSAGE_OUT_MS, fill: 'forwards' });
      } else {
        messageEl.style.opacity = '0';
      }
      messageTimers.push(
        setTimeout(() => {
          hideMessageNow();
          ensureLoop();
        }, MESSAGE_OUT_MS),
      );
    }, MESSAGE_IN_MS + MESSAGE_HOLD_MS),
  );
  ensureLoop();
}

function onStrike(payload = {}) {
  const seed = Number.isFinite(payload.seed) ? payload.seed : (Date.now() & 0xffffffff) >>> 0;
  if (!payload.whip) strike = createStrike({ seed, width, height, reduceMotion: reduceMotion() });
  showMessage(payload);
}

function onToast(payload = {}) {
  toastActive = true;
  ensureLoop();
  showToast(toastEl, payload.text, payload.ms ?? 2500).then(() => {
    toastActive = false;
    ensureLoop();
  });
}

function onPlaySound(payload = {}) {
  if (!SOUND_FILES.includes(payload.file)) {
    console.warn('whipzap: unknown sound', payload.file);
    return;
  }
  audio.play(payload.file, payload.volume ?? 0.8);
}

window.addEventListener('resize', resize);
window.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
window.addEventListener('mousedown', (e) => {
  console.log('whipzap overlay mousedown', e.button, ropeMode);
  if (ropeMode === 'armed') bridge.send('overlay:clicked', {});
});
if (reduceMotionQuery && typeof reduceMotionQuery.addEventListener === 'function') {
  reduceMotionQuery.addEventListener('change', () => {});
}

bridge.on('overlay:strike', onStrike);
bridge.on('overlay:spawnWhip', (payload = {}) => spawnWhip(payload));
bridge.on('overlay:dropWhip', () => dropWhip());
bridge.on('overlay:toast', onToast);
bridge.on('overlay:playSound', onPlaySound);
bridge.on('overlay:setReduceMotion', (payload = {}) => {
  reduceMotionOverride = typeof payload.enabled === 'boolean' ? payload.enabled : null;
});
bridge.on('overlay:setMouseMode', () => {
  // Main toggles setIgnoreMouseEvents itself; nothing to do in the renderer.
});

resize();
hideMessageNow();
audio.preload(SOUND_FILES);
bridge.send('overlay:ready', {});
