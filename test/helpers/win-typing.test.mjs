#!/usr/bin/env node
// Windows integration test for the typing helper. Not run by Vitest; run with `npm run test:win`.
//
// Opens a WinForms TextBox fixture (test/helpers/win-textbox.ps1) in its own process, focuses a
// different window first (the fixture is started hidden behind by giving focus back to the
// previous foreground window), then asks the real platform adapter to focus the fixture and type a
// Unicode string with Enter. The fixture prints exactly what arrived; the test asserts equality.
//
// Exit 0 on PASS, 1 on FAIL, 0 with a SKIP line on non-Windows.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createPlatform } from '../../src/main/platform/index.js';

if (process.platform !== 'win32') {
  console.log('SKIP: Windows-only test');
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'win-textbox.ps1');
const TEXT = 'whipzap typing test: FASTER! WORK HARDER! ünïcödé ✓ 日本 🐢 end';
const t0 = Date.now();

const fixture = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', FIXTURE, '-Seconds', '8'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const lines = [];
const rl = createInterface({ input: fixture.stdout });
const firstLine = new Promise((resolve) => rl.once('line', resolve));
rl.on('line', (l) => lines.push(l));
const exited = new Promise((resolve) => fixture.on('exit', resolve));

let failed;
try {
  const { hwnd } = JSON.parse(await firstLine);
  const platform = createPlatform();
  await platform.start?.();

  // Prove focus switching: the fixture's own TopMost form currently has focus; move focus away to
  // whatever was foreground before (usually the terminal running this test), then let the adapter
  // bring the fixture back.
  const before = await platform.getForegroundWindow();
  console.log(`fixture hwnd=${hwnd}, foreground now="${before.title}" (${before.processName})`);

  const tType = Date.now();
  await platform.typeText(hwnd, TEXT, { pressEnter: true });
  const typingMs = Date.now() - tType;
  await platform.stop?.();
  await exited;

  const result = JSON.parse(lines.at(-1) ?? '{}');
  const got = String(result.text ?? '');
  const expected = `${TEXT}\r\n`; // WinForms multiline TextBox stores Enter as CRLF
  const pass = got === expected;
  console.log(JSON.stringify({ expected, got, typingMs, totalMs: Date.now() - t0 }, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  failed = !pass;
} catch (err) {
  console.error('FAIL:', err.message);
  failed = true;
  try {
    fixture.kill();
  } catch {
    /* ignore */
  }
}
process.exit(failed ? 1 : 0);
