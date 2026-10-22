// The transparent always-on-top overlay window (docs/ARCHITECTURE.md 2.1) and its IPC plumbing.

import path from 'node:path';

const MAIN_TO_OVERLAY = new Set([
  'overlay:strike',
  'overlay:spawnWhip',
  'overlay:dropWhip',
  'overlay:toast',
  'overlay:playSound',
  'overlay:setReduceMotion',
  'overlay:setMouseMode',
]);

/**
 * @param {{BrowserWindow, screen, ipcMain, nativeTheme}} electron
 * @param {string} appRoot
 * @param {{log, onMessage(channel, payload): void}} opts
 */
export function createOverlayWindow(electron, appRoot, { log, onMessage }) {
  const { BrowserWindow, screen, ipcMain, nativeTheme } = electron;
  let win = null;
  let ready = false;
  let queued = [];
  let hideTimer = null;

  function bounds() {
    return screen.getPrimaryDisplay().bounds;
  }

  function create() {
    const b = bounds();
    win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      transparent: true,
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: 'WhipZap',
      webPreferences: {
        preload: path.join(appRoot, 'src', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    ready = false;
    win.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform !== 'win32') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setMenu?.(null);
    win.webContents.on('render-process-gone', (_e, details) => {
      log.error('overlay renderer gone', details.reason);
      try {
        win.destroy();
      } catch {
        /* ignore */
      }
      create();
    });
    win.webContents.on('console-message', (event) => {
      const level = event.level;
      const message = event.message;
      const isError = level === 'error' || level === 'warning' || (typeof level === 'number' && level >= 2);
      if (isError) log.error('overlay console:', message);
      else log.debug('overlay console:', message);
    });
    win.loadFile(path.join(appRoot, 'src', 'overlay', 'overlay.html'));
  }

  ipcMain.on('overlay:ready', () => {
    ready = true;
    send('overlay:setReduceMotion', { enabled: Boolean(nativeTheme?.prefersReducedTransparency) });
    for (const [c, p] of queued) send(c, p);
    queued = [];
    onMessage('overlay:ready', {});
  });
  for (const channel of ['overlay:cracked', 'overlay:dropped', 'overlay:clicked', 'overlay:animationIdle']) {
    ipcMain.on(channel, (_e, payload) => onMessage(channel, payload ?? {}));
  }

  function send(channel, payload) {
    if (!MAIN_TO_OVERLAY.has(channel)) throw new Error(`unknown overlay channel ${channel}`);
    if (!win || win.isDestroyed()) return;
    if (!ready) {
      queued.push([channel, payload]);
      return;
    }
    win.webContents.send(channel, payload);
  }

  function show() {
    if (!win || win.isDestroyed()) return;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    const b = bounds();
    if (win.getBounds().width !== b.width || win.getBounds().height !== b.height) win.setBounds(b);
    if (!win.isVisible()) win.showInactive();
  }

  function hideSoon(ms = 200) {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (win && !win.isDestroyed()) win.hide();
    }, ms);
  }

  function setMouseMode(interactive) {
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(!interactive, { forward: true });
    send('overlay:setMouseMode', { interactive });
  }

  screen.on('display-metrics-changed', () => {
    if (win && !win.isDestroyed()) win.setBounds(bounds());
  });

  create();
  return {
    send,
    show,
    hideSoon,
    setMouseMode,
    isReady: () => ready,
    destroy: () => {
      if (win && !win.isDestroyed()) win.destroy();
    },
  };
}
