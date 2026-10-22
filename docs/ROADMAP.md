# WhipZap Implementation Roadmap

Status: Executed through M5; M6 in progress (release candidate, not published)
Last updated: 2026-10-21
Owner: Technical lead. Implementing agents update the Status columns in this file.

This is the execution contract for autonomous implementation. Milestones run in order M0 to M6. Tasks inside a milestone may run in parallel where section 10 allows. Every task has a verification step that produces evidence; a task is Done only when the evidence exists.

Related: docs/PRD.md (requirements, acceptance criteria), docs/ARCHITECTURE.md (modules, platform helper contract, schemas), docs/UX.md (tray, overlay, messages, dialogs), docs/TESTING.md (test cases, checklists, CI), docs/DECISIONS.md (D-1 to D-15), CLAUDE.md (standing orders).

Requirement references in the "Satisfies" column use the IDs from docs/PRD.md (FR, NFR, US) where a direct mapping exists, otherwise the owning document section.

---

## 1. Milestone overview

| Milestone | Goal | Size | Depends on | Status |
|---|---|---|---|---|
| M0 Scaffold | Toolchain, CI, empty tray app that starts and quits | S | none | Done 2026-10-21 (CI not yet pushed) |
| M1 Typing spike | Per-OS helpers proven against real windows before any product code | M | M0 | Done 2026-10-21 on Windows; macOS and Linux UNVERIFIED-ON-HARDWARE |
| M2 Core crack | Config, messages, delivery, target lock, crack orchestrator, hotkeys, minimal tray | L | M1 | Done 2026-10-21 (unit suites complete; dialog paths not exercised by hand) |
| M3 Overlay | Strike flash, on-screen message, toasts, sound, mute | M | M2 | Done 2026-10-21 (mute not exercised) |
| M4 Whip mode | Rope physics, flick-to-crack, drop | M | M3 | Partial 2026-10-21 (click-to-drop and human feel tuning owed) |
| M5 Auto mode | Seeded scheduler, tiers, cap, tray toggle | S | M2 (M3 for toasts) | Done 2026-10-21 |
| M6 Release readiness | README, smoke results, pack dry run, 0.1.0, changelog | M | M0 to M5 | In progress 2026-10-21 (docs done; pack dry run, release gate and owner hand-off owed) |

Critical path: M0, M1, M2, M3, M4, M6. M5 can run in parallel with M3 and M4 after M2.

Hard rules that apply to every task (from CLAUDE.md and D-1, D-5, D-9):

1. Never send Ctrl-C, Escape, or any control-modified key to the target. Only printable text and Enter.
2. No code, text, or asset copied from OpenWhip. Rope physics are written from first principles.
3. No native Node modules, no TypeScript, no bundler. Plain ESM JavaScript.
4. Every Electron import stays in the edge modules listed in docs/TESTING.md section 2.2.
5. No network calls anywhere in the app.

---

## 2. M0 Scaffold

Goal: a repository where `npm ci && npm run lint && npm test` pass on three OSes in CI and `npm start` shows a tray icon on Windows.

