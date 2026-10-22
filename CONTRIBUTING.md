# Contributing to WhipZap

Thanks for helping whip agents into shape. This is a small project; the process is deliberately light.

## Setup

```
git clone https://github.com/Khumoyun1307/whipzap.git
cd whipzap
npm ci
npm start         # launches the tray app
npm test          # unit tests (Vitest)
npm run lint      # ESLint
npm run lint:keys # guard against Ctrl-C, Esc, or modifier keys anywhere in src/ or bin/
npm run selftest  # overlay smoke test, exits 0 on success
npm run test:win  # Windows only: real typing into a WinForms fixture
```

Requirements: Node 20 or newer. The first `npm ci` downloads Electron (about 100 MB); if it is interrupted, run `node node_modules/electron/install.js`. On macOS the app needs the Accessibility permission to type; it prompts on the first lock. On Linux, X11 and `xdotool` are required; Wayland is not supported yet.

Set `WHIPZAP_USER_DATA` to a scratch directory while developing so your real config is untouched. `WHIPZAP_DEBUG=1` prints helper traffic and typed text to the console (`npm start` shows it).

## Where things live

- `docs/` is the specification. Start with `docs/PRD.md` and `docs/ARCHITECTURE.md`.
- `src/main/` is the Electron main process (`app.js` wiring, `config.js`, `messages.js`, `delivery.js`, `target.js`, `crack.js`, `scheduler.js`, `prng.js`, `hotkeys.js`, `tray.js`, `overlay-window.js`, `log.js`). `src/main/platform/` holds the adapters and `src/main/helpers/<os>/` the scripts they spawn (`win/worker.ps1`, `mac/helper.sh`, `linux/helper.sh`). `src/overlay/` is the sandboxed overlay renderer (`overlay.js`, `strike.js`, `rope.js`, `toast.js`, `audio.js`), `src/preload.js` its bridge.
- `test/` holds the Vitest suites and `test/fakes/`. `test/helpers/` holds manual tools: `run-helper.mjs`, `win-textbox.ps1`, `win-typing.test.mjs`, `win-e2e.ps1`, `screenshot.cjs`. Read `docs/TESTING.md` section 3.4 before running `win-e2e.ps1`: it presses global hotkeys and must not run while you are using the machine.
- `assets/messages/default.json` is the built-in message pack. `assets/CREDITS.md` records the provenance of every sound and icon.

## Adding a message

Edit `assets/messages/default.json`. Lines are grouped in three tiers (`mild`, `medium`, `spicy`). Keep each line under 80 characters, printable, single line, teasing the agent only. Never target real people or groups. Run `npm test`; the pack is validated.

## Adding or fixing a platform helper

Read the helper contract in `docs/ARCHITECTURE.md` section 6 and the adapter contract in 4.11. A helper receives the text on stdin, prints one JSON object on stdout, and exits with the documented codes (1 other, 2 permission, 3 target gone, 4 unsupported or missing tool, 5 focus failed). It must never send Ctrl-C, Esc, a modifier key, or any control key other than Enter; `npm run lint:keys` enforces this mechanically. Write argv tests with an injected `execFileImpl` like `test/platform-mac.test.js`. Add the platform to the manual smoke checklist in `docs/TESTING.md`, record your run in `docs/SMOKE-RESULTS.md`, and say in your PR which checklist items you ran. Helpers for macOS and Linux are currently marked UNVERIFIED-ON-HARDWARE; a tester report is the most valuable contribution right now.

## Pull requests

- One topic per PR. Conventional Commit messages (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- `npm test` and `npm run lint` must pass.
- If you change behavior, update the matching section in `docs/`.
- Do not add dependencies without a sentence in the PR explaining why the standard library or Electron cannot do it. No native modules.
- Do not contribute code or assets copied from OpenWhip or other projects with unclear licensing. Sounds and icons must be CC0 with a source link.

## Reporting bugs

Open a GitHub issue with your OS, terminal or editor, the target window title, and the output of running the app with `WHIPZAP_DEBUG=1`.
