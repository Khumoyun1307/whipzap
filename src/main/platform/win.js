// Windows adapter: talks to src/main/helpers/win/worker.ps1 over a JSON-lines protocol.
// The worker is a long-lived PowerShell process so the inline C# (SetForegroundWindow + SendInput)
// is compiled once at startup instead of on every crack.
//
// Protocol: every request carries a `rid`; the worker echoes it on the response, so replies are
// matched by id and never by position. A timed-out request kills the worker (its reply could
// otherwise arrive late) and the next request starts a fresh one, with capped backoff.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HelperError, HELPER_CODES } from './errors.js';

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'win', 'worker.ps1');
const START_TIMEOUT_MS = 20000;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_START_FAILURES = 4;
const BACKOFF_MS = [1000, 3000, 8000, 20000];

export function createWindowsPlatform({ log = () => {}, selfPid = process.pid } = {}) {
  let child = null;
  let ready = null;
  let nextRid = 1;
  const pending = new Map(); // rid -> { resolve, reject, timer }
  let startFailures = 0;
  let blockedUntil = 0;
  let disabledReason = null;

  function rejectAllPending(err) {
    for (const [rid, req] of pending) {
      clearTimeout(req.timer);
      req.reject(err);
      pending.delete(rid);
    }
  }

  function killWorker(reason) {
    const c = child;
    child = null;
    ready = null;
    if (c) {
      log('helper: killing worker,', reason);
      try {
        c.kill();
      } catch {
        /* ignore */
      }
    }
    rejectAllPending(new HelperError(HELPER_CODES.OTHER, `Windows helper restarted (${reason})`));
  }

  function startWorker() {
    if (ready) return ready;
    if (disabledReason) return Promise.reject(new HelperError(HELPER_CODES.UNSUPPORTED, disabledReason));
    if (Date.now() < blockedUntil) {
      return Promise.reject(new HelperError(HELPER_CODES.OTHER, 'Windows helper is restarting, try again shortly'));
    }
    ready = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          startFailures += 1;
          const wait = BACKOFF_MS[Math.min(startFailures - 1, BACKOFF_MS.length - 1)];
          blockedUntil = Date.now() + wait;
          if (startFailures >= MAX_START_FAILURES) disabledReason = `Windows helper could not start (${err.message})`;
          child = null;
          ready = null;
          reject(err);
        } else {
          startFailures = 0;
          resolve();
        }
      };
      let proc;
      try {
        proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WORKER_PATH], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err) {
        finish(new HelperError(HELPER_CODES.OTHER, `Could not start PowerShell: ${err.message}`));
        return;
      }
      child = proc;
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
        finish(new HelperError(HELPER_CODES.OTHER, 'Windows helper did not start in time'));
      }, START_TIMEOUT_MS);
      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          log('helper: non-JSON line', line);
          return;
        }
        if (!settled) {
          if (msg.ready) finish(null);
          return;
        }
        const req = msg.rid !== undefined ? pending.get(msg.rid) : undefined;
        if (!req) {
          log('helper: unmatched response', line);
          return;
        }
        pending.delete(msg.rid);
        clearTimeout(req.timer);
        if (msg.ok) req.resolve(msg);
        else req.reject(new HelperError(msg.code ?? HELPER_CODES.OTHER, msg.error ?? 'helper error'));
      });
      proc.stdin.on('error', (err) => log('helper stdin error:', err.message));
      proc.stderr.on('data', (d) => log('helper stderr:', String(d).trim()));
      proc.on('error', (err) => finish(new HelperError(HELPER_CODES.OTHER, `Could not start PowerShell: ${err.message}`)));
      proc.on('exit', (code) => {
        log('helper exited', code);
        if (!settled) finish(new HelperError(HELPER_CODES.OTHER, `Windows helper exited with code ${code} before it was ready`));
        if (child === proc) {
          child = null;
          ready = null;
        }
        rejectAllPending(new HelperError(HELPER_CODES.OTHER, 'Windows helper exited'));
      });
    });
    return ready;
  }

  async function request(payload) {
    await startWorker();
    const proc = child;
    if (!proc) throw new HelperError(HELPER_CODES.OTHER, 'Windows helper is not running');
    const rid = nextRid++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(rid);
        reject(new HelperError(HELPER_CODES.OTHER, `helper timeout on ${payload.op}`));
        // A late reply must never be matched to anything, and a hung helper is useless: restart.
        killWorker(`timeout on ${payload.op}`);
      }, REQUEST_TIMEOUT_MS);
      let written = false;
      try {
        proc.stdin.write(JSON.stringify({ ...payload, rid }) + '\n');
        written = true;
      } catch (err) {
        clearTimeout(timer);
        reject(new HelperError(HELPER_CODES.OTHER, `helper write failed: ${err.message}`));
      }
      if (written) pending.set(rid, { resolve, reject, timer });
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
        if (disabledReason) {
          this.stopPolling();
          return;
        }
        if (Date.now() < blockedUntil) return;
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
      const c = child;
      try {
        c.stdin.write(JSON.stringify({ op: 'quit', rid: nextRid++ }) + '\n');
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          c.kill();
        } catch {
          /* ignore */
        }
      }, 500).unref();
      child = null;
      ready = null;
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
