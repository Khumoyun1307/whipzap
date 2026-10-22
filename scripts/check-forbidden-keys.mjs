#!/usr/bin/env node
// Mechanical guard for decision D-1: WhipZap never sends Ctrl-C, Esc, or any control-modified key.
// Scans source and helper files for patterns that would synthesize such keys. Exit 1 on a hit.
// Allowed: Unicode text events and Enter (VK_RETURN, key code 36, xdotool "Return").

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOTS = ['src', 'bin'];
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ps1', '.sh', '.applescript', '.html']);

// Each pattern is tested case-insensitively, line by line.
const FORBIDDEN = [
  { re: /\\x03/i, why: 'ETX / Ctrl-C byte' },
  { re: /\bctrl\s*\+\s*c\b/i, why: 'Ctrl+C' },
  { re: /\bcontrol\s*\+\s*c\b/i, why: 'Control+C' },
  { re: /key\s+code\s+53\b/i, why: 'AppleScript Escape key code' },
  { re: /\{ESC\}/i, why: 'SendKeys Escape' },
  { re: /\bVK_ESCAPE\b/i, why: 'Win32 Escape virtual key' },
  { re: /\bVK_CONTROL\b/i, why: 'Win32 Control virtual key' },
  { re: /\bVK_MENU\b/i, why: 'Win32 Alt virtual key' },
  { re: /\bVK_LWIN\b|\bVK_RWIN\b/i, why: 'Win32 Windows key' },
  { re: /keybd_event/i, why: 'legacy keybd_event API (use SendInput with Unicode only)' },
  { re: /using\s*\{\s*(control|command|option|shift)\s+down/i, why: 'AppleScript modifier keystroke' },
  { re: /xdotool\s+key\b(?!\s+(--clearmodifiers\s+)?Return\b)/i, why: 'xdotool key other than Return' },
  { re: /\bkey\s+(Escape|ctrl\+|alt\+|super\+)/i, why: 'xdotool modifier or Escape key' },
];

const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules') continue;
      walk(full);
    } else if (EXTENSIONS.has(path.extname(entry))) {
      scan(full);
    }
  }
}

function scan(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/forbidden-keys:\s*allow/i.test(line)) return; // explicit, reviewed exemption on that line
    for (const { re, why } of FORBIDDEN) {
      if (re.test(line)) violations.push({ file, line: i + 1, why, text: line.trim() });
    }
  });
}

for (const root of ROOTS) {
  try {
    if (statSync(root).isDirectory()) walk(root);
  } catch {
    /* root missing is fine during early milestones */
  }
}

if (violations.length) {
  console.error('Forbidden key patterns found (decision D-1: only Unicode text and Enter may be sent):');
  for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.why}]  ${v.text}`);
  process.exit(1);
}
console.log('lint:keys OK, no forbidden key patterns in', ROOTS.join(', '));
