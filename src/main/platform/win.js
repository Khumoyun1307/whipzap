// Windows adapter: talks to src/main/helpers/win/worker.ps1 over a JSON-lines protocol.
// The worker is a long-lived PowerShell process so the inline C# (SetForegroundWindow + SendInput)
// is compiled once at startup instead of on every crack.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HelperError, HELPER_CODES } from './errors.js';

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'win', 'worker.ps1');
const START_TIMEOUT_MS = 15000;
const REQUEST_TIMEOUT_MS = 5000;

export function createWindowsPlatform({ log = () => {}, selfPid = process.pid } = {}) {
  let child = null;
  let ready = null;
  const pending = [];

  function startWorker() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WORKER_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const timer = setTimeout(() => reject(new HelperError(HELPER_CODES.OTHER, 'Windows helper did not start in time')), START_TIMEOUT_MS);
      const rl = createInterface({ input: child.stdout });
      let isReady = false;
      rl.on('line', (line) => {
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          log('helper: non-JSON line', line);
          return;
        }
        if (!isReady) {
          if (msg.ready) {
            isReady = true;
            clearTimeout(timer);
            resolve();
          }
          return;
        }
        const req = pending.shift();
        if (!req) {
          log('helper: unexpected response', msg);
          return;
        }
        clearTimeout(req.timer);
        if (msg.ok) req.resolve(msg);
        else req.reject(new HelperError(msg.code ?? HELPER_CODES.OTHER, msg.error ?? 'helper error'));
      });
      child.stderr.on('data', (d) => log('helper stderr:', String(d).trim()));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new HelperError(HELPER_CODES.OTHER, `Could not start PowerShell: ${err.message}`));
      });
      child.on('exit', (code) => {
        log('helper exited', code);
        child = null;
        ready = null;
        const err = new HelperError(HELPER_CODES.OTHER, 'Windows helper exited');
        while (pending.length) {
          const req = pending.shift();
          clearTimeout(req.timer);
          req.reject(err);
        }
      });
    });
    return ready;
  }

  async function request(payload) {
    await startWorker();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = pending.findIndex((p) => p.resolve === resolve);
        if (i >= 0) pending.splice(i, 1);
        reject(new HelperError(HELPER_CODES.OTHER, `helper timeout on ${payload.op}`));
      }, REQUEST_TIMEOUT_MS);
      pending.push({ resolve, reject, timer });
      child.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  function toWindowInfo(msg) {
    return { id: String(msg.id), title: msg.title ?? '', processName: msg.processName ?? '', pid: msg.pid ?? 0 };
  }

  // Foreground polling: clicking the tray on Windows gives the taskbar (explorer) the foreground, so
  // a tray-initiated lock needs the window that was foreground just before the click. The warm
  // worker makes a 1 s poll cheap. Windows belonging to this process or to explorer are ignored.
  let lastForeground = null;
  let pollTimer = null;
  function isIgnorable(info) {
    if (!info) return true;
    if (info.pid === selfPid) return true;
    if (/^explorer$/i.test(info.processName)) return true;
    return false;
  }

  return {
    name: 'win32',
    async isSupported() {
      return { ok: true };
    },
    async checkPermissions() {
      return { ok: true };
    },
    async openAccessibilitySettings() {
      /* not applicable on Windows */
    },
    async start() {
      await startWorker();
    },
    startPolling(intervalMs = 1000) {
      if (pollTimer) return;
      const tick = async () => {
        try {
          const info = await this.getForegroundWindow();
          if (!isIgnorable(info)) lastForeground = info;
        } catch (err) {
          log('poll failed', err.message);
        }
      };
      pollTimer = setInterval(tick, intervalMs);
      pollTimer.unref?.();
      tick();
    },
    stopPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    },
    getLastForeground() {
      return lastForeground;
    },
    async stop() {
      this.stopPolling();
      if (!child) return;
      try {
        child.stdin.write(JSON.stringify({ op: 'quit' }) + '\n');
      } catch {
        /* ignore */
      }
      const c = child;
      setTimeout(() => {
        try {
          c.kill();
        } catch {
          /* ignore */
        }
      }, 500).unref();
    },
    async getForegroundWindow() {
      return toWindowInfo(await request({ op: 'foreground' }));
    },
    async getWindowInfo(id) {
      return toWindowInfo(await request({ op: 'info', id: String(id) }));
    },
    async focusWindow(id) {
      try {
        await request({ op: 'focus', id: String(id) });
        return true;
      } catch (err) {
        if (err instanceof HelperError && err.code === HELPER_CODES.FOCUS_FAILED) return false;
        throw err;
      }
    },
    async typeText(id, text, { pressEnter = true } = {}) {
      await request({ op: 'type', id: String(id), text: String(text), enter: Boolean(pressEnter) });
    },
  };
}
