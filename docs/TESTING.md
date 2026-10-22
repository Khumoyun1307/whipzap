# WhipZap Testing Strategy

Status: Approved baseline for v0.1.0
Last updated: 2026-10-21
Owner: Technical lead (docs/ROADMAP.md tracks execution)

This document defines how WhipZap is tested, what counts as "verified", and the manual checklists that gate a release. It is written for AI coding agents that execute without asking. Where a step cannot be executed on the development machine (Windows 11), the step is marked UNVERIFIED-ON-HARDWARE and must be run by a human on real hardware before release.

Related: docs/PRD.md (requirements and acceptance criteria), docs/ARCHITECTURE.md (module boundaries, platform helper contract), docs/ROADMAP.md (milestones and task-level verification).

---

## 1. Test pyramid

| Layer | Scope | Tooling | Runs where | Gate |
|---|---|---|---|---|
| L1 Unit | Pure modules under `src/main/` with no Electron import: `scheduler.js`, `messages.js`, `delivery.js`, `config.js`, `target.js` (rule functions only), `crack.js` (with fake adapter) | Vitest, `environment: node` | Every push, all OSes in CI | Must pass, 100 percent of listed cases present |
| L2 Helper integration | Real per-OS helper scripts under `src/main/helpers/` invoked by `src/main/platform/*.js` against a real window | Node harness `test/helpers/run-helper.mjs`; Windows typing test `test/helpers/win-typing.test.mjs` against the WinForms fixture `test/helpers/win-textbox.ps1` | Dev machine (Windows), CI windows runner when feasible, humans on macOS and Linux | Windows: must pass before M1 done. macOS and Linux: UNVERIFIED-ON-HARDWARE until checklist run |
| L3 Overlay smoke | Electron launches, overlay window creates and loads without renderer console errors | Electron started with `--whipzap-selftest` flag, exits with code 0 or 1 [ASSUMED] | Dev machine, optional in CI | Optional, documented if skipped |
| L4 Manual smoke | End-to-end user flows per OS | Checklists in section 6 | Humans | Release gate (section 9) |

Principles:

1. Everything that can be pure is pure. Electron imports stay in `app.js`, `tray.js`, `hotkeys.js`, `platform/index.js`, `src/preload.js`, and `src/overlay/*`. Every other module takes its collaborators as constructor or function arguments.
2. No test touches the network. The app has no network code; a test that needs network is a bug.
3. No test sends keystrokes to an unknown window. Integration tests target a window they created themselves.
4. Determinism first. The scheduler and message selection accept a seed. Tests pass the seed and assert exact sequences.

---

## 2. Unit tests (Vitest)

### 2.1 Setup

