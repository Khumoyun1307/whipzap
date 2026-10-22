// Linux X11 adapter: one-shot invocations of src/main/helpers/linux/helper.sh (xdotool).
// UNVERIFIED-ON-HARDWARE: written to the platform contract and unit-tested against a fake execFile;
// run the Linux checklist in docs/TESTING.md section 6.3 before trusting it.
//
// Contract (docs/ARCHITECTURE.md): text always travels on stdin, never in argv or a shell string.
// Window ids are X11 window ids as decimal strings (what `xdotool getactivewindow` prints).

import { execFile as nodeExecFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HelperError, HELPER_CODES } from './errors.js';

const DEFAULT_HELPER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'linux', 'helper.sh');
const EXEC_OPTIONS = Object.freeze({ timeout: 4000, maxBuffer: 65536 });

function parseJson(text) {
  try {
    return JSON.parse(String(text ?? '').trim());
  } catch {
    return null;
  }
}

export function createLinuxPlatform({
  execFileImpl = nodeExecFile,
  helperPath = DEFAULT_HELPER_PATH,
  platform = process.platform,
  env = process.env,
  log = () => {},
} = {}) {
  function run(cmd, args = [], stdinText = null) {
    return new Promise((resolve, reject) => {
      const child = execFileImpl('/bin/sh', [helperPath, cmd, ...args], { ...EXEC_OPTIONS, env }, (err, stdout, stderr) => {
        const parsed = parseJson(stdout);
        if (stderr) log('linux helper stderr:', String(stderr).trim());
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

  async function check() {
    try {
      await run('check');
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message, code: err.code ?? HELPER_CODES.OTHER };
    }
  }

  return {
    name: 'linux',
    async isSupported() {
      if (platform !== 'linux') return { ok: false, reason: 'Linux helper selected on a non-Linux platform' };
      const result = await check();
      return result.ok ? { ok: true } : { ok: false, reason: result.reason };
    },
    // eslint-disable-next-line no-unused-vars
    async checkPermissions({ prompt = false } = {}) {
      const result = await check();
      return result.ok ? { ok: true } : { ok: false, message: result.reason };
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
      // No equivalent on Linux; typing needs no OS permission beyond an X11 session with xdotool.
    },
  };
}
