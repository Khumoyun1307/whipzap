# Changelog

All notable changes to WhipZap are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses semantic versioning.

## 0.1.0 - 2026-10-21

Release candidate. Not tagged and not published to npm; both wait for the owner's approval.

### Added

- Tray app for Windows, macOS, and Linux with a transparent always-on-top overlay on the primary display.
- Crack routine shared by every trigger: whip-crack sound, strike flash with the message in large text, then the message typed into the locked window followed by Enter. Nothing but printable text and Enter is ever sent.
- Target lock: the window focused when you press the crack hotkey or use the tray is locked; windows that do not look like a terminal or editor need a confirmation. Only the crack hotkey, Crack now, Arm whip, Auto mode, and Lock target can lock a target.
- Delivery modes: Safe (queued message) and /btw (side question, Claude Code only).
- Global hotkeys: Ctrl+Alt+W crack, Ctrl+Alt+Shift+W arm or drop the whip, Ctrl+Alt+A auto mode (Cmd on macOS). Configurable.
- Whip mode: a Verlet rope follows the cursor; a fast flick cracks it. Crack sensitivity and cooldown are configurable (`whip.crackFactor`, `whip.cooldownMs`).
- Auto mode: seeded, jittered timer (default 180 s with 90 s jitter, minimum 20 s) with escalating tiers (mild, medium, spicy) and a session cap (default 20).
- Built-in pack of 30 taunts in three tiers, user extras and replacement through the config file.
- Three CC0 whip-crack samples (BigSoundBank, Joseph Sardin), mute and volume.
- JSON config with live reload, `.bak` on invalid files, and `WHIPZAP_USER_DATA` to relocate it.
- Platform helpers: a long-lived PowerShell worker on Windows (SendInput Unicode, AttachThreadInput focus), `osascript` on macOS, `xdotool` on Linux X11.
- Self-test mode (`npm run selftest`), Windows typing integration test (`npm run test:win`), Windows end-to-end script (`test/helpers/win-e2e.ps1`), 144 unit tests, ESLint, and a forbidden-keys guard (`npm run lint:keys`).

### Known limitations

- macOS and Linux helpers are untested on real hardware. The macOS Accessibility flow is verified by code review only.
- Clicking the overlay to drop the whip is not yet verified on Windows; the arm hotkey and the tray item drop it. A fix (the overlay becomes focusable only while armed) is in this build and awaits a human check.
- Whip crack sensitivity was tuned against synthetic mouse input, not a human wrist. Adjust `whip.crackFactor` if it cracks too easily or not at all.
- Primary display only. Wayland is not supported (sound and visuals only).
- Not yet run against a live Claude Code session in the smoke checklist (queueing and /btw behaviour are documented from Claude Code's reference, not observed here).
- Tray Quit, Open config, invalid-config toast, hotkey-conflict toast, and second-instance toast were implemented but not exercised in the recorded smoke run.
- The Electron download during `npm install` can be interrupted on slow networks; `node node_modules/electron/install.js` completes it.