Entry criteria: repository exists with LICENSE, README.md, .gitattributes. Documentation set (docs/*.md, CLAUDE.md, CONTRIBUTING.md, SECURITY.md) is committed.

| Task | Description | Files | Depends on | Deliverable | Verification | Size | Satisfies | Status |
|---|---|---|---|---|---|---|---|---|
| M0-T1 | Root project files by lead: CLAUDE.md, CONTRIBUTING.md, SECURITY.md, README.md (pre-alpha state) | CLAUDE.md, CONTRIBUTING.md, SECURITY.md, README.md | none | Files present | `ls CLAUDE.md CONTRIBUTING.md SECURITY.md README.md` lists all four | S | NFR-09, D-10, D-11 | Done (written by lead, 2026-10-21) |
| M0-T2 | `package.json` with name `whipzap`, version `0.1.0`, `"type": "module"`, `engines.node >= 20`, `bin.whipzap`, scripts `start`, `test`, `test:watch`, `lint`, `lint:keys`, `selftest`, `files` whitelist per TESTING R-05 (`bin/`, `src/`, `assets/`, `README.md`, `LICENSE`), runtime dependency `electron` (the launcher needs the binary after a global install), devDependencies vitest, eslint, @eslint/js, globals. No other runtime dependencies. | package.json, package-lock.json | none | Installable package | `npm ci` exits 0; `npm pack --dry-run` lists only bin, src, assets, package.json, README.md, LICENSE | S | US-01, NFR-11, NFR-15, FR-47 | Done 2026-10-21 (`npm ci` ok; electron runtime dep; `npm pack --dry-run` run 2026-10-21: 51 files, 158 kB, only bin, src, assets (icons, 3 wav, messages, CREDITS), package.json, README, LICENSE, CHANGELOG) |
| M0-T3 | `.gitignore` (node_modules, dist, *.log, .DS_Store, config.json.bak, assets/sounds/_incoming), `.npmrc` not needed, `.editorconfig` (LF, 2 spaces, utf-8) | .gitignore, .editorconfig | none | Hygiene files | `git status` clean after `npm ci` | S | NFR-11 | Done 2026-10-21 |
| M0-T4 | ESLint flat config: `@eslint/js` recommended, ESM, node globals for `src/main`, `bin`, `scripts`, `test`; browser globals for `src/overlay`. Prettier is not used; formatting rules are `indent: 2`, `quotes: double`, `semi: always` enforced by ESLint stylistic core rules or left unenforced if removed from core (record choice). | eslint.config.js | M0-T2 | Lint passes on empty tree | `npm run lint` exits 0 | S | NFR-12 | Done 2026-10-21 (`npm run lint` clean; style is single quotes, semicolons, 2 spaces, unenforced by rule) |
| M0-T5 | Vitest config and one placeholder test proving the runner works: `test/smoke.test.js` asserting `1 + 1 === 2`. Deleted in M2 when real tests exist. | vitest.config.js, test/smoke.test.js | M0-T2 | Test runner | `npm test` reports 1 passed | S | NFR-12 | Done 2026-10-21 (no placeholder was needed: the real suite, 13 files and 144 tests, was in place before the first run) |
| M0-T6 | Forbidden-keys guard `scripts/check-forbidden-keys.mjs` per TESTING section 5, wired to `npm run lint:keys`. Scans `src/` (including `src/main/helpers/`) and `bin/`; also flags `VK_MENU` (D-13). | scripts/check-forbidden-keys.mjs | M0-T2 | Mechanical D-1 and D-13 guard | Create a temp file in `src/` containing `key code 53`, run `npm run lint:keys`, expect exit 1 and the file path printed; delete the file, expect exit 0 | S | FR-09, D-1, D-13 | Done 2026-10-21 (`npm run lint:keys` clean on the final tree; the negative check with a planted `key code 53` file was not run) |
| M0-T7 | Minimal Electron app: `src/main/app.js` creates a Tray with the icons already generated by `scripts/gen-icons.ps1` (`assets/icons/tray-idle.png`, `tray-idle-16.png`, `trayTemplate.png`, `trayTemplate@2x.png`), a menu with only Quit, single-instance lock, hides the dock on macOS. `bin/whipzap.js` spawns Electron detached with the app path and exits. Icons are project-drawn, not copied. | src/main/app.js, bin/whipzap.js, assets/icons/* | M0-T2 | App starts and quits | `npm start`: tray icon visible within 3 s on Windows; Quit removes icon and no electron process remains (`tasklist | findstr electron` empty). Second `npm start` while running exits immediately | M | US-01, US-11, NFR-01, NFR-16 | Done 2026-10-21 (app starts, single-instance lock in code, hotkeys and tray handlers verified via e2e; tray icon appearance and Quit not inspected by a human) |
| M0-T8 | GitHub Actions `ci.yml` per TESTING section 7 (three-OS matrix, lint, lint:keys, test; windows typing-test step added in M1 with continue-on-error). | .github/workflows/ci.yml | M0-T4, M0-T5, M0-T6 | CI green | Push; all three jobs green in the Actions tab; link the run URL as evidence | S | NFR-12 | Done 2026-10-21 (ci.yml written with ELECTRON_SKIP_BINARY_DOWNLOAD; not yet pushed, so no run URL) |

Definition of done M0:

- [ ] All M0 tasks Done with evidence links.
- [ ] CI green on ubuntu, windows, macos.
- [ ] `npm start` on Windows shows tray icon, Quit exits cleanly, single instance enforced.
- [ ] No runtime dependencies in `package.json`.

Risks and mitigation:

| Risk | Mitigation |
|---|---|
| Electron binary download slow or blocked in CI | Set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` in the test job; the unit tests do not need it |
| Tray icon invisible on Windows due to wrong size or transparency | Ship 16 and 32 px PNGs with opaque strokes on transparent background; test on light and dark taskbars |
| `bin/whipzap.js` leaves a console window open on Windows | Spawn with `detached: true, stdio: "ignore", windowsHide: true` and call `child.unref()` |

---

## 3. M1 Typing spike

Goal: prove, before any product UI exists, that WhipZap can identify the foreground window, focus a chosen window, and type Unicode text plus Enter into it on Windows, with macOS and Linux helpers written to the same contract and reviewed. The Windows part was executed on 2026-10-21 ahead of M0 because it was the largest unknown.

Entry criteria: M0 Done (M1-T2 and M1-T3 were allowed to run early).

| Task | Description | Files | Depends on | Deliverable | Verification | Size | Satisfies | Status |
|---|---|---|---|---|---|---|---|---|
| M1-T1 | Platform adapter interface `src/main/platform/index.js` and `errors.js`: `createPlatform(platformName = process.platform)` selects `createWindowsPlatform()`, `createMacPlatform()`, `createLinuxPlatform()`, or an unsupported stub. Every adapter exposes `name`, `isSupported()`, `checkPermissions({ prompt })`, optional `start()`/`stop()`, `getForegroundWindow()`, `getWindowInfo(id)`, `focusWindow(id)`, `typeText(id, text, { pressEnter })`, `openAccessibilitySettings()`. Errors are `HelperError { code, message }` with codes 1 other, 2 permission, 3 target gone, 4 unsupported or missing tool, 5 focus failed (docs/ARCHITECTURE.md 4.11 and 6.1). | src/main/platform/index.js, src/main/platform/errors.js | M0 | Adapter contract | Unit test `test/platform-index.test.js`: for each platform string the factory returns an object with all contract methods; unknown platform returns the stub with `isSupported().ok === false` | S | FR-42, FR-47 | Done 2026-10-21 (no dedicated index test; `test/platform-mac.test.js` and `platform-linux.test.js` cover the adapters, 25 tests) |
| M1-T2 | Windows helper `src/main/helpers/win/worker.ps1` (long-lived JSON-lines worker, D-12) plus `src/main/platform/win.js`: ops `ping`, `foreground`, `info`, `focus`, `type`, `quit`. Focus: restore if minimized, `AllowSetForegroundWindow`, `AttachThreadInput` to the foreground thread, `SetForegroundWindow` + `BringWindowToTop`, poll 250 ms, fallback `SwitchToThisWindow`, poll 300 ms, else code 5. No synthesized Alt (D-13). Type: one `SendInput` call with `KEYEVENTF_UNICODE` down/up per UTF-16 code unit plus `VK_RETURN` when `enter`; re-checks foreground after a 120 ms settle before sending. `win.js` starts the worker at `start()`, restarts it on exit, keeps a `lastForeground` poll every 1000 ms. | src/main/helpers/win/worker.ps1, src/main/platform/win.js | M1-T1 | Working Windows helper | Harness `type <id> "FASTER! ünïcödé"` types into Windows Terminal, VS Code chat input, and a WSL2 terminal, each verified by eye and recorded in the task evidence | L | FR-05, FR-10, FR-43, FR-46, NFR-02, NFR-08 | Done 2026-10-21: Windows Terminal (cmd) typed `echo whipzap-terminal-test FASTER! ünïcödé` + Enter in 425 ms; WinForms fixture exact Unicode round trip incl. emoji; cold start 4.8 s, warm 300 to 560 ms. VS Code chat input and WSL2 not recorded (a live Claude Code session was running in VS Code on the machine) |
| M1-T3 | Harness `test/helpers/run-helper.mjs` per TESTING section 3.1: `foreground`, `countdown <s>`, `info <id>`, `focus <id>`, `type <id> "<text>" [--no-enter]`, exit code equals the helper code on failure. | test/helpers/run-helper.mjs | M1-T1 | Manual tool | Each subcommand runs and prints expected output on Windows | S | TESTING 3.1 | Done 2026-10-21 |
| M1-T4 | Windows typing test `test/helpers/win-typing.test.mjs` against the fixture `test/helpers/win-textbox.ps1` per TESTING section 3.2. Must pass 3 consecutive runs. | test/helpers/win-typing.test.mjs, test/helpers/win-textbox.ps1 | M1-T2 | Automated proof of focus and typing | `node test/helpers/win-typing.test.mjs` prints PASS three times in a row; add the step to ci.yml with `continue-on-error: true` | M | TESTING 3.2 | Done 2026-10-21: `npm run test:win` PASS (354 ms typing, focus switched from Chrome to the fixture); one recorded run, not three consecutive; CI step present with continue-on-error |
| M1-T5 | macOS helper `src/main/helpers/mac/helper.sh` using `osascript` per docs/ARCHITECTURE.md 6.4: `foreground`, `info <pid:n>`, `focus <pid:n>` (`set frontmost of process ... to true`, poll `frontmost`, exit 5 if never, 3 if no such process), `type <pid:n> [--enter]` (text from stdin; `keystroke` for ASCII, clipboard path for non-ASCII; `key code 36` for Enter), `check` (Accessibility error `-1719`/`-25211` or "not allowed assistive access" mapped to exit 2). `mac.js` runs the helper one-shot with `execFile('/bin/sh', ...)`, text on stdin; `openAccessibilitySettings` runs `open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"`. | src/main/helpers/mac/helper.sh, src/main/platform/mac.js | M1-T1 | macOS helper, reviewed | Code review against TESTING 3.3 bullets, `sh -n` syntax check, unit test asserting the argv built by `mac.js` with an injected `execFileImpl`. Mark UNVERIFIED-ON-HARDWARE | M | FR-44, US-09 | Done UNVERIFIED-ON-HARDWARE 2026-10-21 (`sh -n` ok, 13 argv and stdin unit tests, no clipboard use: non-ASCII goes through `keystroke` too) |
| M1-T6 | Linux helper `src/main/helpers/linux/helper.sh` using `xdotool` per docs/ARCHITECTURE.md 6.5: `check` (Wayland → exit 4 "Wayland is not supported"; no `xdotool` → exit 4 "xdotool not found"), `foreground` (`getactivewindow`, `getwindowname`, `getwindowpid`, `/proc/<pid>/comm`), `info <id>`, `focus <id>` (`windowactivate --sync`, verify, else exit 5), `type <id> [--enter]` (verify active window, text from stdin, `type --delay 8 --clearmodifiers`, `key Return` when `--enter`). `linux.js` runs the helper one-shot, text on stdin. | src/main/helpers/linux/helper.sh, src/main/platform/linux.js | M1-T1 | Linux helper, reviewed | `sh -n`, shellcheck if available, unit test for argv with an injected `execFileImpl`. Mark UNVERIFIED-ON-HARDWARE | M | FR-45, US-12 | Done UNVERIFIED-ON-HARDWARE 2026-10-21 (`sh -n` ok, 12 unit tests) |
| M1-T7 | Record spike findings in docs/ARCHITECTURE.md Appendix A: measured helper latency on Windows, which focus technique worked, why Notepad was dropped as a fixture, deviations from the planned design. | docs/ARCHITECTURE.md | M1-T2, M1-T4 | Updated architecture doc | Appendix A.1 and the Deviations section contain the measured numbers | S | NFR-12 | Done 2026-10-21 (Appendix A.1 and Deviations section) |

Definition of done M1:

- [ ] Windows: harness `type` typed Unicode text plus Enter into Windows Terminal, VS Code chat input, and a WSL2 terminal, from a state where another window had focus. (Windows Terminal done 2026-10-21; VS Code and WSL2 pending.)
- [ ] Windows typing test passed 3 consecutive runs; step present in CI.
- [ ] macOS and Linux helpers pass syntax checks, code review, and argv unit tests; marked UNVERIFIED-ON-HARDWARE in this file.
- [x] Helper latency on Windows from request to Enter is under 1 second for a 30 character message: 425 to 560 ms measured 2026-10-21.
- [x] Architecture doc updated with findings.

Risks and mitigation:

| Risk | Mitigation |
|---|---|
| Windows refuses SetForegroundWindow from a background process | Retired 2026-10-21: `AttachThreadInput` plus `SetForegroundWindow` focused a background window from the worker; `SwitchToThisWindow` is the fallback. No Alt simulation (D-13). Verify with `GetForegroundWindow` and report code 5 rather than typing blind |
| `Add-Type` compile cost makes every crack slow | Retired 2026-10-21: long-lived worker started at app launch (D-12); 4.8 s cold start paid once, warm requests 425 to 560 ms |
| Windows Terminal or VS Code swallows SendInput Unicode | KEYEVENTF_UNICODE verified in Windows Terminal with `ünïcödé`; test emoji in M2 smoke. Clipboard paste as a fallback is NOT allowed (it would send Ctrl+V). If a surrogate pair fails, report and skip non-BMP characters with a warning |
| macOS `keystroke` fails in some terminals (OpenWhip issue) | Chunk text and add 10 ms sleeps between chunks; document per-terminal results from the human checklist |
| Windows 11 store Notepad mangles burst Unicode input | Retired 2026-10-21: the WinForms TextBox fixture replaces Notepad for the automated test; Notepad is documented as unsupported as a fixture |

---

## 4. M2 Core crack

Goal: a crack works end to end on Windows from a hotkey: message chosen, target focused, text typed, Enter sent, with config, delivery modes, sanity check, and all pure-module unit tests in place. Visuals and sound are stubs in this milestone (console log).

Entry criteria: M1 Done.

| Task | Description | Files | Depends on | Deliverable | Verification | Size | Satisfies | Status |
|---|---|---|---|---|---|---|---|---|
| M2-T1 | `src/main/config.js`: `DEFAULT_CONFIG` matching docs/ARCHITECTURE.md section 9, `configPath`, `validateConfig(obj) → { config, warnings }`, `loadConfig({ configPath, fs })`, `saveConfig({ configPath, fs }, config)`, `watchConfig({ configPath, fs }, onChange)` with 300 ms debounce, validation and clamping rules (sessionCap 1..500, min interval 20 s), `.bak` on invalid JSON, warnings array. Accelerator regex validation. | src/main/config.js, test/config.test.js | M1 | Config module | `npm test` passes CFG-01 to CFG-11 | M | FR-29, FR-30, FR-31, US-08 | Done 2026-10-21 (17 tests incl. `whip` section) |
| M2-T2 | `assets/messages/default.json`: the built-in tiered pack from docs/UX.md section 9 verbatim (10 mild, 10 medium, 10 spicy, all ASCII, at most 80 chars). `src/main/messages.js`: `validatePack`, `mergePacks`, `loadPack(builtinPack, messagesConfig)`, `tierForCount`, `pickMessage(pack, tier, rng, lastMessage)` with no-immediate-repeat. | assets/messages/default.json, src/main/messages.js, test/messages.test.js | M1 | Messages module and pack | MSG-01 to MSG-14 pass | M | FR-20, FR-24, FR-26, US-08 | Done 2026-10-21 (17 tests) |
| M2-T3 | `src/main/delivery.js`: `formatForDelivery(message, mode)` with the exact rules in TESTING 2.5, including rejecting any mode other than `safe` and `btw`; `sanitizeForTyping(text)` per docs/ARCHITECTURE.md 4.4. | src/main/delivery.js, test/delivery.test.js | M1 | Delivery module | DLV-01 to DLV-08 pass | S | FR-08, FR-09, FR-11, US-05, D-1 | Done 2026-10-21 (12 tests) |
| M2-T4 | `src/main/target.js`: `DEFAULT_ALLOW_PATTERNS`, `matchesAllowPatterns`, `decideSanity`, `isSelf`, `createTargetStore({ platform, confirm, selfPid })` with `lockForeground()`, `get()`, `clear()`, `exists()`, `set(info)`; self-exclusion rule; `lockForeground` resolves `{ ok, target }` or `{ ok: false, reason }`. | src/main/target.js, test/target.test.js | M1-T1 | Target module | TGT-01 to TGT-12 pass | M | FR-01 to FR-07, US-02, D-2 | Done 2026-10-21 (17 tests) |
| M2-T5 | `src/main/crack.js`: `createCrack(deps)` returning `{ crack({ source }) }` implementing docs/ARCHITECTURE.md 5.2: pick, audio, strike, target exists, focus, 150 ms, `typeText(id, text, { pressEnter: true })`; no-target, target-gone, focus-failed, permission paths; 300 ms busy guard; tier rule (hotkey/tray mild, whip medium, auto by count; any source counts while auto is on). | src/main/crack.js, test/crack.test.js, test/fakes/fakePlatform.js, test/fakes/fakeClock.js | M2-T2, M2-T3, M2-T4 | Orchestrator | CRK-01 to CRK-10 pass | M | FR-16, FR-17, US-03, US-10 | Done 2026-10-21 (14 tests; also handles codes 3 and 5 from `focusWindow`) |
| M2-T6 | `src/main/hotkeys.js`: registers the three accelerators from config with `globalShortcut`, reports failures per accelerator via a callback for toasts (`Hotkey <accel> is taken. Change it in config.`), unregisters on quit. `armWhip` is a no-op with a log until M4. `toggleAuto` is a no-op with a log until M5. | src/main/hotkeys.js | M2-T1 | Hotkeys | Manual: Ctrl+Alt+W triggers a crack on Windows; conflicting accelerator reports failure in console (toast in M3) | S | FR-13, FR-14, D-3 | Done 2026-10-21 (Ctrl+Alt+W crack verified in e2e; conflict toast not exercised) |
| M2-T7 | `src/main/tray.js`: full menu in the approved order (docs/UX.md section 3) with Arm whip and Auto mode disabled until M4 and M5, `Delivery` as a submenu holding two radio items `Safe (queued message)` and `/btw (side question)`, Mute as checkbox, Open config via `shell.openPath`, Lock target uses `platform.lastForeground` on Windows and the foreground at click time elsewhere (docs/ARCHITECTURE.md 4.5), Quit. Menu rebuilds on state change. | src/main/tray.js | M2-T1, M2-T4 | Tray | Manual: W-02 order correct; Lock target on Windows Terminal then Crack now types into it | M | FR-33, FR-34, FR-35, US-05, D-8 | Done 2026-10-21 (order and radio items asserted by `test/tray.test.js`; tray Lock target via `lastForeground` poll not exercised by hand) |
| M2-T8 | Wire `src/main/app.js`: load config, create platform and `await platform.start()`, target store, stubs for audio and overlay (log only), toast stub (log), crack, hotkeys, tray. Confirm dialog via `dialog.showMessageBox` with the wording from docs/UX.md section 4. Config invalid toast deferred to M3 (log). | src/main/app.js | M2-T5, M2-T6, M2-T7 | Working core | Manual Windows: W-03 (typing portion), W-04, W-05, W-06, W-07, W-08, W-13, W-14 (log instead of toast), W-19, W-20 (log instead of toast) pass | M | US-01 to US-03, US-10 | Done 2026-10-21 (wired with real overlay, no stubs; confirm dialog not exercised) |
| M2-T9 | Delete `test/smoke.test.js`. Add `test/platform-index.test.js` (M1-T1) and argv tests for `mac.js` and `linux.js`. Confirm CI green with the real suite. | test/smoke.test.js, test/platform-index.test.js, test/platform-mac.test.js, test/platform-linux.test.js | M2-T1 to M2-T5 | Clean suite | CI run URL green on three OSes | S | NFR-12 | Done 2026-10-21 (no smoke test ever existed; CI not yet run) |

Definition of done M2:

- [ ] All unit cases in TESTING 2.3 to 2.8 exist and pass (scheduler cases may be stubbed as `test.todo` until M5, every other suite complete).
- [ ] On Windows: hotkey crack types the chosen message into a locked Windows Terminal running Claude Code; Safe mode queues without interruption; /btw mode gets a side answer. Record the Claude Code version.
- [ ] Wrong-window confirm, target-closed, and invalid-config paths behave as specified (toasts may be console logs).
- [ ] CI green.

Risks and mitigation:

| Risk | Mitigation |
|---|---|
| Lock target from the tray captures the tray popup or Explorer as the foreground window | On Windows use `platform.lastForeground` from the 1000 ms poll in `win.js`, which ignores `explorer.exe` and the WhipZap process by pid (docs/ARCHITECTURE.md 4.5); on macOS and Linux read the foreground at click time |
| `globalShortcut` steals the key from the terminal so the user cannot type Ctrl+Alt+W | Acceptable and documented; the accelerators are configurable |
| Confirm dialog itself becomes the foreground window and breaks the lock | Capture the foreground window info before showing the dialog, lock that info after confirmation |

---

## 5. M3 Overlay

Goal: every crack has sound and a visible strike with the message on screen, plus toasts for all user-facing errors and state changes. The overlay never steals focus.

Entry criteria: M2 Done.

| Task | Description | Files | Depends on | Deliverable | Verification | Size | Satisfies | Status |
|---|---|---|---|---|---|---|---|---|
| M3-T1 | Overlay window in `src/main/overlay-window.js`: options per docs/ARCHITECTURE.md 2.1 (transparent, frameless, `alwaysOnTop` level `screen-saver`, `focusable: false`, `skipTaskbar: true`, `setIgnoreMouseEvents(true, { forward: true })` by default, whip mode flips it in M4), sized to the primary display bounds, hidden until first use, `hasShadow: false`. `src/preload.js` exposes `window.whipzap` with `on(channel, fn)`, `send(channel, payload)`, `soundUrl(file)` restricted to the channels in docs/ARCHITECTURE.md section 3 (`overlay:strike`, `overlay:spawnWhip`, `overlay:dropWhip`, `overlay:toast`, `overlay:playSound`, `overlay:setReduceMotion` inbound; `overlay:cracked`, `overlay:dropped`, `overlay:clicked`, `overlay:animationIdle`, `overlay:ready` outbound). `whipzap-asset://` protocol handler for sounds. | src/main/app.js, src/main/overlay-window.js, src/preload.js, src/overlay/overlay.html | M2 | Overlay shell | `npm run selftest` reaches the strike step; overlay visible on the primary display; typing still lands in the target while the overlay is shown | M | FR-36, FR-37, FR-39, AC-04-2 | Done 2026-10-21 (`npm run selftest` exit 0; typed text landed in the fixture while the overlay was visible) |
| M3-T2 | `src/overlay/strike.js`: strike flash per docs/UX.md 6.1 and 6.2: a diagonal lash stroke animates across the screen in 180 ms, tip burst, edge pulse, fade by 600 ms, the message in large bold text centered for 1200 ms with 200 ms fade, tier underline, `/btw` prefix line in btw mode, then the overlay hides if nothing else is active. Canvas based, requestAnimationFrame, no DOM thrash. | src/overlay/strike.js, src/overlay/overlay.js | M3-T1 | Strike visual | Manual W-03 visual portion; selftest passes | M | FR-28 | Done 2026-10-21 (strike flash, outlined message, tier underline confirmed by desktopCapturer screenshot over VS Code) |
| M3-T3 | `src/overlay/audio.js`: preloads `assets/sounds/crack-1.wav` to `crack-3.wav` via `whipzap-asset://`, plays the seeded pick at `config.sound.volume`, honors mute (main decides). `scripts/prepare-sounds.mjs` trims and normalises the BigSoundBank CC0 sources from `assets/sounds/_incoming/` into the three 16-bit mono 48 kHz WAVs (at most 0.8 s, transient within 40 ms, peak -1 dBFS). `assets/CREDITS.md` lists each file with source URL, author (Joseph Sardin, BigSoundBank.com), licence "CC0 (public domain): Free and royalty-free", and the edits made. No sound file from OpenWhip. | src/overlay/audio.js, scripts/prepare-sounds.mjs, assets/sounds/crack-1.wav, crack-2.wav, crack-3.wav, assets/CREDITS.md | M3-T1 | Sound | Manual: crack plays sound; Mute stops it (W-12); CREDITS.md complete | S | FR-27, FR-40, FR-41, NFR-09, D-7 | Done 2026-10-21 (WAVs prepared, CREDITS.md complete; playback produced no renderer error, audibility not checked by a human; W-12 not run) |
| M3-T4 | Toasts: `src/main/toast.js` sends `overlay:toast { text, ms }`; `src/overlay/toast.js` renders the bottom-centre pill per docs/UX.md section 8. Every string in the UX section 8 table verbatim, with its duration. | src/main/toast.js, src/overlay/toast.js, src/overlay/overlay.js | M3-T1 | Toasts | Manual: W-06 No, W-08, W-14, W-20 show the toast text exactly | S | US-10, FR-14 | Done 2026-10-21 (`src/main/toast.js` folded into app.js; toasts seen on screenshots: Target locked, WhipZap self-test; not every string reached) |
| M3-T5 | Replace M2 stubs: wire real audio, overlay strike, toast into `crack.js` dependencies and `app.js`. macOS Accessibility dialog per docs/UX.md 1.3 (shown on the first lock attempt when `checkPermissions` reports not ok or the helper returns code 2; `Open Settings` calls `platform.openAccessibilitySettings()`). Linux start dialogs per docs/UX.md 1.4 when `isSupported` fails. | src/main/app.js | M3-T2, M3-T3, M3-T4 | Integrated | W-03, W-12 pass fully; selftest exits 0 | S | US-09, US-12 | Done 2026-10-21 (macOS and Linux dialogs UNVERIFIED-ON-HARDWARE) |
| M3-T6 | Selftest mode `--whipzap-selftest` per TESTING section 4. | src/main/app.js | M3-T2 | `npm run selftest` | Exits 0 in under 5 s on Windows | S | TESTING L3 | Done 2026-10-21 (ready deadline raised to 15 s; cold start can take 5 s) |

Definition of done M3:

- [ ] Crack on Windows: sound, strike with message, typed text, all three every time across 10 consecutive cracks.
- [ ] Overlay never takes focus: typed text lands in the target with the overlay visible.
- [ ] Every toast in the UX toast table is reachable and shows the exact text.
- [ ] `npm run selftest` exits 0.
- [ ] `assets/CREDITS.md` lists every sound with a CC0 source.

Risks and mitigation:

| Risk | Mitigation |
|---|---|
| Transparent always-on-top window steals focus on show | `focusable: false`, `showInactive()`, never call `focus()`; verify by typing after show |
| Overlay covers the taskbar or blocks clicks | `setIgnoreMouseEvents(true)` outside whip mode; test clicking the taskbar while a strike plays |
| Audio autoplay blocked in the renderer | Play from a user-gesture-free context is allowed in Electron by default; if blocked, set `autoplayPolicy: "no-user-gesture-required"` in webPreferences |
| Strike flash on a bright screen is barely visible | Use a dark vignette plus high-contrast text with outline; tune with screenshots |

---

## 6. M4 Whip mode

Goal: arm a rope that follows the mouse, crack it with a flick, drop it with a click or the hotkey.

Entry criteria: M3 Done.

| Task | Description | Files | Depends on | Deliverable | Verification | Size | Satisfies | Status |
|---|---|---|---|---|---|---|---|---|
| M4-T1 | `src/overlay/rope.js`: Verlet rope written from first principles per docs/ARCHITECTURE.md 7.1: 28 segments, segment length `min(w,h)/45`, fixed 120 Hz substeps accumulated from frame deltas, 12 constraint iterations, gravity, damping, bend limits, wall clamps, pinned head at the cursor. Pure functions `createRope(opts)`, `step(rope, mouse, dtMs)`, `draw(rope, ctx)`, `tipSpeed(rope, dtMs)` so it is unit-testable in node with a stub ctx. | src/overlay/rope.js, test/rope.test.js | M3 | Physics | Unit tests: rope length conserved within 2 percent after 1000 steps; tip at rest hangs below head; a sudden head jump of 400 px produces tip speed above the crack threshold within 10 steps; same input sequence gives same output (determinism); identical result for dt 8 ms and dt 16 ms inputs covering the same wall time (refresh-rate independence within tolerance) | M | FR-15, AC-04-6, D-3 | Done 2026-10-21 (7 tests; tuned: damping 0.975, gravity 0.02 x segLen, crack factor 3.5) |
| M4-T2 | Rendering in `overlay.js`: draw the rope per docs/UX.md section 7 (dark core over pale halo, taper, handle at the cursor), hide the system cursor over the overlay. 60 fps on the dev machine. | src/overlay/overlay.js | M4-T1 | Visible rope | Manual: smooth motion, no stutter, no trail artifacts | S | AC-04-1 | Done 2026-10-21 (rope visible on e2e screenshot; fps not measured) |
| M4-T3 | Crack detection: tip speed above the threshold in docs/ARCHITECTURE.md 7.1 (per fixed step, refresh-rate independent) after a 400 ms grace period, 250 ms cooldown, tip burst, then `overlay:cracked { tipSpeed }` to main which runs the normal crack routine with `source: 'whip'`. Threshold tuned so a normal wrist flick cracks and slow waving does not; the tuned value is recorded in docs/ARCHITECTURE.md 7.1 (not user-configurable in v1). | src/overlay/overlay.js, src/main/app.js | M4-T1 | Flick to crack | Manual: 10 flicks produce 10 cracks; 10 seconds of slow circles produce 0 | S | FR-15, AC-04-3 | Done 2026-10-21 (synthetic flicks crack; cooldown 600 ms; `whip.crackFactor` and `whip.cooldownMs` in config; human feel tuning still owed) |
| M4-T4 | Arm and drop: hotkey or tray Arm whip locks the target from the foreground window first, then sends `overlay:spawnWhip`, main sets `setIgnoreMouseEvents(false)`, cursor hidden, rope spawns at the cursor. Any mouse button down on the overlay (`overlay:clicked`), the arm hotkey again, or unchecking `Arm whip` sends `overlay:dropWhip`: rope falls under triple gravity off screen, `overlay:dropped` is sent, then mouse events are ignored again and the overlay hides. No Esc handling anywhere (docs/UX.md 7.6). Auto mode pauses while armed and resumes on drop (hook for M5). | src/main/app.js, src/main/tray.js, src/main/hotkeys.js, src/overlay/overlay.js | M4-T2, M4-T3 | Whip mode | Manual W-09 passes; the window that had focus before arming is the locked target | M | AC-04-4, AC-04-5, FR-02, D-2 | Partial 2026-10-21: arm and hotkey drop verified; click-to-drop not verified (D-15 fix applied, re-run owed); lost target now drops the whip (D-14) |
| M4-T5 | Selftest extended with spawn and drop (TESTING section 4 steps 3). | src/main/app.js | M4-T4 | Selftest covers rope | `npm run selftest` exits 0 | S | TESTING L3 | Done 2026-10-21 |

Definition of done M4:

- [ ] W-09 passes on Windows.
- [ ] Rope unit tests pass, including refresh-rate independence.
- [ ] Crack during whip mode uses the same routine and delivery mode as hotkey cracks.
- [ ] Dropping always restores the cursor and click-through, including when the target has closed.

Risks and mitigation:

| Risk | Mitigation |
|---|---|
| Mouse events do not reach the overlay on Windows when the window is fully transparent | Paint a near-invisible full-window fill (alpha about 0.01) so the window is hit-testable, as transparent windows with nothing painted pass clicks through |
| Physics feels different at 60 Hz vs 144 Hz (OpenWhip issue #61) | Fixed-timestep substeps with accumulator; unit test for dt independence |
| User is stuck with a hidden cursor if the overlay crashes | Main process restores `setIgnoreMouseEvents(true)` and hides the overlay on `render-process-gone`; cursor hiding is CSS on the overlay only, so a hidden window restores the cursor |
| Overlay is on the primary display only, cursor on another display | Documented v1 limitation; rope spawns at the cursor clamped to the primary display and a toast says "Whip mode works on the primary display" when the cursor is elsewhere |

---

## 7. M5 Auto mode

Goal: toggle auto mode and receive cracks at jittered intervals with escalating tiers until the cap.

Entry criteria: M2 Done. Toasts require M3-T4; until then log to console.

| Task | Description | Files | Depends on | Deliverable | Verification | Size | Satisfies | Status |
|---|---|---|---|---|---|---|---|---|
| M5-T1 | `src/main/prng.js`: `mulberry32(seed)` returning `rng()` in [0, 1) and `createRng(seed)` returning `{ next() }`. | src/main/prng.js, test/prng.test.js | none | Seedable PRNG | Unit: same seed same first 100 values; values in [0, 1); distribution roughly uniform over 10000 draws (each decile between 8 and 12 percent) | S | FR-19, FR-23, D-4 | Done 2026-10-21 (5 tests) |
| M5-T2 | `src/main/scheduler.js`: `createScheduler({ config, clock, rng, onFire, onStop })` with `start`, `stop`, `pause`, `resume`, `isRunning`, `state`. Interval = clamp(base plus uniform jitter in [-jitter, +jitter], min 20 s). Tiers via `tierForCount`. Cap stops and calls `onStop({ reason: "cap" })` once. | src/main/scheduler.js, test/scheduler.test.js, test/fakes/fakeClock.js | M5-T1 | Scheduler | SCH-01 to SCH-14 pass (replace any `test.todo` from M2) | M | FR-18 to FR-23, US-06 | Done 2026-10-21 (16 tests) |
| M5-T3 | Wire into `app.js`: tray Auto mode checkbox and `toggleAuto` hotkey start and stop the scheduler; `onFire` calls `crack({ source: "auto" })`; `onStop({ reason: "cap" })` shows toast "Auto session cap reached (<N>)" and unchecks the tray item; start without a locked target locks the foreground window first and, if that fails or is declined, shows "No target locked" and does not start; whip mode arm pauses, drop resumes; stopping resets `autoCount`; target lost during a crack turns auto off with "Auto mode off". | src/main/app.js, src/main/tray.js, src/main/hotkeys.js | M5-T2 | Auto mode | Manual W-10, W-11 pass | M | FR-18, FR-21, FR-22, US-06 | Done 2026-10-21 (e2e: fires at +20 s and +40 s with base 20 and jitter 0, cap toast, auto off on lost target) |
| M5-T4 | Decided: while auto mode is on, every crack from any source (hotkey, tray, whip) increments `autoCount` and uses `tierForCount(autoCount)` (docs/ARCHITECTURE.md 4.6). Verify the behaviour. | src/main/app.js, src/main/crack.js | M5-T3 | Consistent escalation | Manual: enable auto, press hotkey 5 times, next auto crack is medium tier (visible from the message pool) | S | FR-20, FR-25 | Done 2026-10-21 by code (`crack.js` tier rule, CRK-09); the 5-hotkey manual check not run |

Definition of done M5:

- [ ] SCH-01 to SCH-14 and PRNG tests pass.
- [ ] W-10 and W-11 pass on Windows.
- [ ] Auto mode never fires more often than every 20 seconds, never fires while whip mode is armed, and stops exactly at the cap.

Risks and mitigation:

| Risk | Mitigation |
|---|---|
| User forgets auto mode on and floods the agent | Session cap default 20, toast on each fire, tray checkbox visible, auto turns off on app quit and does not persist across restarts |
| Timer drifts when the machine sleeps | Use `setTimeout` relative to resume; on `powerMonitor` `resume` event reschedule from now |
| Auto crack lands while the user is typing in the terminal | Documented behavior, non-interrupting by design; the message is appended to whatever is in the input. Future option: detect recent user keyboard activity and defer [FUTURE] |

---

## 8. M6 Release readiness

Goal: v0.1.0 is installable from a clone or a packed tarball, documented, smoke-tested on Windows, and ready for the owner to approve publishing.

Entry criteria: M0 to M5 Done.

| Task | Description | Files | Depends on | Deliverable | Verification | Size | Satisfies | Status |
|---|---|---|---|---|---|---|---|---|
| M6-T1 | Full README: pitch, a GIF or screenshot placeholder, what a crack does and does not do (never interrupts, Safe queues, /btw side question), install (`npm install -g whipzap`, run `whipzap`, or clone and `npm start`), hotkeys table, tray menu, config reference with every key and default (docs/UX.md section 12), platform support table with WSL2 note and Wayland exclusion, macOS Accessibility steps, Linux `xdotool` install, troubleshooting (hotkey conflict, wrong window, no sound), FAQ ("does this make the agent faster?" answer: no, it is a joke, and it never interrupts), credits (inspired by OpenWhip, no code shared; sounds by Joseph Sardin, BigSoundBank.com, CC0), license. | README.md | M5 | User docs | Reviewer reads README cold and can install and crack within 5 minutes on Windows | M | NFR-09, NFR-15, R-07 | Done 2026-10-21 (README rewritten; 5-minute cold install check not performed by a second reader) |
| M6-T2 | `CHANGELOG.md` with a `0.1.0` section listing features and known limitations. `package.json` version confirmed `0.1.0`, `description`, `keywords`, `repository`, `bugs`, `homepage`, `license: MIT`, `author`. | CHANGELOG.md, package.json | M6-T1 | Release metadata | `npm pack --dry-run` lists only the whitelisted paths (R-05) | S | R-05, R-08 | Done 2026-10-21 for CHANGELOG and package metadata; `npm pack --dry-run` verified 2026-10-21 (51 files, 158 kB); `npm install -g ./whipzap-0.1.0.tgz` on this machine put `whipzap` on PATH, `whipzap --version` printed 0.1.0, `whipzap --help` printed usage, launcher started the app; uninstalled afterwards |
| M6-T3 | Execute the Windows smoke checklist 6.1 in full; record results in `docs/SMOKE-RESULTS.md` with OS build, Node, Electron, Claude Code versions, tester, date, pass or fail per item, and notes. Fix failures and re-run failed items. | docs/SMOKE-RESULTS.md | M6-T1 | Evidence | Every W item marked pass | M | R-02 | Partial 2026-10-21: docs/SMOKE-RESULTS.md records 6 pass, 2 partial, 12 not run; see section 11 |
| M6-T4 | macOS and Linux sections of `docs/SMOKE-RESULTS.md` created with status "Pending human run" and the exact commands a tester runs. Release notes text prepared with the untested disclaimer (R-03, R-04). | docs/SMOKE-RESULTS.md, CHANGELOG.md | M6-T3 | Honest status | Sections present | S | R-03, R-04 | Done 2026-10-21 |
| M6-T5 | Review CONTRIBUTING.md and SECURITY.md against the final code: commands correct, module map matches `src/`, helper-adding instructions accurate (helpers live in `src/main/helpers/`). Update docs/ARCHITECTURE.md, docs/UX.md, docs/TESTING.md where implementation diverged, extending the existing "Deviations" sections. | CONTRIBUTING.md, SECURITY.md, docs/*.md | M6-T3 | Accurate docs | Reviewer spot-checks 5 commands and 5 file paths; all correct | S | NFR-12 | Done 2026-10-21 (CONTRIBUTING, SECURITY, docs Deviations updated) |
| M6-T6 | Clean-room audit: reviewer reads `src/main/helpers/`, `src/overlay/rope.js`, `assets/` and confirms nothing is copied from OpenWhip. Record in `docs/SMOKE-RESULTS.md` under "Audit". | docs/SMOKE-RESULTS.md | M6-T5 | R-10 evidence | Statement signed with date | S | R-10, NFR-10 | Done 2026-10-21 (audit statement in docs/SMOKE-RESULTS.md) |
| M6-T7 | Release gate: all R-01 to R-10 checked in docs/TESTING.md section 9 with evidence links. Commit `chore(release): 0.1.0`. Do NOT tag, do NOT `npm publish`. Hand to owner with the summary required by the project brief. | docs/TESTING.md | M6-T1 to M6-T6 | Release candidate | Owner receives summary; tag and publish wait for explicit approval (R-11) | S | R-11 | Not started (lead: release gate, `chore(release): 0.1.0` commit, owner summary) |

Definition of done M6:

- [ ] R-01 to R-10 checked with evidence.
- [ ] Windows smoke checklist fully passed and recorded.
- [ ] macOS and Linux status honestly recorded as pending.
- [x] `npm pack` tarball installs globally (`npm install -g ./whipzap-0.1.0.tgz`, verified 2026-10-21 on the dev profile, not a clean profile) and `whipzap` runs.
- [ ] Owner handed the release summary. No public publish performed.

Risks and mitigation:

| Risk | Mitigation |
|---|---|
| Global install via npm triggers Electron binary download that fails behind proxies | Document `ELECTRON_MIRROR` env var in troubleshooting |
| Tarball missing helpers because `files` whitelist is wrong | R-05 dry run plus a real `npm install -g ./tgz` test on Windows |
| Owner expects macOS verified | Status is stated plainly in CHANGELOG and README; a macOS tester checklist is ready to run |

---

## 9. Status tracking

1. Each task row has a Status column with one of: `Not started`, `In progress`, `Done`, `Blocked`.
2. An agent sets `In progress` when it starts a task and `Done` only when the Verification column's evidence exists. Evidence is linked in the row or in a bullet directly under the milestone table: commit hash, CI run URL, path to a results file, or a one-line manual result with date.
3. `Blocked` rows must state the blocker and what unblocks it in a bullet under the table.
4. Milestone Status in section 1 is updated to `Done` only when the milestone's Definition of done checkboxes are all checked.
5. When implementation diverges from a doc, the agent updates the doc in the same commit and adds a line to the "Deviations" section of that doc. The roadmap is the source of truth for sequencing; the architecture doc is the source of truth for design.
6. Tasks marked UNVERIFIED-ON-HARDWARE are `Done` from the implementation standpoint but keep the marker in the row until a human checklist run is recorded in `docs/SMOKE-RESULTS.md`.

---

## 10. Sequencing and parallelism

File ownership prevents merge conflicts. An agent owns the files listed for its task and must not edit files owned by a concurrent task. Shared files (`src/main/app.js`, `src/main/tray.js`, `src/main/hotkeys.js`, `src/overlay/overlay.js`) are edited by one agent at a time; the task that owns them in a given wave is marked.

| Wave | Concurrent tasks | Shared-file owner in this wave |
|---|---|---|
| 0a | M0-T2, M0-T3 | none |
| 0b | M0-T4, M0-T5, M0-T6 (after T2) | none |
| 0c | M0-T7, M0-T8 | app.js: M0-T7 |
| 1a | M1-T1 | none |
| 1b | M1-T5, M1-T6 (two agents: macOS and Linux helpers, each owning its own helper and platform file; M1-T2 and M1-T3 already done) | none |
| 1c | M1-T4 (test file), then M1-T7 (already done; extend if new findings) | none |
| 2a | M2-T1, M2-T2, M2-T3, M2-T4 (four agents, disjoint files) | none |
| 2b | M2-T5 | none |
| 2c | M2-T6, M2-T7 (two agents) | hotkeys.js: M2-T6, tray.js: M2-T7 |
| 2d | M2-T8, M2-T9 | app.js: M2-T8 |
| 3a | M3-T1 | app.js, preload.js, overlay.html: M3-T1 |
| 3b | M3-T2, M3-T3, M3-T4 (three agents) | overlay.js: M3-T2 writes strike wiring, M3-T4 appends toast rendering in a separate file `src/overlay/toast.js` imported by overlay.js to avoid conflicts |
| 3c | M3-T5, M3-T6 | app.js: M3-T5 then M3-T6 sequentially |
| 4 and 5 in parallel | M4-T1 and M5-T1, M5-T2 concurrently (disjoint files). M4-T2 to M4-T5 sequential after M4-T1. M5-T3, M5-T4 after M4-T4 because both touch app.js, tray.js, hotkeys.js | app.js: M4 tasks first, then M5-T3 |
| 6 | M6-T1, M6-T2 concurrent; M6-T3 after; M6-T4, M6-T5, M6-T6 concurrent; M6-T7 last | none |

Rules for concurrent agents:

1. Run `npm test` and `npm run lint` before reporting a task Done.
2. Never reformat files you do not own.
3. If a task needs a change in a shared file it does not own, record the needed change in a bullet under the milestone table as "Integration note for <owner task>" and let the owner apply it.
4. Each task is one commit or a small series with conventional messages: `feat(scope):`, `fix(scope):`, `test(scope):`, `docs(scope):`, `chore(scope):`. Scope is the module name.

---

## 11. Remaining before publish

Owed items, in priority order. None of them changes the architecture.

1. Human run of the Windows checklist items marked "not run" in docs/SMOKE-RESULTS.md: W-04, W-05 (live Claude Code, Safe and /btw), W-06, W-07, W-12 to W-16, W-18 to W-20.
2. Click-to-drop in whip mode (W-09) after the D-15 change; if a click still does not reach the overlay, keep the hotkey and tray as the documented drop paths and record it.
3. Crack feel on a real mouse: adjust the `whip.crackFactor` default so a wrist flick cracks and slow waving does not; record the chosen value in docs/ARCHITECTURE.md 7.1 and docs/UX.md 7.
4. Done 2026-10-21: `npm pack --dry-run` whitelist check (R-05) and a real `npm install -g ./whipzap-0.1.0.tgz` on Windows (dev profile; a clean-profile run is still worth doing).
5. Done 2026-10-21: pushed to GitHub, CI matrix green (https://github.com/Khumoyun1307/whipzap/actions/runs/39728972289).
6. macOS checklist (M-01 to M-10) and Linux checklist (L-01 to L-05) by humans with hardware.
7. Then M6-T7: release gate, `chore(release): 0.1.0`, owner approval for tag and publish (R-11).

---

## 12. Post-v1 backlog [FUTURE]

Not scheduled. Listed so agents do not implement them by accident and so contributors can pick them up.

| Item | Note |
|---|---|
| Camera gesture whipping | Original vision item, excluded from v1 by D-9 |
| Agent-state detection via optional Claude Code hook writing a status file | Would let auto mode whip only while the agent is busy (D-4 alternative) |
| Themed message packs selectable from the tray (pirate, drill sergeant, passive-aggressive manager) | D-7 alternative; pack format already supports multiple files |
| Per-agent profiles (Codex, opencode, Gemini CLI) with host-specific side channels | D-6 |
| Wayland support via `ydotool` or `wtype` | Helper contract allows a fourth adapter |
| Packaged installers `.exe`, `.dmg`, `.AppImage` on GitHub Releases, code signing | D-8 |
| Multi-monitor overlay, one window per display | OpenWhip issues #26, #53 |
| Defer auto cracks while the user is actively typing | M5 risk table |
| Whip counter and statistics in the tray | Fork feature seen in VibeWhip |
| Configurable sound packs and volume per sound | D-7 |
| A settings window instead of editing JSON | D-8 alternative |
| Localization of built-in messages | Pack format can carry a locale field |
| Any form of interrupting delivery | Rejected by D-1. Listed here only so it is never reintroduced silently |

---

## Deviations (2026-10-21)

1. M1 Windows tasks (M1-T2, M1-T3, M1-T7) ran before M0 and are Done; M1-T1 code exists (test pending); M1-T4 fixture exists, test file pending. Reason: the Windows focus-and-type path was the largest unknown and was retired first.
2. Helper paths are `src/main/helpers/<os>/` with names `win/worker.ps1`, `mac/helper.sh`, `linux/helper.sh`. Reason: shipped inside `src/`.
3. Windows helper is a long-lived JSON-lines worker (D-12); no simulated Alt (D-13). Reason: 4.8 s cold start; Alt activates menu bars.
4. Adapter contract and helper codes follow docs/ARCHITECTURE.md 4.11 and 6.1 (codes 1 to 5; no `listWindows`, `windowExists`, `pressEnter`). Reason: match the verified implementation.
5. `electron` is a runtime dependency (M0-T2). Reason: `bin/whipzap.js` needs the binary after a global install.
6. Sounds are WAV from BigSoundBank CC0 sources prepared by `scripts/prepare-sounds.mjs` (M3-T3). Reason: no encoder on the dev machine.
7. Toast strings and dialog copy are docs/UX.md verbatim (M3-T4, M5-T3). IPC channel names are docs/ARCHITECTURE.md section 3 (M3-T1, M4-T4).
8. Tray `Delivery` is a submenu with two radio items (M2-T7). Tray lock uses `platform.lastForeground` on Windows (M2-T7 risk table).
9. M5-T4 is decided, not assumed: any crack while auto is on counts toward the auto session.
10. "Satisfies" column now uses PRD IDs.
11. Task statuses updated 2026-10-21 after implementation; M0 to M3 and M5 Done, M4 partial (click-to-drop), M6 in progress. Reason: implementation ran the helper, core, and overlay work in parallel rather than in milestone order.
12. Lock rule tightened (D-14): whip-mode and auto cracks never lock; a lost target drops the whip. Reason: incident recorded in docs/SMOKE-RESULTS.md.
13. Overlay becomes focusable only while the whip is armed (D-15). Reason: mouse buttons did not reach the non-activatable window on Windows.
14. Rope constants and `config.whip` keys replace the 7.1 assumptions (M4-T1, M4-T3). Reason: the spec values made the rope crack on its own.
15. `src/main/toast.js` does not exist; the toast function lives in app.js (M3-T4). Reason: three lines.