- `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, `"lint": "eslint ."`.
- `vitest.config.js`: `test: { environment: "node", include: ["test/**/*.test.js"], exclude: ["test/helpers/**"] }`.
- Test files live in `test/` and mirror module names: `test/scheduler.test.js`, `test/messages.test.js`, `test/delivery.test.js`, `test/config.test.js`, `test/target.test.js`, `test/crack.test.js`.
- Fakes live in `test/fakes/`: `fakePlatform.js`, `fakeClock.js`, `fakeFs.js`.
- Coverage is not a gate in v1. The gate is that every case listed below exists and passes.

### 2.2 Making Electron-dependent code testable

| Module | Electron dependency | How it is isolated |
|---|---|---|
| `config.js` | `app.getPath("userData")` | `loadConfig({ configPath, fs })`, `saveConfig({ configPath, fs }, config)` and `watchConfig({ configPath, fs }, onChange)` take the path and an fs object. `app.js` resolves the path. |
| `messages.js` | None | `validatePack`, `mergePacks`, `loadPack(builtinPack, messagesConfig)`, `tierForCount`, `pickMessage(pack, tier, rng, lastMessage)` are pure. |
| `target.js` | None for rules. Focus and window-info calls are platform helpers | `matchesAllowPatterns(info, patterns)`, `decideSanity(info, patterns)` and `isSelf(info, { pid, titles })` are pure. `createTargetStore({ platform, confirm, selfPid })` takes an adapter and a confirm callback. |
| `crack.js` | None | `createCrack({ platform, targets, pack, rng, state, delivery, audio, overlay, toast, clock, log, sounds })` returns `{ crack({ source }) }`. |
| `scheduler.js`, `prng.js` | None | `createScheduler({ config, clock, rng, onFire, onStop })` where `clock` exposes `now()`, `setTimeout`, `clearTimeout`; `prng.js` exports `mulberry32(seed)` and `createRng(seed)`. |
| `hotkeys.js`, `tray.js` | `globalShortcut`, `Tray`, `Menu` | Thin. Not unit tested. Covered by L3 and L4. |
| `platform/win.js`, `mac.js`, `linux.js` | `child_process` | `createPlatform(platformName)` selects the adapter; `mac.js` and `linux.js` accept an injected `execFileImpl` so unit tests assert the command line built. L2 runs the real thing. |

### 2.3 scheduler.test.js

The scheduler drives auto mode. Config defaults: `baseIntervalSec: 180`, `jitterSec: 90`, `sessionCap: 20`, `seed: null`. Minimum interval is 20 seconds regardless of config.

| ID | Case | Assertion |
|---|---|---|
| SCH-01 | Same seed, same sequence | Two schedulers created with `seed: 42` and the same config produce identical fire times for 20 fires |
| SCH-02 | Different seeds differ | Seeds 1 and 2 produce different first intervals (allow retry with seed 3 if equal, then fail) |
| SCH-03 | Interval bounds | For 1000 draws with base 180, jitter 90: every interval is within [90, 270] seconds inclusive |
| SCH-04 | Minimum interval clamp | base 10, jitter 0 produces 20 seconds. base 25, jitter 10 never produces below 20 |
| SCH-05 | Zero jitter | base 60, jitter 0 produces exactly 60 every time |
| SCH-06 | Tier progression | Fires 0 to 4 report tier `mild`, 5 to 11 `medium`, 12 and later `spicy` |
| SCH-07 | Session cap | With cap 20, the 20th fire is delivered, the scheduler reports `stopped: "cap"`, no 21st timer is set |
| SCH-08 | Cap off toast hook | `onStop({ reason: "cap" })` is called exactly once |
| SCH-09 | Start resets count | `start()` after a `stop()` resets the fire count to 0 and tier to mild |
| SCH-10 | Pause | `pause()` clears the pending timer. No fire occurs while paused even after the clock advances 1 hour |
| SCH-11 | Resume | `resume()` schedules a new interval from the resume time, not the original due time |
| SCH-12 | Stop is idempotent | Calling `stop()` twice does not throw and does not call `onStop` twice |
| SCH-13 | Fire payload | `onFire({ count, tier })` receives 1-based count and the tier string |
| SCH-14 | Random seed when null | `seed: null` uses `Date.now()` and a scheduler still fires within bounds |

Implementation note for the implementer: use a small seedable PRNG (mulberry32 or xorshift32) written in `scheduler.js` or `src/main/prng.js`. Do not add a dependency for this.

### 2.4 messages.test.js

Pack format and tier rules are defined in docs/UX.md. The module exposes `loadPack(defaultPack, userConfigMessages)`, `validatePack(pack)`, and `pickMessage(pack, tier, rng, lastMessage)`.

| ID | Case | Assertion |
|---|---|---|
| MSG-01 | Default pack validates | `assets/messages/default.json` passes `validatePack` with zero errors |
| MSG-02 | Every tier populated | Default pack has at least 5 messages in each of `mild`, `medium`, `spicy` |
| MSG-03 | Tier selection | `pickMessage(pack, "spicy", rng)` returns only messages from the `spicy` array over 200 draws |
| MSG-04 | Unknown tier | `pickMessage(pack, "nuclear", rng)` throws a descriptive error |
| MSG-05 | Extra merge | `messages.extra: [{ tier: "mild", text: "MOVE IT" }]` with `replace: false` yields default count plus one in mild |
| MSG-06 | Replace | `replace: true` with extras covering all three tiers yields only the extras |
| MSG-07 | Replace with missing tier | `replace: true` but no `spicy` extras: `spicy` falls back to the default pack and a warning is returned |
| MSG-08 | No immediate repeat | With pool size greater than 1, 500 consecutive picks never return the same text twice in a row |
| MSG-09 | Pool of one | With a single message in a tier, repeated picks return it without throwing |
| MSG-10 | Length limit | A user extra longer than 200 characters fails validation; every built-in line in `default.json` is at most 80 characters |
| MSG-11 | Printable only | A message containing `\n`, `\r`, `\t`, or a control character fails validation |
| MSG-12 | Trim | Leading and trailing whitespace is trimmed on load |
| MSG-13 | Empty text rejected | `{ tier: "mild", text: "   " }` fails validation |
| MSG-14 | Determinism | Same rng seed produces the same pick sequence |

### 2.5 delivery.test.js

`formatForDelivery(message, mode)` returns the exact string to type, excluding the final Enter, which the platform adapter sends as a separate key.

| ID | Case | Assertion |
|---|---|---|
| DLV-01 | Safe mode | `formatForDelivery("FASTER!", "safe")` returns `"FASTER!"` |
| DLV-02 | btw mode | `formatForDelivery("FASTER!", "btw")` returns `"/btw FASTER!"` |
| DLV-03 | Trim | `"  FASTER!  "` becomes `"FASTER!"` in both modes |
| DLV-04 | Rejects newline | Message containing `\n` or `\r` throws |
| DLV-05 | Rejects empty | Empty or whitespace-only message throws |
| DLV-06 | Rejects unknown mode | Mode `"crack"` or `"interrupt"` throws. There is no interrupting mode and this test guards against one being added |
| DLV-07 | Unicode passes through | `"Schneller! 🐢"` is returned unchanged in safe mode |
| DLV-08 | No leading slash in safe mode | A message starting with `/` in safe mode is prefixed with a space so it is not interpreted as a slash command: `"/faster"` becomes `" /faster"` [ASSUMED] |

### 2.6 config.test.js

| ID | Case | Assertion |
|---|---|---|
| CFG-01 | Defaults when missing | No file at `configPath` returns the full default object and writes it to disk |
| CFG-02 | Partial merge | File `{ "sound": { "muted": true } }` yields defaults with `sound.muted === true` and `sound.volume === 0.8` |
| CFG-03 | Invalid JSON | File content `{ nope` returns defaults, renames the file to `config.json.bak`, and writes fresh defaults. A warning is returned in `result.warnings`. The app surfaces it as toast `Config invalid, using defaults` |
| CFG-04 | Unknown keys ignored | `{ "turbo": true }` is dropped and a warning lists `turbo` |
| CFG-05 | Version field | Missing `version` is set to 1. `version: 99` returns defaults with a warning |
| CFG-06 | Accelerator validation | `hotkeys.crack: "Ctrl+Alt+W"` is accepted. `hotkeys.crack: "banana"` falls back to the default with a warning. Validation uses a regex for Electron accelerator grammar, not Electron itself |
| CFG-07 | Delivery enum | `delivery: "btw"` accepted. `delivery: "esc"` falls back to `"safe"` with a warning |
| CFG-08 | Auto bounds | `baseIntervalSec: 5` is clamped to 20. `sessionCap: 0` is clamped to 1. `sessionCap: 10000` is clamped to 500 |
| CFG-09 | Volume bounds | `volume: 7` clamps to 1. `volume: -1` clamps to 0 |
| CFG-10 | Save round trip | `saveConfig` then `loadConfig` returns an equal object |
| CFG-11 | allowPatterns type | Non-array `target.allowPatterns` falls back to default list with a warning |

### 2.7 target.test.js

Rules only. `WindowInfo` is `{ id, title, processName, pid }` (`id` is a string: HWND on Windows, `pid:<n>` on macOS, X11 window id on Linux).

| ID | Case | Assertion |
|---|---|---|
| TGT-01 | Process match | `processName: "WindowsTerminal.exe"` matches default patterns |
| TGT-02 | Case-insensitive | `processName: "code.EXE"` matches pattern `Code.exe` |
| TGT-03 | Title match | `title: "claude - PowerShell"` with `processName: "unknown.exe"` matches pattern `claude` |
| TGT-04 | No match | `processName: "slack.exe"`, `title: "general - Slack"` does not match |
| TGT-05 | Pattern is substring, not regex | Pattern `code.exe` does not match `codex.exe` only if the implementer chose word boundaries; document the chosen rule and assert it. Default: plain case-insensitive substring. So `codex.exe` matches `code`. Test asserts the substring behavior |
| TGT-06 | Empty patterns | `allowPatterns: []` matches nothing, every lock prompts |
| TGT-07 | decideSanity | Returns `"allow"` on match, `"confirm"` on no match |
| TGT-08 | Lock flow allow | `createTargetStore(...).lockForeground()` with a fake platform returning a matching window resolves `{ ok: true, target }` without calling `confirm`; `get()` returns the info |
| TGT-09 | Lock flow confirm yes | Non-matching window, `confirm` returns true, lock succeeds and `confirm` was called with the window info |
| TGT-10 | Lock flow confirm no | `confirm` returns false, `lockForeground()` resolves `{ ok: false, reason: "declined" }` and `get()` is `null` |
| TGT-11 | Self-exclusion | A window whose `pid` equals `selfPid` or whose title is `WhipZap` resolves `{ ok: false, reason: "self" }`, even if patterns match |
| TGT-12 | Default pattern list | The default list contains at least: `WindowsTerminal`, `wt.exe`, `cmd.exe`, `powershell`, `pwsh`, `conhost`, `mintty`, `alacritty`, `wezterm`, `kitty`, `ghostty`, `hyper`, `Code`, `Cursor`, `Terminal`, `iTerm`, `claude`, `codex` |

### 2.8 crack.test.js

Uses `test/fakes/fakePlatform.js`, which records calls in order and can be configured to fail. Uses `fakeClock` so the 150 millisecond pause is deterministic.

| ID | Case | Assertion |
|---|---|---|
| CRK-01 | Happy path order | Calls occur in this order: pick message, `audio.play`, `overlay.strike({ message, tier, prefix })`, `platform.focusWindow(id)`, clock wait 150 ms, `platform.typeText(id, text, { pressEnter: true })` |
| CRK-02 | Delivery applied | With `delivery: "btw"`, `typeText` receives `"/btw FASTER!"` and `overlay.strike` receives `message: "FASTER!"` with `prefix: "/btw"` (the on-screen text is the bare message plus the prefix) |
| CRK-03 | No target | With no locked target: `audio.play` and `overlay.strike` are called, `toast("No target locked")` is called, `focusWindow` and `typeText` are never called. Resolves without throwing |
| CRK-04 | Target gone | `platform.getWindowInfo(id)` throws `HelperError` code 3 (or `focusWindow` returns false after a code 3): same as CRK-03 but toast is `"Target window closed"` and the lock is cleared |
| CRK-05 | Focus fails | `focusWindow` returns false: `typeText` is not called, toast `"Could not focus target"`, lock is kept |
| CRK-06 | Permission error | `typeText` rejects with `HelperError` code 2: toast `"Accessibility permission required"`, `state.typingAvailable` becomes false |
| CRK-07 | Muted | `state.muted: true` skips `audio.play` but still strikes and types |
| CRK-08 | Re-entrancy | A second `crack()` within 300 ms of the first is ignored and returns `{ skipped: "busy" }` |
| CRK-09 | Source and tier | `crack({ source: "hotkey" })` picks from `mild` and `crack({ source: "whip" })` from `medium` when auto is off; with `state.autoOn` and `state.autoCount: 12`, any source picks from `spicy` and increments `autoCount` |
| CRK-10 | Never sends control keys | `typeText` is the only platform call that sends input; assert its options object never contains any key other than `pressEnter`, and that the typed text contains no control characters, across all tests in this file |

---

## 3. Platform helper tests (L2)

### 3.1 Harness: test/helpers/run-helper.mjs

A manual Node script that invokes the real platform adapter against a window the operator chooses. Not run by Vitest.

Usage:

```
node test/helpers/run-helper.mjs foreground
node test/helpers/run-helper.mjs countdown <seconds>      (prints the foreground window after a delay so you can click the one to inspect)
node test/helpers/run-helper.mjs info <id>
node test/helpers/run-helper.mjs focus <id>
node test/helpers/run-helper.mjs type <id> "text to type" [--no-enter]
```

Expected behavior:

1. `foreground` and `countdown` print the WindowInfo JSON (`id`, `title`, `processName`, `pid`) of the foreground window.
2. `info` prints the WindowInfo JSON for the id, or `{ ok: false, code: 3 }` if the window is gone.
3. `focus` brings the window to the foreground and prints `{ ok: true }`; `{ ok: false }` if focus was refused (code 5).
4. `type` focuses the window, types the exact string, including Unicode, and presses Enter unless `--no-enter`; prints `{ ok: true, ms }`. On failure prints `{ ok: false, code, error }` and exits with the code: 2 permission (macOS Accessibility), 3 target gone, 4 unsupported or missing tool (Wayland, `xdotool`), 5 focus failed.

The codes above are the platform helper contract from docs/ARCHITECTURE.md section 6.1. There is no `list`, `enter`, or `crack` subcommand: the adapter has no window listing, and `type` already presses Enter.

### 3.2 Windows typing test: test/helpers/win-typing.test.mjs

Windows-only integration test against a fixture WhipZap controls. Run manually on the dev machine (`node test/helpers/win-typing.test.mjs`) or in the CI windows runner. Skipped automatically on other OSes.

Fixture `test/helpers/win-textbox.ps1`: opens a WinForms window with a multiline TextBox, prints `{"hwnd":"<decimal>","title":"WhipZap typing fixture"}` as its first stdout line, stays open for `-Seconds N` (default 6), captures the TextBox text on close, and prints `{"text":"..."}` as its last line before exiting.

Procedure:

1. Spawn the fixture with `child_process.spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "test/helpers/win-textbox.ps1", "-Seconds", "7"])` and read the first line for the `hwnd`.
2. Create the adapter with `createPlatform()` and `await platform.start()`.
3. Call `platform.typeText(hwnd, "whipzap ascii OK: FASTER! WORK HARDER! ünïcödé ✓ 日本 end", { pressEnter: false })`. The adapter focuses the fixture itself (the test process has no window, so this proves focus switching from a background process).
4. Wait for the fixture to exit and parse its last line.
5. Assert `text === sent` exactly (Unicode included) and print `PASS` with the elapsed milliseconds; otherwise print `FAIL` with both strings and exit 1.

Pass criteria: exact equality, no leftover PowerShell fixture process, runtime under 15 seconds. Spike result on 2026-10-21: exact match in 428 ms.

Why not Notepad: the Windows 11 store Notepad mangled burst Unicode input in the spike (first word correct, remainder garbled), and reading its content back is unreliable. The WinForms fixture is deterministic and needs no UI Automation.

### 3.3 macOS and Linux

No automated self-test. Verified by the manual checklist in section 6 and marked UNVERIFIED-ON-HARDWARE in docs/ROADMAP.md until a human reports results. Unit tests with an injected `execFileImpl` assert the exact argv each adapter builds (`/bin/sh <helper> <command> [id] [--enter]`) and that text goes to stdin. Code review must check:

- macOS helper `src/main/helpers/mac/helper.sh` uses `osascript` with `System Events` `keystroke` for text and `key code 36` for Enter, never `key code 53` (Escape) or control-modified keys.
- macOS helper detects a missing Accessibility grant by the osascript error text containing `not allowed assistive access` or exit code 1 with `-1719` or `-25211`, and maps it to exit code 2.
- Linux helper `src/main/helpers/linux/helper.sh` checks `command -v xdotool` and exits 4 with `xdotool not found` if missing. It uses `xdotool windowactivate --sync <id>`, `xdotool type --delay 8 --clearmodifiers` with the text from stdin, `xdotool key Return` when `--enter`.
- Linux helper detects Wayland via `XDG_SESSION_TYPE=wayland` (or `WAYLAND_DISPLAY` set with `DISPLAY` unset) and exits 4 with `Wayland is not supported`, which the app surfaces as a toast.

---

## 4. Overlay smoke test (L3) [ASSUMED]

Launch `electron . --whipzap-selftest`. In self-test mode `app.js`:

1. Creates the overlay window, loads `overlay.html`, waits for a `ready` IPC from the renderer.
2. Sends `strike` with text `SELFTEST`, waits 600 ms.
3. Sends `spawn-whip`, waits 300 ms, sends `drop-whip`, waits 300 ms.
4. Exits 0 if no `console-message` of level error was received from the renderer and no uncaught exception occurred, else exits 1.

Command: `npm run selftest` (script: `electron . --whipzap-selftest`). Expected: exit 0 in under 5 seconds. This requires a display and runs on the dev machine. In CI it is skipped and the skip is logged.

---

## 5. Lint

- `eslint.config.js` flat config with `@eslint/js` recommended rules, `sourceType: module`, globals for node in `src/main` and `bin`, browser globals in `src/overlay`.
- Additional rule: a custom check or grep in CI that fails if any file under `src/` (which includes `src/main/helpers/`) or `bin/` contains the strings `\x03`, `ctrl+c`, `control+c`, `key code 53`, `{ESC}`, `VK_ESCAPE`, `VK_MENU`, `KEYEVENTF_EXTENDEDKEY` with a modifier, or `Escape` in a send-key context. Implement as `scripts/check-forbidden-keys.mjs` run by `npm run lint:keys`. This enforces decisions D-1 and D-13 mechanically.

---

## 6. Manual smoke checklists (L4)

Each checklist is run on real hardware before release. Record results as a dated section in `docs/SMOKE-RESULTS.md` (created at M6) with OS version, WhipZap version, and tester.

### 6.1 Windows 11

Preconditions: Node 20 or later, `npm install -g whipzap` or `npm ci` in a clone, Windows Terminal with Claude Code installed and logged in, VS Code with the Claude Code extension.

- [ ] W-01 Launch `whipzap`. Expected: tray icon appears within 3 seconds, no console window stays open.
- [ ] W-02 Tray menu order is: Arm whip, Crack now, Auto mode, Delivery: Safe · /btw, Mute, Open config, Lock target, Quit.
- [ ] W-03 Focus Windows Terminal running Claude Code. Press Ctrl+Alt+W. Expected: crack sound, strike flash with the message in large text for about one second, the same message typed into the terminal input and submitted. No confirm dialog because the process matched the allow list.
- [ ] W-04 With Claude Code busy on a long task, press Ctrl+Alt+W. Expected: the message shows as queued in Claude Code and is delivered after the current tool call. The task is not interrupted.
- [ ] W-05 Switch delivery to /btw in the tray. Press Ctrl+Alt+W while Claude Code is busy. Expected: `/btw <message>` is submitted and Claude Code answers it in a side panel or inline without stopping work.
- [ ] W-06 Focus Slack, Notepad, or a browser. Press Ctrl+Alt+W. Expected: dialog "Whip this window? <title>". Choose No. Expected: toast "No target locked", nothing typed.
- [ ] W-07 Repeat W-06 and choose Yes. Expected: message typed into that window. Then use Lock target on a terminal to move the lock back.
- [ ] W-08 Lock a terminal, close it, press Ctrl+Alt+W. Expected: sound and strike, toast "Target window closed", lock cleared.
- [ ] W-09 Press Ctrl+Alt+Shift+W. Expected: cursor hidden, rope hangs from the cursor on the primary display. Flick the mouse fast. Expected: crack, message typed into the locked target. Click. Expected: rope drops off screen, cursor returns.
- [ ] W-10 Press Ctrl+Alt+A. Expected: toast "Auto mode on". Wait. Expected: cracks arrive at irregular intervals, never closer than 20 seconds, messages escalate from mild to medium after the 5th crack. Toggle off with Ctrl+Alt+A. Expected: toast "Auto mode off", no further cracks.
- [ ] W-11 Set `auto.sessionCap` to 3 and `auto.baseIntervalSec` to 20 in config, restart, enable auto. Expected: exactly 3 cracks, then toast "Auto session cap reached (3)" and the tray item unchecks.
- [ ] W-12 Mute in tray. Crack. Expected: no sound, visual and typing still happen.
- [ ] W-13 Open config from tray. Expected: `config.json` opens in the default editor at `%APPDATA%\whipzap\config.json`.
- [ ] W-14 Break the config file (delete a brace), restart. Expected: app starts with defaults, `config.json.bak` exists, toast "Config invalid, using defaults".
- [ ] W-15 VS Code: focus the Claude Code extension chat input, press Ctrl+Alt+W. Expected: message typed into the chat input and submitted. Confirm dialog does not appear because `Code.exe` matches.
- [ ] W-16 WSL2: run Claude Code inside WSL in Windows Terminal. Press Ctrl+Alt+W. Expected: identical to W-03. WhipZap runs on the Windows side.
- [ ] W-17 Unicode: add `{ "tier": "mild", "text": "Schneller, Kollege! 🐢" }` to `messages.extra`, restart, crack repeatedly until it appears. Expected: typed exactly, emoji included.
- [ ] W-18 Quit from tray. Expected: tray icon gone, no `whipzap` or `electron` process remains in Task Manager.
- [ ] W-19 Second instance: run `whipzap` twice. Expected: second launch exits immediately, first keeps running.
- [ ] W-20 Hotkey conflict: set `hotkeys.crack` to an accelerator already taken by another app. Expected: toast "Hotkey <accel> is taken. Change it in config." on start (with the actual accelerator), other hotkeys still work.

### 6.2 macOS (UNVERIFIED-ON-HARDWARE until run)

Preconditions: macOS 14 or later, Node 20, Terminal or iTerm2 with Claude Code, VS Code with the extension.

- [ ] M-01 First launch. Expected: dialog explaining that Accessibility permission is needed, with a button that opens System Settings at Privacy and Security, Accessibility. The app keeps running without the grant and shows sound and visuals only.
- [ ] M-02 Grant Accessibility to the app shown in the list (Electron or the terminal that launched whipzap, see docs/UX.md for the exact wording). Crack again. Expected: text typed.
- [ ] M-03 Hotkeys are Cmd+Alt+W, Cmd+Alt+Shift+W, Cmd+Alt+A. Each works as the Windows equivalents W-03, W-09, W-10.
- [ ] M-04 Safe and /btw flows as W-04 and W-05.
- [ ] M-05 Wrong-window confirm as W-06 and W-07 using Safari.
- [ ] M-06 Target closed as W-08.
- [ ] M-07 Full-screen Terminal: the overlay is visible over a full-screen space and the message still types. If the overlay does not show, text must still type and the result is recorded.
- [ ] M-08 The tray (menu bar) icon is a template image and renders correctly in light and dark menu bars at 22 points.
- [ ] M-09 Quit from the menu bar. Expected: no process remains.
- [ ] M-10 VS Code extension input as W-15.

### 6.3 Linux X11 (UNVERIFIED-ON-HARDWARE until run)

Preconditions: Ubuntu 22.04 or later on X11, `xdotool` installed, Node 20, terminal with Claude Code.

- [ ] L-01 Without `xdotool`: the start dialog from docs/UX.md section 1.4 appears and each crack shows toast "xdotool not found". Sound and visuals still play.
- [ ] L-02 With `xdotool`: W-03, W-04, W-05 equivalents pass.
- [ ] L-03 Wrong window, target closed, whip mode, auto mode as W-06 to W-11.
- [ ] L-04 On a Wayland session: the start dialog from docs/UX.md section 1.4 appears and each crack shows toast "Wayland is not supported", sound and visuals still play, no typing attempted.
- [ ] L-05 Tray icon appears in GNOME with the AppIndicator extension or in KDE. If no tray is available, the app logs a warning and hotkeys still work.

### 6.4 Claude Code behavior reference for testers

| Situation | Expected after a Safe crack | Expected after a /btw crack |
|---|---|---|
| Agent idle at prompt | New turn starts with the message, agent replies briefly | Agent answers the side question, no history entry |
| Agent running tool calls | Message shows as queued, delivered after the current tool batch, same turn, no interruption | Side answer appears while work continues |
| Agent waiting on a permission prompt | Text lands in the prompt input and is not submitted as a command [ASSUMED, verify and record] | Same |

If a Safe crack ever interrupts the agent, that is a release blocker. Record the Claude Code version.

---

## 7. CI definition

File: `.github/workflows/ci.yml`

```
name: ci
on: [push, pull_request]
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run lint:keys
      - run: npm test
      - if: runner.os == 'Windows'
        run: node test/helpers/win-typing.test.mjs
        continue-on-error: true
