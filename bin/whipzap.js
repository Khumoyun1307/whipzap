#!/usr/bin/env node
// CLI launcher: starts the WhipZap tray app with the Electron binary from the `electron` dependency.
// `whipzap` detaches and returns immediately. `whipzap --foreground` stays attached and shows logs.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const foreground = args.includes('--foreground');
const passthrough = args.filter((a) => a !== '--foreground');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`WhipZap: whip your AI coding agent into shape.

Usage: whipzap [--foreground] [--help] [--version]

  --foreground   keep the app attached to this terminal and print logs
  --version      print the version

Once running, look for the whip icon in your system tray.`);
  process.exit(0);
}
if (args.includes('--version') || args.includes('-v')) {
  console.log(require('../package.json').version);
  process.exit(0);
}

let electronPath;
try {
  electronPath = require('electron');
} catch (err) {
  console.error('Could not find the Electron binary. Reinstall with: npm install -g whipzap');
  console.error(err.message);
  process.exit(1);
}
if (typeof electronPath !== 'string') {
  console.error('This launcher must be run with Node, not inside Electron.');
  process.exit(1);
}

const env = { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: '1' };
delete env.ELECTRON_RUN_AS_NODE; // some IDE terminals set it; it would run Electron as plain Node

const child = spawn(electronPath, [appDir, ...passthrough], {
  detached: !foreground,
  stdio: foreground ? 'inherit' : 'ignore',
  windowsHide: true,
  env,
});

child.on('error', (err) => {
  console.error(`Could not start WhipZap: ${err.message}`);
  process.exit(1);
});

if (foreground) {
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  child.on('spawn', () => {
    child.unref();
    console.log('WhipZap started. Look for the whip icon in your tray.');
    process.exit(0);
  });
}
