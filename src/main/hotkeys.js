// Global hotkey registration. Thin wrapper over Electron's globalShortcut, injected for testability.

/**
 * @param {{register(acc, fn): boolean, unregister(acc): void}} globalShortcut
 * @param {{crack: string, armWhip: string, toggleAuto: string}} accelerators
 * @param {{crack(): void, armWhip(): void, toggleAuto(): void}} handlers
 * @returns {{ registered: string[], failed: string[] }}
 */
export function registerHotkeys(globalShortcut, accelerators, handlers) {
  const registered = [];
  const failed = [];
  for (const [name, accelerator] of Object.entries(accelerators)) {
    if (!Object.hasOwn(handlers, name)) continue; // never bind inherited names like "constructor"
    const handler = handlers[name];
    if (typeof handler !== 'function' || !accelerator) continue;
    let ok;
    try {
      ok = globalShortcut.register(accelerator, handler);
    } catch {
      ok = false;
    }
    (ok ? registered : failed).push(accelerator);
  }
  return { registered, failed };
}

export function unregisterHotkeys(globalShortcut, accelerators) {
  for (const accelerator of Object.values(accelerators)) {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      /* ignore */
    }
  }
}

/** Human-readable accelerator for toasts: CommandOrControl → Ctrl (Cmd on macOS). */
export function describeAccelerator(accelerator, platform = process.platform) {
  const primary = platform === 'darwin' ? 'Cmd' : 'Ctrl';
  return String(accelerator).replace(/CommandOrControl|CmdOrCtrl/g, primary).replace(/Command|Cmd/g, 'Cmd').replace(/Control/g, 'Ctrl');
}
