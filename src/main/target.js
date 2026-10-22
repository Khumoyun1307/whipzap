// Target lock rules and store. Decision D-2: text is only ever typed into the locked window.
// Pure rule functions plus a small store that takes a platform adapter and a confirm callback.

import { HelperError, HELPER_CODES } from './platform/errors.js';

const MAX_REGEX_LENGTH = 1024;

/** Default allow patterns (lowercase substrings) matched against processName then title. */
export const DEFAULT_ALLOW_PATTERNS = Object.freeze([
  'windowsterminal', 'wt.exe', 'cmd.exe', 'cmd', 'powershell', 'pwsh', 'conhost', 'mintty',
  'alacritty', 'wezterm', 'kitty', 'ghostty', 'hyper', 'terminal', 'iterm', 'warp',
  'code', 'cursor', 'windsurf',
  'idea64', 'pycharm64', 'webstorm64', 'rider64', 'goland64', 'clion64', 'phpstorm64', 'rubymine64',
  'gnome-terminal', 'konsole', 'xterm', 'tilix', 'foot', 'tmux',
  'claude', 'codex', 'zellij',
]);

/**
 * Compiles one pattern. Plain strings are case-insensitive substrings; "/re/flags" strings are regexes.
 * @param {string} pattern
 * @returns {{ test: (s: string) => boolean, source: string } | null} null when invalid
 */
export function compilePattern(pattern) {
  if (typeof pattern !== 'string') return null;
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return null;
  const regexMatch = /^\/(.+)\/([a-z]*)$/s.exec(trimmed);
  if (regexMatch) {
    const [, body, flags] = regexMatch;
    if (body.length > MAX_REGEX_LENGTH) return null;
    try {
      // g and y make test() stateful (lastIndex), which would let the same window pass once and fail next.
      const safeFlags = flags.replace(/[gy]/g, '');
      const re = new RegExp(body, safeFlags.includes('i') ? safeFlags : `${safeFlags}i`);
      return { source: trimmed, test: (s) => re.test(s) };
    } catch {
      return null;
    }
  }
  const needle = trimmed.toLowerCase();
  return { source: trimmed, test: (s) => String(s).toLowerCase().includes(needle) };
}

/**
 * @param {Array<string>} patterns
 * @returns {{ compiled: Array<{ test: Function, source: string }>, warnings: string[] }}
 */
export function compilePatterns(patterns) {
  const compiled = [];
  const warnings = [];
  for (const p of patterns ?? []) {
    const c = compilePattern(p);
    if (c) compiled.push(c);
    else warnings.push(`invalid allow pattern ignored: ${JSON.stringify(p)}`);
  }
  return { compiled, warnings };
}

/**
 * @param {{ id?: string, title?: string, processName?: string, pid?: number }} info
 * @param {Array<string>} patterns
 * @returns {boolean}
 */
export function matchesAllowPatterns(info, patterns) {
  const { compiled } = compilePatterns(patterns);
  if (compiled.length === 0) return false;
  const processName = String(info?.processName ?? '');
  const title = String(info?.title ?? '');
  for (const p of compiled) {
    if (processName && p.test(processName)) return true;
  }
  for (const p of compiled) {
    if (title && p.test(title)) return true;
  }
  return false;
}

/**
 * @param {object} info
 * @param {Array<string>} patterns
 * @returns {'allow'|'confirm'}
 */
export function decideSanity(info, patterns) {
  return matchesAllowPatterns(info, patterns) ? 'allow' : 'confirm';
}

/**
 * True when the window belongs to WhipZap itself.
 * @param {object} info
 * @param {{ selfPid?: number, selfTitles?: string[] }} opts
 * @returns {boolean}
 */
export function isSelf(info, { selfPid, selfTitles = ['WhipZap'] } = {}) {
  if (!info) return false;
  if (selfPid != null && Number(info.pid) === Number(selfPid)) return true;
  const title = String(info.title ?? '').trim();
  return selfTitles.some((t) => title === t);
}

/**
 * Creates the single-target store.
 * @param {{ platform: object, confirm: (info: object) => Promise<boolean>|boolean, selfPid?: number,
 *           patterns?: string[], lastForeground?: () => Promise<object>, selfTitles?: string[] }} deps
 */
/**
 * True when a freshly read window still belongs to the same process as when it was locked.
 * A recycled id with a different pid or process name is treated as a different window.
 */
export function sameOwner(locked, fresh) {
  if (!locked || !fresh) return false;
  const lockedPid = Number(locked.pid) || 0;
  const freshPid = Number(fresh.pid) || 0;
  if (lockedPid && freshPid && lockedPid !== freshPid) return false;
  const a = String(locked.processName ?? '').toLowerCase();
  const b = String(fresh.processName ?? '').toLowerCase();
  if (a && b && a !== b) return false;
  return true;
}

export function createTargetStore({ platform, confirm, selfPid, patterns = DEFAULT_ALLOW_PATTERNS, lastForeground, selfTitles }) {
  let target = null;

  async function lock(info) {
    if (!info) return { ok: false, reason: 'error', error: new Error('no window info') };
    if (isSelf(info, { selfPid, selfTitles })) return { ok: false, reason: 'self' };
    if (decideSanity(info, patterns) === 'confirm') {
      const accepted = await confirm(info);
      if (!accepted) return { ok: false, reason: 'declined' };
    }
    target = { ...info, lockedAt: Date.now() };
    return { ok: true, target };
  }

  return {
    /** Locks the current foreground window after the sanity check. */
    async lockForeground() {
      let info;
      try {
        info = lastForeground ? await lastForeground() : await platform.getForegroundWindow();
      } catch (error) {
        return { ok: false, reason: 'error', error };
      }
      return lock(info);
    },
    lock,
    get() {
      return target;
    },
    set(info) {
      target = info ? { ...info, lockedAt: Date.now() } : null;
    },
    clear() {
      target = null;
    },
    /**
     * Re-reads the locked window. Clears the lock and returns false when it is gone, or when the id
     * now belongs to a different process (window ids and pids are recycled by every OS).
     */
    async exists() {
      if (!target) return false;
      let fresh;
      try {
        fresh = await platform.getWindowInfo(target.id);
      } catch (err) {
        if (err instanceof HelperError && err.code === HELPER_CODES.TARGET_GONE) {
          target = null;
          return false;
        }
        throw err;
      }
      if (!sameOwner(target, fresh)) {
        target = null;
        return false;
      }
      return true;
    },
  };
}
