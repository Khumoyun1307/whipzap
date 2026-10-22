// Config loading, validation, saving, and watching. Pure validation; fs is injected for tests.

import nodeFs from 'node:fs';
import { promises as nodeFsPromises } from 'node:fs';
import path from 'node:path';
import { TIERS } from './messages.js';

const ACCELERATOR_RE = /^[A-Za-z0-9+]+$/;
const DELIVERY_MODES = ['safe', 'btw'];
const UINT32_MAX = 4294967295;

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value);
  }
  return Object.freeze(obj);
}

/** Default configuration (docs/ARCHITECTURE.md section 9). Deep-frozen. */
export const DEFAULT_CONFIG = deepFreeze({
  version: 1,
  delivery: 'safe',
  hotkeys: {
    crack: 'CommandOrControl+Alt+W',
    armWhip: 'CommandOrControl+Alt+Shift+W',
    toggleAuto: 'CommandOrControl+Alt+A',
  },
  auto: {
    baseIntervalSec: 180,
    jitterSec: 90,
    sessionCap: 20,
    seed: null,
  },
  sound: {
    muted: false,
    volume: 0.8,
  },
  messages: {
    extra: [],
    replace: false,
  },
  target: {
    allowPatterns: [],
  },
  whip: {
    crackFactor: 3.5, // tip speed needed to crack, in rope segment lengths per physics step
    cooldownMs: 600, // minimum time between whip-mode cracks
  },
});

/**
 * @param {string} userDataDir
 * @returns {string} absolute path of config.json
 */
