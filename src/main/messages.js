// Message pack loading, validation, merging, and tiered selection. Pure, Electron-free.

export const TIERS = Object.freeze(['mild', 'medium', 'spicy']);
const BUILTIN_MAX = 80;
const EXTRA_MAX = 200;
const FALLBACK_MESSAGE = 'FASTER!';

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;

function isPrintable(text) {
  return !CONTROL_RE.test(text);
}

/**
 * Validates a built-in pack shape: { version: 1, tiers: { mild: [], medium: [], spicy: [] } }.
 * @param {unknown} pack
 * @returns {{ errors: string[] }}
 */
export function validatePack(pack) {
  const errors = [];
  if (!pack || typeof pack !== 'object') {
    return { errors: ['pack must be an object'] };
  }
  if (pack.version !== 1) {
    errors.push(`pack.version must be 1, got ${JSON.stringify(pack.version)}`);
  }
  if (!pack.tiers || typeof pack.tiers !== 'object') {
    errors.push('pack.tiers must be an object');
    return { errors };
  }
  for (const tier of TIERS) {
    const list = pack.tiers[tier];
    if (!Array.isArray(list)) {
      errors.push(`tiers.${tier} must be an array`);
      continue;
    }
    const seen = new Set();
    list.forEach((entry, i) => {
      const where = `tiers.${tier}[${i}]`;
      if (typeof entry !== 'string') {
        errors.push(`${where} must be a string`);
        return;
      }
      const text = entry.trim();
      if (text.length === 0) errors.push(`${where} is empty`);
      if (text.length > BUILTIN_MAX) errors.push(`${where} exceeds ${BUILTIN_MAX} characters`);
      if (!isPrintable(entry)) errors.push(`${where} contains control characters`);
      if (seen.has(text)) errors.push(`${where} duplicates "${text}"`);
      seen.add(text);
    });
  }
  for (const key of Object.keys(pack.tiers)) {
    if (!TIERS.includes(key)) errors.push(`unknown tier "${key}"`);
  }
  return { errors };
}

/**
 * Normalizes user-supplied extras: plain strings become mild; objects need { tier, text }.
 * @param {unknown} extra
 * @returns {{ entries: Array<{ tier: string, text: string }>, warnings: string[] }}
 */
export function normalizeExtras(extra) {
  const entries = [];
  const warnings = [];
  if (extra == null) return { entries, warnings };
  if (!Array.isArray(extra)) {
    warnings.push('messages.extra must be an array; ignored');
    return { entries, warnings };
  }
  extra.forEach((item, i) => {
    let tier = 'mild';
    let raw;
    if (typeof item === 'string') {
      raw = item;
    } else if (item && typeof item === 'object' && typeof item.text === 'string') {
      raw = item.text;
      if (item.tier !== undefined) {
        if (TIERS.includes(item.tier)) tier = item.tier;
        else warnings.push(`messages.extra[${i}]: unknown tier "${item.tier}", using mild`);
      }
    } else {
      warnings.push(`messages.extra[${i}]: must be a string or { tier, text }; ignored`);
      return;
    }
    if (!isPrintable(raw)) {
      warnings.push(`messages.extra[${i}]: contains control characters; ignored`);
      return;
    }
    const text = raw.trim();
    if (text.length === 0) {
      warnings.push(`messages.extra[${i}]: empty; ignored`);
      return;
    }
    if (text.length > EXTRA_MAX) {
      warnings.push(`messages.extra[${i}]: exceeds ${EXTRA_MAX} characters; ignored`);
      return;
    }
    entries.push({ tier, text });
  });
  return { entries, warnings };
}

function emptyTiers() {
  return { mild: [], medium: [], spicy: [] };
}

/**
 * Merges the built-in pack with normalized extras.
 * @param {{ version: number, tiers: object }} builtin
 * @param {Array<{ tier: string, text: string }>} extra
 * @param {boolean} replace true ignores the built-in pack (empty tiers fall back with a warning)
 * @returns {{ pack: { version: 1, tiers: object }, warnings: string[] }}
 */
export function mergePacks(builtin, extra, replace) {
  const warnings = [];
  const tiers = emptyTiers();
  const builtinTiers = builtin?.tiers ?? emptyTiers();
  for (const tier of TIERS) {
    const base = replace ? [] : (builtinTiers[tier] ?? []).map((s) => s.trim());
    const added = (extra ?? []).filter((e) => e.tier === tier).map((e) => e.text);
    const merged = [];
    const seen = new Set();
    for (const text of [...base, ...added]) {
      if (seen.has(text)) continue;
      seen.add(text);
      merged.push(text);
    }
    tiers[tier] = merged;
  }
  for (let i = 0; i < TIERS.length; i++) {
    const tier = TIERS[i];
    if (tiers[tier].length > 0) continue;
    if (replace && (builtinTiers[tier] ?? []).length > 0) {
      tiers[tier] = builtinTiers[tier].map((s) => s.trim());
      warnings.push(`messages.replace is true but no "${tier}" extras were given; using built-in ${tier} lines`);
      continue;
    }
    // Fall back to the nearest lower tier, then to a constant.
    let fallback = null;
    for (let j = i - 1; j >= 0; j--) {
      if (tiers[TIERS[j]].length > 0) {
        fallback = tiers[TIERS[j]];
        break;
      }
    }
    tiers[tier] = fallback ? [...fallback] : [FALLBACK_MESSAGE];
    warnings.push(`tier "${tier}" is empty; falling back`);
  }
  return { pack: { version: 1, tiers }, warnings };
}

/**
 * Loads the effective pack from the built-in pack and the `messages` section of config.
 * @param {object} builtinPack
 * @param {{ extra?: unknown, replace?: boolean }} [messagesConfig]
 * @returns {{ pack: object, warnings: string[] }}
 */
export function loadPack(builtinPack, messagesConfig = {}) {
  const warnings = [];
  const { errors } = validatePack(builtinPack);
  if (errors.length) warnings.push(...errors.map((e) => `built-in pack: ${e}`));
  const { entries, warnings: extraWarnings } = normalizeExtras(messagesConfig.extra);
  warnings.push(...extraWarnings);
  const merged = mergePacks(builtinPack, entries, messagesConfig.replace === true);
  warnings.push(...merged.warnings);
  return { pack: merged.pack, warnings };
}

/**
 * Tier for the number of auto cracks already fired in this session.
 * @param {number} count
 * @returns {'mild'|'medium'|'spicy'}
 */
export function tierForCount(count) {
  const n = Number(count) || 0;
  if (n <= 4) return 'mild';
  if (n <= 11) return 'medium';
  return 'spicy';
}

/**
 * Picks a message from a tier, avoiding an immediate repeat when the pool allows it.
 * @param {{ tiers: object }} pack
 * @param {string} tier
 * @param {() => number} rng returns a float in [0, 1)
 * @param {string} [lastMessage]
 * @returns {string}
 */
export function pickMessage(pack, tier, rng, lastMessage) {
  if (!TIERS.includes(tier)) {
    throw new Error(`Unknown tier "${tier}". Allowed: ${TIERS.join(', ')}`);
  }
  const pool = pack?.tiers?.[tier] ?? [];
  if (pool.length === 0) return FALLBACK_MESSAGE;
  if (pool.length === 1) return pool[0];
  const candidates = lastMessage == null ? pool : pool.filter((m) => m !== lastMessage);
  const list = candidates.length > 0 ? candidates : pool;
  const index = Math.min(list.length - 1, Math.floor(rng() * list.length));
  return list[index];
}
