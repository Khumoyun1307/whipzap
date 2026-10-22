#!/usr/bin/env node
// Manual harness for the platform helpers. Not part of `npm test`.
//
//   node test/helpers/run-helper.mjs foreground
//   node test/helpers/run-helper.mjs info <id>
//   node test/helpers/run-helper.mjs focus <id>
//   node test/helpers/run-helper.mjs type <id> "text to type" [--no-enter]
//   node test/helpers/run-helper.mjs countdown <seconds>   (prints the foreground window after a delay,
//                                                           so you can click the window you want to inspect)
//
// Uses the same platform adapter as the app, so a passing run here means the app can type.

import { createPlatform } from '../../src/main/platform/index.js';

const [cmd, ...rest] = process.argv.slice(2);
const platform = createPlatform();

function out(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

try {
  const support = await platform.isSupported();
  if (!support.ok) {
    out({ ok: false, reason: support.reason });
    process.exit(4);
  }
  await platform.start?.();
  switch (cmd) {
    case 'foreground':
      out(await platform.getForegroundWindow());
      break;
    case 'countdown': {
      const secs = Number(rest[0] ?? 3);
      for (let i = secs; i > 0; i--) {
        process.stderr.write(`Focus the target window... ${i}\n`);
        await new Promise((r) => setTimeout(r, 1000));
      }
      out(await platform.getForegroundWindow());
      break;
    }
    case 'info':
      out(await platform.getWindowInfo(rest[0]));
      break;
    case 'focus':
      out({ ok: await platform.focusWindow(rest[0]) });
      break;
    case 'type': {
      const id = rest[0];
      const text = rest[1] ?? 'whipzap-selftest';
      const pressEnter = !rest.includes('--no-enter');
      const t0 = Date.now();
      await platform.typeText(id, text, { pressEnter });
      out({ ok: true, ms: Date.now() - t0 });
      break;
    }
    default:
      console.error('usage: run-helper.mjs foreground|countdown <s>|info <id>|focus <id>|type <id> <text> [--no-enter]');
      process.exit(1);
  }
} catch (err) {
  out({ ok: false, code: err.code ?? 1, error: err.message });
  process.exitCode = typeof err.code === 'number' ? err.code : 1;
} finally {
  await platform.stop?.();
}