```

Rules:

1. No Electron GUI runs in CI. `npm ci` downloads the Electron binary, which is acceptable. If download time becomes a problem, set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` for the test job.
2. The Windows typing test uses `continue-on-error: true` until it has passed three consecutive runs on `windows-latest`, after which the flag is removed. If the hosted runner has no interactive desktop session and the test cannot focus windows, the step is replaced by a documented skip and the test remains a dev-machine test.
3. The workflow must be green on all three OSes before any tag is pushed.
4. `npm run lint:keys` is the mechanical guard for D-1 (no interrupting keys) and fails the build on violation.

---

## 8. Definition of "verified" per milestone

| Milestone | Verified means |
|---|---|
| M0 Scaffold | `npm ci`, `npm run lint`, `npm test` exit 0 locally and CI is green on three OSes. `npm start` shows a tray icon on Windows and Quit exits cleanly |
| M1 Typing spike | Windows typing test (3.2) passes 3 consecutive runs on the dev machine. Harness `type` command types into Windows Terminal, VS Code, and a WSL2 terminal. macOS and Linux helpers pass code review against section 3.3 and are marked UNVERIFIED-ON-HARDWARE |
| M2 Core crack | All unit cases in sections 2.3 to 2.8 exist and pass. W-03 to W-08 and W-13, W-14, W-19, W-20 pass on Windows |
| M3 Overlay | Overlay smoke test exits 0. W-03 visual portion, W-12 pass. Strike flash does not steal focus (typed text still lands) |
| M4 Whip mode | W-09 passes. Rope renders at 60 fps on the dev machine with no visible stutter. Crack threshold is reachable with a normal wrist flick and not triggered by slow movement |
| M5 Auto mode | SCH-01 to SCH-14 pass. W-10, W-11 pass |
| M6 Release | Section 9 complete |

