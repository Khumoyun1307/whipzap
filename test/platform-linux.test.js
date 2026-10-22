import { describe, it, expect } from 'vitest';
import { createLinuxPlatform } from '../src/main/platform/linux.js';
import { HelperError, HELPER_CODES } from '../src/main/platform/errors.js';

const HELPER = '/fake/helper.sh';

function fakeExec(responder) {
  const calls = [];
  const impl = (file, args, opts, cb) => {
    const chunks = [];
    const call = { file, args, opts, stdin: '' };
    calls.push(call);
    const r = responder(args, file) ?? { stdout: '{"ok":true}' };
    setImmediate(() => {
      call.stdin = chunks.join('');
      if (r.exit) {
        const err = new Error(`exit ${r.exit}`);
        err.code = r.exit;
        cb(err, r.stdout ?? '', r.stderr ?? '');
      } else {
        cb(null, r.stdout ?? '', r.stderr ?? '');
      }
    });
    return { stdin: { end(data) { if (data !== undefined) chunks.push(String(data)); } } };
  };
  return { impl, calls };
}

function make(responder = () => undefined, extra = {}) {
  const fx = fakeExec(responder);
  const env = { DISPLAY: ':0' };
  const platform = createLinuxPlatform({ execFileImpl: fx.impl, helperPath: HELPER, platform: 'linux', env, ...extra });
  return { platform, calls: fx.calls, env };
}

describe('linux adapter argv', () => {
  it('foreground invokes /bin/sh helper foreground with env and maps fields', async () => {
    const { platform, calls, env } = make(() => ({ stdout: '{"ok":true,"id":"12345","title":"bash","processName":"gnome-terminal-","pid":99}' }));
    const info = await platform.getForegroundWindow();
    expect(calls[0].file).toBe('/bin/sh');
    expect(calls[0].args).toEqual([HELPER, 'foreground']);
    expect(calls[0].opts.env).toBe(env);
    expect(calls[0].opts.maxBuffer).toBe(65536);
    expect(info).toEqual({ id: '12345', title: 'bash', processName: 'gnome-terminal-', pid: 99 });
  });

  it('info and focus pass the window id', async () => {
    const { platform, calls } = make(() => ({ stdout: '{"ok":true,"id":"5","title":"t","processName":"","pid":0}' }));
    await platform.getWindowInfo('5');
    expect(await platform.focusWindow('5')).toBe(true);
    expect(calls[0].args).toEqual([HELPER, 'info', '5']);
    expect(calls[1].args).toEqual([HELPER, 'focus', '5']);
  });

  it('type sends text on stdin only and appends --enter by default', async () => {
    const text = 'WORK HARDER! `id` ; rm -rf ~ 🐢';
    const { platform, calls } = make();
    await platform.typeText('5', text);
    expect(calls[0].args).toEqual([HELPER, 'type', '5', '--enter']);
    expect(calls[0].stdin).toBe(text);
    expect(calls[0].args.some((a) => a.includes('WORK'))).toBe(false);
  });

  it('type omits --enter when pressEnter is false', async () => {
    const { platform, calls } = make();
    await platform.typeText('5', 'x', { pressEnter: false });
    expect(calls[0].args).toEqual([HELPER, 'type', '5']);
  });
});

describe('linux adapter support and errors', () => {
  it('isSupported runs check and reports ok', async () => {
    const { platform, calls } = make();
    expect(await platform.isSupported()).toEqual({ ok: true });
    expect(calls[0].args).toEqual([HELPER, 'check']);
  });

  it('isSupported surfaces the Wayland reason from code 4', async () => {
    const { platform } = make(() => ({ exit: 4, stdout: '{"ok":false,"code":4,"error":"Wayland is not supported"}' }));
    expect(await platform.isSupported()).toEqual({ ok: false, reason: 'Wayland is not supported' });
  });

  it('isSupported surfaces missing xdotool', async () => {
    const { platform } = make(() => ({ exit: 4, stdout: '{"ok":false,"code":4,"error":"xdotool not found"}' }));
    expect(await platform.checkPermissions()).toEqual({ ok: false, message: 'xdotool not found' });
  });

  it('isSupported is false off Linux without spawning', async () => {
    const { platform, calls } = make(() => undefined, { platform: 'darwin' });
    expect((await platform.isSupported()).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('maps JSON error codes to HelperError', async () => {
    const { platform } = make(() => ({ exit: 3, stdout: '{"ok":false,"code":3,"error":"window 5 is gone"}' }));
    await expect(platform.typeText('5', 'x')).rejects.toMatchObject({ name: 'HelperError', code: HELPER_CODES.TARGET_GONE, message: 'window 5 is gone' });
  });

  it('focus returns false on code 5 and rethrows others', async () => {
    const five = make(() => ({ exit: 5, stdout: '{"ok":false,"code":5,"error":"not active"}' }));
    expect(await five.platform.focusWindow('5')).toBe(false);
    const other = make(() => ({ exit: 1, stdout: '{"ok":false,"code":1,"error":"x"}' }));
    await expect(other.platform.focusWindow('5')).rejects.toBeInstanceOf(HelperError);
  });

  it('uses the exit code when stdout is not JSON and marks timeouts', async () => {
    const { platform } = make(() => ({ exit: 1, stdout: 'garbage', stderr: 'xdotool: command failed' }));
    await expect(platform.getForegroundWindow()).rejects.toMatchObject({ code: HELPER_CODES.OTHER, message: 'xdotool: command failed' });
  });

  it('openAccessibilitySettings is a no-op', async () => {
    const { platform, calls } = make();
    await platform.openAccessibilitySettings();
    expect(calls).toHaveLength(0);
  });
});
