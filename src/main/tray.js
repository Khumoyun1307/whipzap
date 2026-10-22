// Tray icon and context menu. buildMenuTemplate is pure; createTray touches Electron.
// Menu order and copy are fixed by docs/UX.md section 3.

import path from 'node:path';

/**
 * @param {object} state { target, whipArmed, autoOn, autoCount, delivery, muted, autoCap }
 * @param {object} handlers { armWhip, dropWhip, crackNow, toggleAuto, setDelivery, toggleMute, openConfig, lockTarget, quit }
 * @param {object} hotkeys { crack, armWhip, toggleAuto } accelerators for hints
 */
export function buildMenuTemplate(state, handlers, hotkeys = {}) {
  return [
    {
      label: 'Arm whip',
      type: 'checkbox',
      checked: Boolean(state.whipArmed),
      accelerator: hotkeys.armWhip,
      click: () => (state.whipArmed ? handlers.dropWhip() : handlers.armWhip()),
    },
    { label: 'Crack now', accelerator: hotkeys.crack, click: () => handlers.crackNow() },
    {
      label: 'Auto mode',
      type: 'checkbox',
      checked: Boolean(state.autoOn),
      accelerator: hotkeys.toggleAuto,
      click: () => handlers.toggleAuto(),
    },
    { type: 'separator' },
    {
      label: 'Delivery',
      submenu: [
        { label: 'Safe (queued message)', type: 'radio', checked: state.delivery === 'safe', click: () => handlers.setDelivery('safe') },
        {
          label: '/btw (side question)',
          type: 'radio',
          checked: state.delivery === 'btw',
          toolTip: 'Claude Code only. Other agents receive it as plain text.',
          click: () => handlers.setDelivery('btw'),
        },
      ],
    },
    { label: 'Mute', type: 'checkbox', checked: Boolean(state.muted), click: () => handlers.toggleMute() },
    { type: 'separator' },
    { label: 'Open config', click: () => handlers.openConfig() },
    { label: 'Lock target', click: () => handlers.lockTarget() },
    { type: 'separator' },
    { label: 'Quit', click: () => handlers.quit() },
  ];
}

export function iconNameForState(state, platform = process.platform) {
  const mac = platform === 'darwin';
  if (state.whipArmed) return mac ? 'trayArmedTemplate.png' : 'tray-armed.png';
  if (state.autoOn) return mac ? 'trayLockedTemplate.png' : 'tray-auto.png';
  if (state.target) return mac ? 'trayLockedTemplate.png' : 'tray-locked.png';
  return mac ? 'trayTemplate.png' : 'tray-idle.png';
}

export function tooltipForState(state) {
  if (state.whipArmed) return 'WhipZap: whip armed';
  if (state.autoOn) return `WhipZap: auto mode, ${state.autoCount} of ${state.autoCap}`;
  if (state.target) {
    const title = String(state.target.title || state.target.processName || '');
    return `WhipZap: locked on ${title.length > 40 ? title.slice(0, 39) + '…' : title}`;
  }
  return 'WhipZap: no target locked';
}

/**
 * @param {{Tray, Menu, nativeImage}} electron
 * @param {string} iconsDir
 * @param {() => object} getState
 * @param {object} handlers
 * @param {() => object} getHotkeys
 */
export function createTray(electron, iconsDir, getState, handlers, getHotkeys) {
  const { Tray, Menu, nativeImage } = electron;
  const images = new Map();
  function image(name) {
    if (!images.has(name)) {
      const img = nativeImage.createFromPath(path.join(iconsDir, name));
      if (process.platform === 'darwin') img.setTemplateImage(true);
      images.set(name, img);
    }
    return images.get(name);
  }
  const state = getState();
  const tray = new Tray(image(iconNameForState(state)));
  tray.setToolTip(tooltipForState(state));

  function refresh() {
    const s = getState();
    tray.setImage(image(iconNameForState(s)));
    tray.setToolTip(tooltipForState(s));
    tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate(s, handlers, getHotkeys())));
  }
  refresh();
  if (process.platform !== 'darwin') {
    tray.on('click', () => tray.popUpContextMenu());
  }
  return { tray, refresh, destroy: () => tray.destroy() };
}