---

## 9. Release gate checklist (v0.1.0)

- [ ] R-01 CI green on ubuntu, windows, macos for the release commit.
- [ ] R-02 Windows checklist 6.1 fully executed and recorded in `docs/SMOKE-RESULTS.md`.
- [ ] R-03 macOS checklist 6.2 executed by a human, or the release notes state "macOS: untested on hardware, Accessibility flow verified by code review only".
- [ ] R-04 Linux checklist 6.3 executed, or release notes state Linux X11 is best-effort and untested.
- [ ] R-05 `npm pack --dry-run` lists only: `bin/`, `src/` (which contains `src/main/helpers/`), `assets/`, `package.json`, `README.md`, `LICENSE`. No `test/`, no `docs/`, no `.github/`, no `scripts/`.
- [ ] R-06 `assets/CREDITS.md` names the source and license (CC0) of every sound and icon.
- [ ] R-07 README states exactly what a crack does to the agent (queued message or /btw side question) and that it never interrupts.
- [ ] R-08 `package.json` version is `0.1.0`, `CHANGELOG.md` has a `0.1.0` section.
- [ ] R-09 `npm run lint:keys` passes.
- [ ] R-10 No file under the repo was copied from OpenWhip. Reviewer confirms by reading `src/main/helpers/`, `src/overlay/rope.js`, and `assets/`.
- [ ] R-11 Tag `v0.1.0` created only after the owner approves publishing. No `npm publish` without explicit owner approval.

---

## Deviations (2026-10-21)

1. Windows integration test targets a WinForms TextBox fixture (`win-textbox.ps1`, `win-typing.test.mjs`) instead of Notepad. Reason: Windows 11 store Notepad mangles burst Unicode input and cannot be read back reliably.
2. Harness subcommands are `foreground | countdown | info | focus | type`; `list`, `enter`, `crack` removed. Reason: the adapter has no window listing and `typeText` presses Enter itself.
3. Helper codes are 1 other, 2 permission, 3 target gone, 4 unsupported or missing tool, 5 focus failed (was 2/3/4/5/6). Reason: single scheme across docs and code.
4. Helper paths are `src/main/helpers/<os>/`; R-05 and R-10 updated. Reason: packaging inside `src/`.
5. Module APIs in 2.2 to 2.8 updated to the final signatures in docs/ARCHITECTURE.md section 4 (`createTargetStore`, `createCrack(deps).crack({ source })`, `typeText(id, text, { pressEnter })`).
6. Toast strings aligned to docs/UX.md section 8 verbatim (W-11, W-14, W-20, L-01, L-04).
7. `lint:keys` also forbids `VK_MENU` (synthesized Alt), per D-13.