export function configPath(userDataDir) {
  return path.join(userDataDir, 'config.json');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Validates and normalizes a parsed config object against the schema. Pure.
 * @param {unknown} obj
 * @returns {{ config: object, warnings: string[] }}
 */
export function validateConfig(obj) {
  const warnings = [];
  const config = clone(DEFAULT_CONFIG);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    warnings.push('config must be a JSON object; using defaults');
    return { config, warnings };
  }
  if (obj.version !== undefined && obj.version !== 1) {
    warnings.push(`config.version ${JSON.stringify(obj.version)} is not supported; using defaults`);
    return { config, warnings };
  }

  const known = new Set(Object.keys(DEFAULT_CONFIG));
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) warnings.push(`unknown config key "${key}" ignored`);
  }

  // delivery
  if (obj.delivery !== undefined) {
    if (DELIVERY_MODES.includes(obj.delivery)) config.delivery = obj.delivery;
    else warnings.push(`delivery "${obj.delivery}" is not one of ${DELIVERY_MODES.join(', ')}; using "safe"`);
  }

  // hotkeys
  if (obj.hotkeys !== undefined) {
    if (obj.hotkeys && typeof obj.hotkeys === 'object') {
      for (const key of Object.keys(obj.hotkeys)) {
        if (!(key in DEFAULT_CONFIG.hotkeys)) {
          warnings.push(`unknown hotkeys key "${key}" ignored`);
          continue;
        }
        const value = obj.hotkeys[key];
        if (typeof value === 'string' && ACCELERATOR_RE.test(value) && value.includes('+')) {
          config.hotkeys[key] = value;
        } else {
          warnings.push(`hotkeys.${key} "${value}" is not a valid accelerator; using default`);
        }
      }
    } else {
      warnings.push('hotkeys must be an object; using defaults');
    }
  }

  // auto
  if (obj.auto !== undefined) {
    if (obj.auto && typeof obj.auto === 'object') {
      const a = obj.auto;
      for (const key of Object.keys(a)) {
        if (!(key in DEFAULT_CONFIG.auto)) warnings.push(`unknown auto key "${key}" ignored`);
      }
      if (a.baseIntervalSec !== undefined) {
        if (typeof a.baseIntervalSec === 'number' && Number.isFinite(a.baseIntervalSec)) {
          const clamped = clampInt(a.baseIntervalSec, 20, 86400);
          if (clamped !== a.baseIntervalSec) warnings.push(`auto.baseIntervalSec clamped to ${clamped}`);
          config.auto.baseIntervalSec = clamped;
        } else {
          warnings.push('auto.baseIntervalSec must be a number; using default');
        }
      }
      if (a.jitterSec !== undefined) {
        if (typeof a.jitterSec === 'number' && Number.isFinite(a.jitterSec)) {
          const clamped = clampInt(a.jitterSec, 0, config.auto.baseIntervalSec);
          if (clamped !== a.jitterSec) warnings.push(`auto.jitterSec clamped to ${clamped}`);
          config.auto.jitterSec = clamped;
        } else {
          warnings.push('auto.jitterSec must be a number; using default');
        }
      } else if (config.auto.jitterSec > config.auto.baseIntervalSec) {
        config.auto.jitterSec = config.auto.baseIntervalSec;
      }
      if (a.sessionCap !== undefined) {
        if (typeof a.sessionCap === 'number' && Number.isFinite(a.sessionCap)) {
          const clamped = clampInt(a.sessionCap, 1, 500);
          if (clamped !== a.sessionCap) warnings.push(`auto.sessionCap clamped to ${clamped}`);
          config.auto.sessionCap = clamped;
        } else {
          warnings.push('auto.sessionCap must be a number; using default');
        }
      }
      if (a.seed !== undefined) {
        if (a.seed === null) {
          config.auto.seed = null;
        } else if (Number.isInteger(a.seed) && a.seed >= 0 && a.seed <= UINT32_MAX) {
          config.auto.seed = a.seed;
        } else {
          warnings.push('auto.seed must be null or an integer 0..4294967295; using null');
        }
      }
    } else {
      warnings.push('auto must be an object; using defaults');
    }
  }

  // whip (mouse mode tuning)
  if (obj.whip !== undefined) {
    if (obj.whip && typeof obj.whip === 'object') {
      for (const key of Object.keys(obj.whip)) {
        if (!(key in DEFAULT_CONFIG.whip)) warnings.push(`unknown whip key "${key}" ignored`);
      }
      if (obj.whip.crackFactor !== undefined) {
        if (typeof obj.whip.crackFactor === 'number' && Number.isFinite(obj.whip.crackFactor)) {
          const clamped = Math.min(20, Math.max(0.5, obj.whip.crackFactor));
          if (clamped !== obj.whip.crackFactor) warnings.push(`whip.crackFactor clamped to ${clamped}`);
          config.whip.crackFactor = clamped;
        } else {
          warnings.push('whip.crackFactor must be a number; using default');
        }
      }
      if (obj.whip.cooldownMs !== undefined) {
        if (typeof obj.whip.cooldownMs === 'number' && Number.isFinite(obj.whip.cooldownMs)) {
          const clamped = Math.round(Math.min(10000, Math.max(100, obj.whip.cooldownMs)));
          if (clamped !== obj.whip.cooldownMs) warnings.push(`whip.cooldownMs clamped to ${clamped}`);
          config.whip.cooldownMs = clamped;
        } else {
          warnings.push('whip.cooldownMs must be a number; using default');
        }
      }
    } else {
      warnings.push('whip must be an object; using defaults');
    }
  }

  // sound
  if (obj.sound !== undefined) {
    if (obj.sound && typeof obj.sound === 'object') {
      const s = obj.sound;
      for (const key of Object.keys(s)) {
        if (!(key in DEFAULT_CONFIG.sound)) warnings.push(`unknown sound key "${key}" ignored`);
      }
      if (s.muted !== undefined) {
        if (typeof s.muted === 'boolean') config.sound.muted = s.muted;
        else warnings.push('sound.muted must be a boolean; using default');
      }
      if (s.volume !== undefined) {
        if (typeof s.volume === 'number' && Number.isFinite(s.volume)) {
          const clamped = Math.min(1, Math.max(0, s.volume));
          if (clamped !== s.volume) warnings.push(`sound.volume clamped to ${clamped}`);
          config.sound.volume = clamped;
        } else {
          warnings.push('sound.volume must be a number; using default');
        }
      }
    } else {
      warnings.push('sound must be an object; using defaults');
    }
  }

  // messages
  if (obj.messages !== undefined) {
    if (obj.messages && typeof obj.messages === 'object') {
      const m = obj.messages;
      for (const key of Object.keys(m)) {
        if (!(key in DEFAULT_CONFIG.messages)) warnings.push(`unknown messages key "${key}" ignored`);
      }
      if (m.extra !== undefined) {
        if (Array.isArray(m.extra)) {
          const kept = [];
          m.extra.forEach((item, i) => {
            if (typeof item === 'string') {
              kept.push(item);
            } else if (item && typeof item === 'object' && typeof item.text === 'string') {
              const entry = { text: item.text };
              if (item.tier !== undefined) {
                if (TIERS.includes(item.tier)) entry.tier = item.tier;
                else warnings.push(`messages.extra[${i}].tier "${item.tier}" unknown; using mild`);
              }
              kept.push(entry);
            } else {
              warnings.push(`messages.extra[${i}] must be a string or { tier, text }; ignored`);
            }
          });
          config.messages.extra = kept;
        } else {
          warnings.push('messages.extra must be an array; using default');
        }
      }
      if (m.replace !== undefined) {
        if (typeof m.replace === 'boolean') config.messages.replace = m.replace;
        else warnings.push('messages.replace must be a boolean; using default');
      }
    } else {
      warnings.push('messages must be an object; using defaults');
    }
  }

  // target
  if (obj.target !== undefined) {
    if (obj.target && typeof obj.target === 'object') {
      const t = obj.target;
      for (const key of Object.keys(t)) {
        if (!(key in DEFAULT_CONFIG.target)) warnings.push(`unknown target key "${key}" ignored`);
      }
      if (t.allowPatterns !== undefined) {
        if (Array.isArray(t.allowPatterns)) {
          const kept = [];
          t.allowPatterns.forEach((p, i) => {
            if (typeof p === 'string' && p.trim().length > 0) kept.push(p);
            else warnings.push(`target.allowPatterns[${i}] must be a non-empty string; ignored`);
          });
          config.target.allowPatterns = kept;
        } else {
          warnings.push('target.allowPatterns must be an array; using default');
        }
      }
    } else {
      warnings.push('target must be an object; using defaults');
    }
  }

  return { config, warnings };
}

