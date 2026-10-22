// WhipZap main process entry. Owns state, tray, hotkeys, config, scheduler, target lock, and the
// overlay window. Everything Electron-specific lives here or in the edge modules it imports.

import { app, Menu, Tray, nativeImage, globalShortcut, BrowserWindow, screen, ipcMain, nativeTheme, dialog, shell, protocol, net, systemPreferences } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { log } from './log.js';
import { configPath as configPathFor, loadConfig, saveConfig, watchConfig } from './config.js';
import { loadPack } from './messages.js';
import { decideSanity, isSelf, createTargetStore, DEFAULT_ALLOW_PATTERNS } from './target.js';
import { createCrack } from './crack.js';
import { createScheduler } from './scheduler.js';
import { createRng } from './prng.js';
import { registerHotkeys, unregisterHotkeys, describeAccelerator } from './hotkeys.js';
import { createTray } from './tray.js';
import { createOverlayWindow } from './overlay-window.js';
import { createPlatform } from './platform/index.js';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = path.join(APP_ROOT, 'assets');
const SOUNDS = ['crack-1.wav', 'crack-2.wav', 'crack-3.wav'];
const SELFTEST = process.argv.includes('--whipzap-selftest');

app.setName('whipzap');
// WHIPZAP_USER_DATA overrides the config directory (portable installs, tests).
if (process.env.WHIPZAP_USER_DATA) app.setPath('userData', process.env.WHIPZAP_USER_DATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'whipzap-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

if (!SELFTEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main().catch((err) => {
    log.error('fatal', err);
    app.exit(1);
  });
}

async function main() {
  await app.whenReady();
  app.dock?.hide();
  app.on('window-all-closed', () => {
    /* tray app keeps running */
  });

  protocol.handle('whipzap-asset', (request) => {
    const url = new URL(request.url);
    const rel = path.normalize(path.join(url.hostname, decodeURIComponent(url.pathname)));
    if (rel.includes('..')) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(path.join(ASSETS, rel)).toString());
  });

  if (SELFTEST) return runSelfTest();

  // ---------- config ----------
  const cfgPath = configPathFor(app.getPath('userData'));
  const cfgIo = { configPath: cfgPath, fs };
  let { config, warnings } = await loadConfig(cfgIo);
  warnings.forEach((w) => log.info('config:', w));
  let lastSavedJson = JSON.stringify(config);
  const configHadErrors = warnings.length > 0;

  const builtinPack = JSON.parse(await fs.readFile(path.join(ASSETS, 'messages', 'default.json'), 'utf8'));
  let pack = loadPack(builtinPack, config.messages).pack;
  const rng = createRng(config.auto.seed ?? (Date.now() ^ (process.pid << 8)) >>> 0);

  // ---------- state ----------
  const state = {
    whipArmed: false,
    autoOn: false,
    autoCount: 0,
    autoCap: config.auto.sessionCap,
    delivery: config.delivery,
    muted: config.sound.muted,
    typingAvailable: true,
    lastMessage: null,
    get target() {
      return targets.get();
    },
  };
  let pendingSource = 'hotkey';

  // ---------- platform ----------
  const platform = createPlatform();
  const support = await platform.isSupported();
  if (!support.ok) {
    state.typingAvailable = false;
    log.error('platform unsupported:', support.reason);
  }
  platform.start?.().catch((err) => log.error('platform start failed', err.message));
  platform.startPolling?.(1000);

  // ---------- overlay ----------
  const overlay = createOverlayWindow({ BrowserWindow, screen, ipcMain, nativeTheme }, APP_ROOT, { log, onMessage: onOverlayMessage });
  const toast = (text, ms = 2500) => {
    log.info('toast:', text);
    overlay.show();
    overlay.send('overlay:toast', { text, ms });
  };

  // ---------- targets ----------
  async function confirmWindow(info) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'Whip this window?',
      message: `"${info.title || '(no title)'}"`,
      detail: `${info.processName || 'unknown process'}\n\nThis does not look like a terminal or code editor. WhipZap will type messages into it.`,
      buttons: ['Whip it', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    return response === 0;
  }
  const patterns = [...DEFAULT_ALLOW_PATTERNS, ...(config.target?.allowPatterns ?? [])];
  const targets = createTargetStore({ platform, confirm: confirmWindow, selfPid: process.pid, patterns });

  async function ensureMacAccessibility() {
    if (process.platform !== 'darwin') return true;
    if (systemPreferences.isTrustedAccessibilityClient(false)) {
      state.typingAvailable = true;
      return true;
    }
    state.typingAvailable = false;
    systemPreferences.isTrustedAccessibilityClient(true);
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'WhipZap needs Accessibility access',
      message: 'WhipZap needs Accessibility access',
      detail:
        'WhipZap types its messages like a keyboard, which macOS only allows for apps listed under System Settings > Privacy & Security > Accessibility. Turn on the switch next to "Electron" (or next to the terminal app you launched WhipZap from), then lock the target again. Sound and visuals work without this.',
      buttons: ['Open Settings', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) await platform.openAccessibilitySettings?.();
    return false;
  }

  /** Lock using the foreground window (hotkey path) or the last polled foreground (tray path on Windows). */
  let locking = false;
  async function lockTarget(opts = {}) {
    if (locking) return false; // a confirm dialog may be open; ignore repeated hotkeys meanwhile
    locking = true;
    try {
      return await lockTargetInner(opts);
    } finally {
      locking = false;
    }
  }
  async function lockTargetInner({ fromTray = false, quiet = false } = {}) {
    await ensureMacAccessibility();
    let result;
    if (fromTray && platform.getLastForeground) {
      const info = platform.getLastForeground();
      if (!info) result = { ok: false, reason: 'self' };
      else if (isSelf(info, { selfPid: process.pid })) result = { ok: false, reason: 'self' };
      else if (decideSanity(info, patterns) === 'confirm' && !(await confirmWindow(info))) result = { ok: false, reason: 'declined' };
      else {
        targets.set(info);
        result = { ok: true, target: info };
      }
    } else {
      result = await targets.lockForeground();
    }
    if (result.ok) {
      const title = String(result.target.title || result.target.processName || '');
      toast(`Target locked: ${title.length > 60 ? title.slice(0, 59) + '…' : title}`, 2500);
    } else if (result.reason === 'self') {
      toast('Click your terminal first, then lock.', 3000);
    } else if (result.reason === 'error') {
      log.error('lock failed', result.error?.message);
      if (!quiet) toast('No target locked', 2500);
    }
    tray.refresh();
    return result.ok;
  }

  // ---------- crack ----------
  const crackDeps = {
    platform,
    targets,
    getPack: () => pack,
    getConfig: () => config,
    rng: () => rng.next(),
    state,
    sounds: SOUNDS,
    audio: {
      play(file, volume) {
        overlay.show();
        overlay.send('overlay:playSound', { file, volume });
      },
    },
    overlay: {
      strike({ message, tier, prefix }) {
        overlay.show();
        overlay.send('overlay:strike', { message, tier, prefix, seed: Math.floor(rng.next() * 2 ** 31), whip: pendingSource === 'whip' });
      },
    },
    toast,
    clock: { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    log,
    onTargetLost() {
      // The window being whipped is gone: stop everything that would keep cracking at nothing.
      if (state.autoOn) stopAuto('lost');
      if (state.whipArmed) dropWhip();
      tray.refresh();
    },
  };
  const { crack } = createCrack(crackDeps);

  async function crackFrom(source, { fromTray = false } = {}) {
    // Only explicit user actions may lock a target (D-2). Whip-mode and auto cracks never lock
    // whatever happens to be in the foreground; without a target they play sound and visual only.
    const mayLock = source === 'hotkey' || source === 'tray';
    if (!targets.get() && mayLock) {
      const ok = await lockTarget({ fromTray, quiet: true });
      if (!ok) {
        pendingSource = source;
        await crack({ source }); // still plays sound and visual, toasts "No target locked"
        return;
      }
    }
    pendingSource = source;
    const result = await crack({ source });
    log.debug('crack result', result);
    tray.refresh();
  }

  // ---------- whip mode ----------
  async function armWhip({ fromTray = false } = {}) {
    if (state.whipArmed) return;
    if (!targets.get() && !(await lockTarget({ fromTray }))) return;
    state.whipArmed = true;
    scheduler.pause();
    overlay.show();
    overlay.setMouseMode(true);
    overlay.send('overlay:spawnWhip', { seed: Math.floor(rng.next() * 2 ** 31), crackFactor: config.whip.crackFactor, cooldownMs: config.whip.cooldownMs });
    log.info('whip armed');
    tray.refresh();
  }
  function dropWhip() {
    if (!state.whipArmed) return;
    log.info('whip dropped');
    state.whipArmed = false;
    overlay.setMouseMode(false);
    overlay.send('overlay:dropWhip', {});
    if (state.autoOn) scheduler.resume();
    const target = targets.get();
    if (target) platform.focusWindow(target.id).catch((err) => log.debug('refocus after drop failed', err.message));
    tray.refresh();
  }

  // ---------- auto mode ----------
  const scheduler = createScheduler({
    config: () => config.auto, // getter so a config reload applies to the running session
    clock: { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t) },
    rng: () => rng.next(),
    onFire: async ({ count, tier }) => {
      log.info(`auto fire ${count} (${tier})`);
      await crackFrom('auto');
      tray.refresh();
    },
    onStop: ({ reason }) => {
      if (reason === 'cap') {
        state.autoOn = false;
        toast(`Auto session cap reached (${config.auto.sessionCap})`, 3500);
        tray.refresh();
      }
    },
  });
  async function toggleAuto({ fromTray = false } = {}) {
    log.info('toggleAuto', state.autoOn ? 'off' : 'on');
    if (state.autoOn) return stopAuto('user');
    if (!targets.get() && !(await lockTarget({ fromTray }))) {
      toast('No target locked', 2500);
      return;
    }
    state.autoOn = true;
    state.autoCount = 0;
    scheduler.start();
    if (state.whipArmed) scheduler.pause();
    toast('Auto mode on', 2000);
    tray.refresh();
  }
  function stopAuto(reason) {
    if (!state.autoOn) return;
    state.autoOn = false;
    scheduler.stop();
    toast('Auto mode off', 2000);
    log.info('auto off:', reason);
    tray.refresh();
  }

  // ---------- overlay messages ----------
  function onOverlayMessage(channel, payload) {
    switch (channel) {
      case 'overlay:cracked':
        log.info('whip cracked', JSON.stringify(payload));
        crackFrom('whip');
        break;
      case 'overlay:clicked':
        log.info('overlay clicked');
        dropWhip();
        break;
      case 'overlay:dropped':
        if (!state.whipArmed) overlay.hideSoon(200);
        break;
      case 'overlay:animationIdle':
        if (!state.whipArmed) overlay.hideSoon(200);
        break;
      case 'overlay:ready':
        log.info('overlay ready');
        break;
      default:
        break;
    }
  }

  // ---------- config persistence ----------
  let persistChain = Promise.resolve();
  function persist() {
    // Serialised: two quick tray toggles must not race on the same temp file.
    persistChain = persistChain.then(async () => {
      config = { ...config, delivery: state.delivery, sound: { ...config.sound, muted: state.muted } };
      try {
        await saveConfig(cfgIo, config);
        lastSavedJson = JSON.stringify(config);
      } catch (err) {
        log.error('config save failed', err.message);
      }
    });
    return persistChain;
  }

  // ---------- hotkeys ----------
  let hotkeyAccelerators = { ...config.hotkeys };
  function applyHotkeys() {
    const { failed } = registerHotkeys(globalShortcut, hotkeyAccelerators, {
      crack: () => crackFrom('hotkey'),
      armWhip: () => (state.whipArmed ? dropWhip() : armWhip()),
      toggleAuto: () => toggleAuto(),
    });
    for (const acc of failed) toast(`Hotkey ${describeAccelerator(acc)} is taken. Change it in config.`, 4000);
  }

  // ---------- tray ----------
  const tray = createTray(
    { Tray, Menu, nativeImage },
    path.join(ASSETS, 'icons'),
    () => ({ ...state, target: targets.get(), autoCount: scheduler.state().count }),
    {
      armWhip: () => armWhip({ fromTray: true }),
      dropWhip,
      crackNow: () => crackFrom('tray', { fromTray: true }),
      toggleAuto: () => toggleAuto({ fromTray: true }),
      setDelivery: (mode) => {
        state.delivery = mode;
        persist();
        tray.refresh();
      },
      toggleMute: () => {
        state.muted = !state.muted;
        toast(state.muted ? 'Muted' : 'Unmuted', 1500);
        persist();
        tray.refresh();
      },
      openConfig: async () => {
        try {
          await fs.access(cfgPath);
        } catch {
          await saveConfig(cfgIo, config);
        }
        shell.openPath(cfgPath);
      },
      lockTarget: () => lockTarget({ fromTray: true }),
      quit,
    },
    () => hotkeyAccelerators,
  );

  applyHotkeys();

  // ---------- config watcher ----------
  const watcher = watchConfig(cfgIo, async (result) => {
    if (JSON.stringify(result.config) === lastSavedJson && result.warnings.length === 0) return;
    if (result.warnings.length) {
      result.warnings.forEach((w) => log.info('config:', w));
      toast('Config invalid, using defaults', 4000);
    } else {
      toast('Config reloaded', 2000);
    }
    config = result.config;
    lastSavedJson = JSON.stringify(config);
    state.delivery = config.delivery;
    state.muted = config.sound.muted;
    state.autoCap = config.auto.sessionCap;
    pack = loadPack(builtinPack, config.messages).pack;
    patterns.splice(0, patterns.length, ...DEFAULT_ALLOW_PATTERNS, ...(config.target?.allowPatterns ?? []));
    if (JSON.stringify(config.hotkeys) !== JSON.stringify(hotkeyAccelerators)) {
      unregisterHotkeys(globalShortcut, hotkeyAccelerators);
      hotkeyAccelerators = { ...config.hotkeys };
      applyHotkeys();
    }
    tray.refresh();
  });

  // ---------- lifecycle ----------
  app.on('second-instance', () => toast('WhipZap is already running', 2500));
  async function quit() {
    log.info('quitting');
    try {
      watcher?.close?.();
      unregisterHotkeys(globalShortcut, hotkeyAccelerators);
      scheduler.stop();
      if (state.whipArmed) dropWhip();
      await platform.stop?.();
      tray.destroy();
      overlay.destroy();
    } finally {
      app.exit(0);
    }
  }
  app.on('before-quit', () => {
    unregisterHotkeys(globalShortcut, hotkeyAccelerators);
    scheduler.stop();
  });

  if (!support.ok) {
    await dialog.showMessageBox({ type: 'warning', title: 'WhipZap', message: unsupportedMessage(support.reason), buttons: ['OK'] });
  }
  if (configHadErrors) toast('Config invalid, using defaults', 4000);
  log.info(`WhipZap ready (${process.platform}, Electron ${process.versions.electron}), config at ${cfgPath}`);
}

