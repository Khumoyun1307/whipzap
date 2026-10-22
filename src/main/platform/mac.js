// macOS adapter: one-shot invocations of src/main/helpers/mac/helper.sh (osascript / System Events).
// UNVERIFIED-ON-HARDWARE: written to the platform contract and unit-tested against a fake execFile;
// run the macOS checklist in docs/TESTING.md section 6.2 before trusting it.
//
// Contract (docs/ARCHITECTURE.md): text always travels on stdin, never in argv or a shell string.
// Window ids are process-level: 'pid:<unix id>'.

import { execFile as nodeExecFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HelperError, HELPER_CODES } from './errors.js';

const DEFAULT_HELPER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'mac', 'helper.sh');
export const ACCESSIBILITY_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
const EXEC_OPTIONS = Object.freeze({ timeout: 4000, maxBuffer: 65536 });

function parseJson(text) {
  try {
    return JSON.parse(String(text ?? '').trim());
  } catch {
    return null;
  }
}

export function createMacPlatform({
  execFileImpl = nodeExecFile,
  helperPath = DEFAULT_HELPER_PATH,
  platform = process.platform,
  log = () => {},
} = {}) {
  function run(cmd, args = [], stdinText = null) {
    return new Promise((resolve, reject) => {
      const child = execFileImpl('/bin/sh', [helperPath, cmd, ...args], { ...EXEC_OPTIONS }, (err, stdout, stderr) => {
        const parsed = parseJson(stdout);
        if (stderr) log('mac helper stderr:', String(stderr).trim());
        if (err) {
          const code = parsed?.code ?? (typeof err.code === 'number' ? err.code : HELPER_CODES.OTHER);
          const message = parsed?.error ?? (err.killed ? 'helper timeout' : String(stderr || err.message).trim());
          reject(new HelperError(code, message));
          return;
        }
        if (!parsed) {
          reject(new HelperError(HELPER_CODES.OTHER, 'helper returned no JSON'));
          return;
        }
        if (!parsed.ok) {
          reject(new HelperError(parsed.code ?? HELPER_CODES.OTHER, parsed.error ?? 'helper error'));
          return;
        }
        resolve(parsed);
      });
      if (child && child.stdin) {
        if (stdinText === null) child.stdin.end();
        else child.stdin.end(stdinText, 'utf8');
      }
    });
  }

  function toWindowInfo(msg) {
    return { id: String(msg.id), title: msg.title ?? '', processName: msg.processName ?? '', pid: Number(msg.pid) || 0 };
  }

  return {
    name: 'darwin',
    async isSupported() {
      if (platform !== 'darwin') return { ok: false, reason: 'macOS helper selected on a non-macOS platform' };
      return { ok: true };
    },
    // `prompt` is accepted for contract symmetry; the Electron-side prompt lives in app.js
    // (systemPreferences.isTrustedAccessibilityClient). The helper only reports.
    // eslint-disable-next-line no-unused-vars
    async checkPermissions({ prompt = false } = {}) {
      try {
        await run('check');
        return { ok: true };
      } catch (err) {
        if (err instanceof HelperError && err.code === HELPER_CODES.PERMISSION) {
          return { ok: false, message: 'Accessibility permission required' };
        }
        return { ok: false, message: err.message };
      }
    },
    async getForegroundWindow() {
      return toWindowInfo(await run('foreground'));
    },
    async getWindowInfo(id) {
      return toWindowInfo(await run('info', [String(id)]));
    },
    async focusWindow(id) {
      try {
        await run('focus', [String(id)]);
        return true;
      } catch (err) {
        if (err instanceof HelperError && err.code === HELPER_CODES.FOCUS_FAILED) return false;
        throw err;
      }
    },
    async typeText(id, text, { pressEnter = true } = {}) {
      const args = [String(id)];
      if (pressEnter) args.push('--enter');
      await run('type', args, String(text));
    },
    async openAccessibilitySettings() {
      await new Promise((resolve) => {
        execFileImpl('open', [ACCESSIBILITY_SETTINGS_URL], { ...EXEC_OPTIONS }, (err) => {
          if (err) log('open accessibility settings failed:', err.message);
          resolve();
        });
      });
    },
  };
}