/**
 * Parses config text. Pure.
 * @param {string} text
 * @returns {{ config: object, warnings: string[], parseError?: string }}
 */
export function parseConfig(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { config: clone(DEFAULT_CONFIG), warnings: [`config is not valid JSON: ${err.message}`], parseError: err.message };
  }
  return validateConfig(parsed);
}

function serialize(config) {
  return JSON.stringify(config, null, 2) + '\n';
}

/**
 * Loads config from disk. Missing file: defaults are written. Invalid JSON: file moved to `.bak`, defaults written.
 * @param {{ configPath: string, fs?: object }} opts fs exposes promise-based readFile, writeFile, rename, mkdir
 * @returns {Promise<{ config: object, warnings: string[] }>}
 */
export async function loadConfig({ configPath: file, fs = nodeFsPromises }) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      const config = clone(DEFAULT_CONFIG);
      await saveConfig({ configPath: file, fs }, config);
      return { config, warnings: [] };
    }
    throw err;
  }
  const result = parseConfig(text);
  if (result.parseError) {
    const backup = `${file}.bak`;
    await fs.rename(file, backup);
    await saveConfig({ configPath: file, fs }, result.config);
    return { config: result.config, warnings: [...result.warnings, `invalid config moved to ${backup}; defaults written`] };
  }
  return { config: result.config, warnings: result.warnings };
}

/**
 * Atomic save: writes `<path>.tmp` then renames over the target.
 * @param {{ configPath: string, fs?: object }} opts
 * @param {object} config
 * @returns {Promise<void>}
 */
export async function saveConfig({ configPath: file, fs = nodeFsPromises }, config) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, serialize(config), 'utf8');
  await fs.rename(tmp, file);
}

/**
 * Watches the config file and calls onChange(loadResult) after a 300 ms debounce.
 * @param {{ configPath: string, fs?: object, watch?: Function, debounceMs?: number }} opts
 * @param {(result: { config: object, warnings: string[] }) => void} onChange
 * @returns {{ close: () => void }}
 */
export function watchConfig({ configPath: file, fs = nodeFsPromises, watch = nodeFs.watch, debounceMs = 300 }, onChange) {
  let timer = null;
  let lastSerialized = null;
  let watcher = null;
  try {
    watcher = watch(path.dirname(file), { persistent: false }, (_event, filename) => {
      if (filename && filename !== path.basename(file)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        timer = null;
        try {
          const result = await loadConfig({ configPath: file, fs });
          const serialized = serialize(result.config);
          if (serialized === lastSerialized) return;
          lastSerialized = serialized;
          onChange(result);
        } catch {
          /* ignore transient read errors */
        }
      }, debounceMs);
    });
  } catch {
    watcher = null;
  }
  return {
    close() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (watcher && typeof watcher.close === 'function') watcher.close();
      watcher = null;
    },
    /** Lets the owner mark its own writes so the watcher does not echo them back. */
    markSaved(config) {
      lastSerialized = serialize(config);
    },
  };
}
