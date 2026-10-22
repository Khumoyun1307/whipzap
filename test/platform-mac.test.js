import { describe, it, expect } from 'vitest';
import { createMacPlatform, ACCESSIBILITY_SETTINGS_URL } from '../src/main/platform/mac.js';
import { HelperError, HELPER_CODES } from '../src/main/platform/errors.js';

const HELPER = '/fake/helper.sh';

// Fake execFile: records argv and stdin, answers from a responder(args) => { stdout, exit? }.
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
  const platform = createMacPlatform({ execFileImpl: fx.impl, helperPath: HELPER, platform: 'darwin', ...extra });
  return { platform, calls: fx.calls };
}

describe('mac adapter argv', () => {
  it('foreground invokes /bin/sh helper foreground and maps fields', async () => {
    const { platform, calls } = make(() => ({ stdout: '{"ok":true,"id":"pid:42","title":"zsh","processName":"Terminal","pid":42}' }));
    const info = await platform.getForegroundWindow();
    expect(calls[0].file).toBe('/bin/sh');
    expect(calls[0].args).toEqual([HELPER, 'foreground']);
    expect(calls[0].opts.timeout).toBe(4000);
    expect(info).toEqual({ id: 'pid:42', title: 'zsh', processName: 'Terminal', pid: 42 });
  });

  it('info passes the id', async () => {
    const { platform, calls } = make(() => ({ stdout: '{"ok":true,"id":"pid:7","title":"","processName":"iTerm2","pid":7}' }));
    await platform.getWindowInfo('pid:7');
    expect(calls[0].args).toEqual([HELPER, 'info', 'pid:7']);
  });

  it('focus passes the id and resolves true', async () => {
    const { platform, calls } = make();
    expect(await platform.focusWindow('pid:7')).toBe(true);
    expect(calls[0].args).toEqual([HELPER, 'focus', 'pid:7']);
  });

  it('type sends text on stdin, never in argv, and appends --enter by default', async () => {
    const text = 'FASTER! "quoted" $(rm -rf /) ünï';
    const { platform, calls } = make();
    await platform.typeText('pid:7', text);
    expect(calls[0].args).toEqual([HELPER, 'type', 'pid:7', '--enter']);
    expect(calls[0].stdin).toBe(text);
    expect(calls[0].args.join(' ')).not.toContain('FASTER');
  });

  it('type omits --enter when pressEnter is false', async () => {
    const { platform, calls } = make();
    await platform.typeText('pid:7', 'x', { pressEnter: false });
    expect(calls[0].args).toEqual([HELPER, 'type', 'pid:7']);
  });

  it('check runs for checkPermissions', async () => {
    const { platform, calls } = make();
    expect(await platform.checkPermissions()).toEqual({ ok: true });
    expect(calls[0].args).toEqual([HELPER, 'check']);
  });
});

describe('mac adapter errors', () => {
  it('maps helper JSON code to HelperError', async () => {
    const { platform } = make(() => ({ exit: 3, stdout: '{"ok":false,"code":3,"error":"gone"}' }));
    await expect(platform.getWindowInfo('pid:1')).rejects.toMatchObject({ name: 'HelperError', code: HELPER_CODES.TARGET_GONE, message: 'gone' });
  });

  it('focus returns false on code 5 and rethrows other codes', async () => {
    const five = make(() => ({ exit: 5, stdout: '{"ok":false,"code":5,"error":"nope"}' }));
    expect(await five.platform.focusWindow('pid:1')).toBe(false);
    const three = make(() => ({ exit: 3, stdout: '{"ok":false,"code":3,"error":"gone"}' }));
    await expect(three.platform.focusWindow('pid:1')).rejects.toBeInstanceOf(HelperError);
  });

  it('checkPermissions reports a permission problem without throwing', async () => {
    const { platform } = make(() => ({ exit: 2, stdout: '{"ok":false,"code":2,"error":"not allowed assistive access"}' }));
    expect(await platform.checkPermissions()).toEqual({ ok: false, message: 'Accessibility permission required' });
  });

  it('falls back to the exit code when stdout is not JSON', async () => {
    const { platform } = make(() => ({ exit: 1, stdout: '', stderr: 'boom' }));
    await expect(platform.typeText('pid:1', 'x')).rejects.toMatchObject({ code: HELPER_CODES.OTHER, message: 'boom' });
  });

  it('rejects when the helper prints nothing', async () => {
    const { platform } = make(() => ({ stdout: '' }));
    await expect(platform.getForegroundWindow()).rejects.toMatchObject({ code: HELPER_CODES.OTHER });
  });
});

describe('mac adapter misc', () => {
  it('isSupported is false off macOS', async () => {
    const { platform } = make(() => undefined, { platform: 'win32' });
    expect((await platform.isSupported()).ok).toBe(false);
    const mac = make();
    expect(await mac.platform.isSupported()).toEqual({ ok: true });
  });

  it('openAccessibilitySettings calls open with the exact URL', async () => {
    const { platform, calls } = make();
    await platform.openAccessibilitySettings();
    expect(calls[0].file).toBe('open');
    expect(calls[0].args).toEqual([ACCESSIBILITY_SETTINGS_URL]);
    expect(ACCESSIBILITY_SETTINGS_URL).toBe('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  });
});