function unsupportedMessage(reason = '') {
  if (/wayland/i.test(reason)) {
    return 'Wayland is not supported yet. WhipZap will play sounds and visuals, but it cannot type into windows under Wayland. Log in to an X11 session to use typing.';
  }
  if (/xdotool/i.test(reason)) {
    return 'xdotool is required for typing on Linux. Install it with your package manager (for example: sudo apt install xdotool), then restart WhipZap.';
  }
  return `Typing is unavailable on this system: ${reason}. Sounds and visuals still work.`;
}

/** --whipzap-selftest: create the overlay, run strike, spawn and drop, exit 0 if the renderer logged no errors. */
async function runSelfTest() {
  let errors = 0;
  const overlay = createOverlayWindow(
    { BrowserWindow, screen, ipcMain, nativeTheme },
    APP_ROOT,
    {
      log: { ...log, error: (...a) => { errors++; log.error(...a); } },
      onMessage: (channel, payload) => log.info('selftest overlay ->', channel, JSON.stringify(payload)),
    },
  );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + 15000;
  while (!overlay.isReady() && Date.now() < deadline) await sleep(50);
  if (!overlay.isReady()) {
    log.error('selftest: overlay never reported ready');
    app.exit(1);
    return;
  }
  log.info('displays', JSON.stringify(screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, scale: d.scaleFactor }))), 'primary', screen.getPrimaryDisplay().id);
  overlay.show();
  overlay.send('overlay:toast', { text: 'WhipZap self-test', ms: 1500 });
  overlay.send('overlay:playSound', { file: SOUNDS[0], volume: 0.5 });
  overlay.send('overlay:strike', { message: 'SELFTEST', tier: 'mild', prefix: '', seed: 42, whip: false });
  log.info('overlay hwnd', overlay.nativeHandle());
  await sleep(350);
  if (process.env.WHIPZAP_SELFTEST_CAPTURE) {
    const png = await overlay.capture();
    if (png) await fs.writeFile(process.env.WHIPZAP_SELFTEST_CAPTURE, png);
    log.info('captured overlay to', process.env.WHIPZAP_SELFTEST_CAPTURE, png?.length, 'bytes');
  }
  if (process.env.WHIPZAP_SELFTEST_SCREEN) {
    // Real screen capture through the OS capture API (GDI screenshots cannot see DirectComposition windows).
    const { desktopCapturer } = await import('electron');
    const { width, height } = screen.getPrimaryDisplay().size;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    const shot = sources[0]?.thumbnail?.toPNG();
    if (shot) await fs.writeFile(process.env.WHIPZAP_SELFTEST_SCREEN, shot);
    log.info('captured screen to', process.env.WHIPZAP_SELFTEST_SCREEN, shot?.length, 'bytes');
  }
  await sleep(350);
  overlay.setMouseMode(true);
  overlay.send('overlay:spawnWhip', { seed: 7 });
  await sleep(400);
  overlay.send('overlay:dropWhip', {});
  await sleep(1200);
  overlay.setMouseMode(false);
  log.info(`selftest done, renderer errors: ${errors}`);
  app.exit(errors ? 1 : 0);
}
