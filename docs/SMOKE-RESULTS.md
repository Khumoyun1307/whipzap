# WhipZap Smoke Results

Status: v0.1.0 release candidate
Last updated: 2026-10-21
Owner: Technical lead

Evidence for the manual checklists in `docs/TESTING.md` section 6. Only what this session actually ran is marked pass. Everything else is marked honestly.

## Windows 11 (run 2026-10-21)

Environment: Windows 11 build 26200, Node 24.13.0, Electron 45.0.0, Windows PowerShell 5.1, single 1536x864 display at 125 percent scale. Tester: the implementing session (automated input, not a human). Claude Code: not used as a target in this run.

Automated evidence used below: `npm test` (13 files, 144 tests pass), `npm run lint`, `npm run lint:keys`, `npm run selftest` (exit 0, zero renderer errors), `npm run test:win` (PASS), `test/helpers/win-e2e.ps1` (full run and a whip-only run), desktopCapturer screenshots in `test/helpers/_e2e-shots/`.

| Item | Result | Evidence and notes |
|---|---|---|
| W-01 Launch, tray within 3 s | partial | App reports ready 1 to 5 s after launch; hotkeys and tray handlers work. Tray icon visibility and "no console window" not inspected by a human. |
| W-02 Tray menu order | pass (unit) | `test/tray.test.js` asserts the exact order and labels; not clicked by a human. |
| W-03 Hotkey crack into a terminal | pass | e2e: Ctrl+Alt+W locked the focused fixture ("Target locked: WhipZap typing fixture"), strike flash and message confirmed by screenshot, "FASTER!" plus Enter typed. Separately, the helper typed `echo whipzap-terminal-test FASTER! ünïcödé` plus Enter into Windows Terminal (cmd) and it executed, 425 ms. |
| W-04 Safe crack while Claude Code is busy | not run | No live Claude Code target in this run. |
| W-05 /btw crack | not run | Delivery formatting covered by `test/delivery.test.js` (DLV-02); not observed in Claude Code. |
| W-06 Wrong window, Cancel | not run | Sanity rules covered by `test/target.test.js`; the native dialog was not exercised. |
| W-07 Wrong window, Whip it | not run | |
| W-08 Target closed | pass | e2e: fixture closed during auto mode: toast "Target window closed", then "Auto mode off", lock cleared, nothing typed. |
| W-09 Whip mode | partial | Arm via Ctrl+Alt+Shift+W: rope visible on screenshot, cursor hidden over the overlay. Synthetic flicks cracked (tipSpeed 48 to 156 px/step) and typed medium-tier lines into the fixture. Drop via the arm hotkey: pass. Drop by clicking: not verified (no mousedown reached the overlay in the recorded runs; the fix in this build makes the overlay focusable only while armed and could not be re-run). Crack feel on a real mouse: not tuned by a human. |
| W-10 Auto mode on, cracks, off | pass | e2e with `baseIntervalSec` 20, `jitterSec` 0: toast "Auto mode on", cracks at exactly +20 s and +40 s. Escalation to medium after the 5th crack not reached (cap 2). |
| W-11 Session cap | pass | Cap 2: exactly 2 auto cracks, then toast "Auto session cap reached (2)". |
| W-12 Mute | not run | |
| W-13 Open config | not run | |
| W-14 Invalid config | not run | Covered by `test/config.test.js` CFG-03; toast not observed. |
| W-15 VS Code extension input | not run | Deliberately not targeted: a live Claude Code session was running in VS Code on the test machine. |
| W-16 WSL2 | not run | |
| W-17 Unicode | pass | `npm run test:win`: exact round trip of `whipzap typing test: FASTER! WORK HARDER! ünïcödé ✓ 日本 🐢 end` plus Enter into the WinForms fixture, typing 354 ms, focus switched from a Chrome window to the fixture. |
| W-18 Quit from tray | not run | Test runs ended the process with taskkill. |
| W-19 Second instance | not run | |
| W-20 Hotkey conflict | not run | |

Additional measurements: Windows helper worker cold start 4.8 s (PowerShell plus Add-Type, paid once at launch); warm focus-and-type requests 300 to 560 ms end to end including the 120 ms settle inside the helper; a background Notepad window was brought to the foreground through the AttachThreadInput path.

## macOS (pending human run)

Status: UNVERIFIED-ON-HARDWARE. Adapter and helper are unit-tested with a fake `execFile` only.

A tester runs, on macOS 14 or later with Node 20:

```
git clone https://github.com/Khumoyun1307/whipzap.git && cd whipzap && npm ci
npm test && npm run lint && npm run lint:keys
npm run selftest
node test/helpers/run-helper.mjs countdown 5      # click Terminal during the countdown; expect its pid:<n> id
node test/helpers/run-helper.mjs type pid:<n> "whipzap mac test"   # expect the text plus Enter in Terminal
npm start
```

Then execute M-01 to M-10 from `docs/TESTING.md` section 6.2 and record each result here with the macOS version and which app name appeared in the Accessibility list.

## Linux X11 (pending human run)

Status: UNVERIFIED-ON-HARDWARE.

A tester runs, on Ubuntu 22.04 or later in an X11 session with `xdotool` installed:

```
git clone https://github.com/Khumoyun1307/whipzap.git && cd whipzap && npm ci
npm test && npm run lint && npm run lint:keys
sh -n src/main/helpers/linux/helper.sh
npm run selftest
node test/helpers/run-helper.mjs countdown 5      # click a terminal during the countdown
node test/helpers/run-helper.mjs type <id> "whipzap linux test"
npm start
```

Then execute L-01 to L-05 from `docs/TESTING.md` section 6.3 and record each result here, including the Wayland case.

## Audit (R-10, clean room)

Reviewer: the implementing session, 2026-10-21. Read in full: `src/main/helpers/win/worker.ps1`, `src/main/helpers/mac/helper.sh`, `src/main/helpers/linux/helper.sh`, `src/overlay/rope.js`, `assets/CREDITS.md`, `assets/messages/default.json`, and listed `assets/icons/` and `assets/sounds/`. Statement: nothing in this repository is copied from OpenWhip or its forks. The rope is a Verlet simulation written from the parameters in `docs/ARCHITECTURE.md` 7.1; the helpers use Win32, AppleScript, and xdotool APIs directly; sounds are BigSoundBank CC0 samples prepared by `scripts/prepare-sounds.mjs`; icons are drawn by `scripts/gen-icons.ps1`; messages were written for this project.

## Incidents during testing

Two unintended typings into the operator's own VS Code window happened while the end-to-end script was being developed. Both are recorded because they shaped the product.

1. **22:10:40 local.** The fixture process had been started with a hidden console and never became the foreground window. The script pressed the crack hotkey anyway; WhipZap, working as designed, locked the focused window (VS Code, which matches the allow list) and typed "FASTER!" plus Enter into it. Cause: the test harness. Fix: `win-e2e.ps1` now refuses to press any hotkey unless the fixture is verified as the foreground window through the app's own helper.
2. **22:25:48 to 22:25:54 local.** The fixture closed while whip mode was armed. WhipZap reported "Target window closed", but the next flick had no target and the crack path locked the current foreground window (VS Code again) and typed six medium-tier taunts into it. Cause: a product flaw. Fix: decision D-14. Only the crack hotkey, Crack now, Arm whip, Auto mode, and Lock target may lock a target; whip-mode and auto cracks never lock, and a lost target drops the whip and turns auto mode off. The fixture now outlives every phase of the script.

No other window received text in any run.
