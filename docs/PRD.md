# WhipZap Product Requirements Document (PRD)

Status: Approved baseline for v0.1.0 / Last updated 2026-10-21 / Owner: project lead (Khumoyun1307)

Tagline: Whip your AI coding agent into shape.

Labels used on every requirement: [APPROVED] = decided in product discovery (see docs/DECISIONS.md), [ASSUMED] = lead's assumption, overridable by the owner, [FUTURE] = out of scope for v1.

---

## 1. Vision

WhipZap is a standalone, open-source desktop tray application for Windows, macOS, and Linux (X11) that lets a developer "whip" the AI coding agent running in their terminal or editor. A crack of the whip plays a whip-crack sound, flashes a strike across a transparent overlay, and types a short, funny taunt (for example `FASTER!`) into the window the user has locked as the target. Every whip is non-interrupting: it is either queued as a normal message to the agent or sent as a `/btw` side question. WhipZap can also crack automatically at jittered intervals while the user waits on a long task, with taunts that escalate the longer it runs. It is a joke that must be reliable: it never types into the wrong window, never interrupts or kills the agent, and installs with one command.

WhipZap is inspired by OpenWhip (see docs/RESEARCH.md) but is written independently. No OpenWhip code or assets are used (D-11).

## 2. Goals and non-goals

### 2.1 Goals

| ID | Goal | Label |
|----|------|-------|
| G-1 | Preserve the OpenWhip-style fun: sound, visual whip effects, humorous messages. | [APPROVED] |
| G-2 | Never disrupt the agent. All delivery modes are non-interrupting. | [APPROVED] |
| G-3 | Never type into the wrong window. Target lock plus sanity check. | [APPROVED] |
| G-4 | One-command install via npm. | [APPROVED] |
| G-5 | Occasional automatic whips with deterministic pseudo-random timing and escalating messages. | [APPROVED] |
| G-6 | Minimal, intuitive controls: a short tray menu and three hotkeys. | [APPROVED] |
| G-7 | Open-source appeal: MIT license, readable plain JavaScript, no compiled dependencies, CC0 assets. | [APPROVED] |
| G-8 | Work with both terminal CLIs and editor extension inputs (VS Code, Cursor). | [APPROVED] |

### 2.2 Non-goals (v1)

| ID | Non-goal | Label |
|----|----------|-------|
| NG-1 | Making the agent actually faster or better. WhipZap is entertainment. | [APPROVED] |
| NG-2 | Being a Claude Code plugin, hook, mod, or editor extension. | [APPROVED] |
| NG-3 | Interrupting, cancelling, or steering the agent's in-progress work. | [APPROVED] |
| NG-4 | Detecting whether the agent is working or idle. | [APPROVED] |
| NG-5 | Camera or gesture input. | [FUTURE] |
| NG-6 | Themed message packs, per-agent profiles, Wayland, installers, multi-monitor overlay, telemetry, auto-update, any network access. | [FUTURE] or excluded, see section 9 |

## 3. Personas

| ID | Persona | Context | Needs |
|----|---------|---------|-------|
| P-1 | Terminal dev | Runs Claude Code (or Codex, opencode, Gemini CLI) in Windows Terminal, iTerm2, or a Linux terminal. Waits on long agentic tasks. | A one-keypress crack while hands stay on the keyboard. Auto mode while waiting. Confidence nothing breaks the agent. |
| P-2 | Editor dev | Uses the Claude Code VS Code or Cursor extension chat input. | Whips land in the extension input, not in the code editor or a random pane. |
| P-3 | Streamer / meme maker | Records or streams coding sessions. | The mouse-swing whip with a visible rope, loud crack, big on-screen message. Easy to show off. |

## 4. User stories and acceptance criteria

Every acceptance criterion is observable and testable. Timing bounds are measured on a mid-range 2022 laptop with no other heavy load.

### US-01 Install and first run [APPROVED]

As a developer, I want to install WhipZap with one command and have it start as a tray app, so that setup takes under a minute.

- AC-01-1: `npm install -g whipzap` followed by `whipzap` starts the app with no further prompts on Windows and Linux. On macOS, the first run shows the Accessibility onboarding (US-09).
- AC-01-2: Within 3 s of launch a tray icon appears and no visible window is created. No terminal output beyond one line `WhipZap started. Look for the whip icon in your tray.`
- AC-01-3: `npx whipzap` behaves identically to the global install.
- AC-01-4: Running `whipzap` while an instance is already running exits with exit code 0 and the existing instance shows the toast `WhipZap is already running`; the existing instance is otherwise unaffected.
- AC-01-5: On first run a config file is created at the platform config path (section 6.6) with all defaults.

### US-02 Lock a target window [APPROVED]

As a developer, I want WhipZap to lock onto the window I was using when I armed it, so that whips never land anywhere else.

- AC-02-1: Pressing the arm-whip hotkey or the instant-crack hotkey while no target is locked records the currently focused window as the target (window handle plus process name plus title at lock time).
- AC-02-2: Tray item `Lock target` records the window that was in the foreground immediately before the tray menu opened.
- AC-02-3: If the focused window's process name or title matches an entry in `target.allowPatterns`, the lock is silent and a toast shows `Target locked: <title>` (title truncated to 60 characters).
- AC-02-4: If it does not match, a native confirmation dialog with the title and body from docs/UX.md section 4 (`Whip this window?`) and buttons `Whip it` / `Cancel` appears once. `Whip it` locks and shows the toast; `Cancel` leaves no target locked and shows no further dialog for that window until the user re-arms.
- AC-02-5: The confirmation for a given window handle is asked at most once per app session.
- AC-02-6: Locking a new target replaces the previous one.
- AC-02-7: WhipZap's own overlay window and its own dialogs are never accepted as a target.

### US-03 Instant crack via hotkey [APPROVED]

As a developer, I want a global hotkey that cracks the whip immediately, so that I can whip without touching the mouse.

- AC-03-1: Pressing the crack hotkey (default `CommandOrControl+Alt+W`) with a target locked runs the full crack routine (section 6.3): sound, strike visual with the message, re-focus target, type the delivery text, Enter.
- AC-03-2: The typed text is exactly the message shown on the overlay (plus the `/btw ` prefix in btw mode).
- AC-03-3: Keystrokes begin within 500 ms of the hotkey press when the target window is already in the foreground, and within 800 ms when it must be re-focused.
- AC-03-4: The hotkey works while any other application has focus, including the target.
- AC-03-5: Two crack hotkey presses within 400 ms produce exactly one crack (debounce).
- AC-03-6: After the crack, focus remains on the target window.

### US-04 Whip mode via mouse [APPROVED]

As a streamer, I want to swing a physics whip with my mouse and crack it by flicking, so that whipping looks and feels real.

- AC-04-1: Pressing the arm-whip hotkey (default `CommandOrControl+Alt+Shift+W`) or tray `Arm whip` shows a transparent, borderless, always-on-top, full-primary-display overlay with a rope whose handle follows the cursor. The system cursor is hidden over the overlay.
- AC-04-2: Keyboard focus returns to the target window within 300 ms of arming, so the user can keep typing while the whip is visible. On platforms where focus return fails, the overlay never takes keyboard focus (non-focusable window).
- AC-04-3: Moving the cursor so the rope tip exceeds the configured crack speed triggers one crack routine. Cracks are rate-limited to one per 250 ms. No crack can happen within the first 350 ms after arming.
- AC-04-4: Pressing the arm-whip hotkey again, selecting tray `Arm whip` again, or clicking anywhere on the overlay drops the whip: the rope falls off-screen within 1 s and the overlay hides.
- AC-04-5: While whip mode is active, the overlay passes no keyboard input to the target and intercepts only mouse input over the overlay.
- AC-04-6: The rope renders at the display refresh rate with crack detection independent of refresh rate (speed measured per second, not per frame).

### US-05 Choose delivery mode: Safe or /btw [APPROVED]

As a developer, I want to choose between queuing a normal message and sending a side question, so that I control how the agent receives the whip.

- AC-05-1: Tray `Delivery` is a submenu offering exactly two radio items: `Safe (queued message)` and `/btw (side question)`. Default is `Safe`.
- AC-05-2: In Safe mode the typed sequence is `<message>` followed by Enter.
- AC-05-3: In /btw mode the typed sequence is `/btw <message>` followed by Enter.
- AC-05-4: No mode ever sends Ctrl-C, Esc, or any key other than printable characters and Enter.
- AC-05-5: The selected mode is persisted to config immediately and restored on next launch.
- AC-05-6: The /btw radio item carries the tooltip `Claude Code only. Other agents receive it as plain text.` on platforms that support tooltips.

### US-06 Auto mode with escalation and cap [APPROVED]

As a developer waiting on a long task, I want WhipZap to crack on its own at irregular intervals with messages that get meaner over time, so that waiting is funnier.

- AC-06-1: Tray `Auto mode` checkbox or the toggle-auto hotkey (default `CommandOrControl+Alt+A`) starts auto mode only if a target is locked. If none is locked, WhipZap tries to lock the foreground window first; if that fails or is declined, a toast `No target locked` is shown and auto mode stays off.
- AC-06-2: In auto mode the next crack time is `baseIntervalSec + U(-jitterSec, +jitterSec)` seconds after the previous crack (or after enabling), with defaults 180 and 90, producing intervals in [90, 270] s.
- AC-06-3: Interval and message selection use a seeded pseudo-random generator. With `auto.seed` set to a number, the sequence of intervals and messages is identical across runs. With `seed: null`, a random seed is drawn at enable time.
- AC-06-4: Message tier is chosen by the number of auto cracks so far in the current auto session: 0-4 mild, 5-11 medium, 12 and above spicy.
- AC-06-5: After `auto.sessionCap` (default 20) cracks in the auto session, auto mode turns itself off and shows the toast `Auto session cap reached (<N>)` where N is `auto.sessionCap`.
- AC-06-6: Turning auto mode off and on again resets the crack count and tier to zero.
- AC-06-7: While auto mode is on, manual cracks (hotkey, tray, whip mode) count toward the auto session and use the auto tier; they do not reset the timer. (Decided 2026-10-21, see docs/ARCHITECTURE.md 4.6.)
- AC-06-8: If the target window disappears, an auto crack performs the no-target fallback (US-10) with toast `Target window closed` and auto mode turns off with toast `Auto mode off`.
- AC-06-9: A toast `Auto mode on` / `Auto mode off` is shown on each transition.

### US-07 Mute [APPROVED]

As a developer in an office, I want to mute the crack sound while keeping the visual and the typing.

- AC-07-1: Tray `Mute` checkbox toggles sound. When muted, cracks produce no audio but still show the visual and type the message.
- AC-07-2: Mute state persists in config as `sound.muted`.
- AC-07-3: `sound.volume` in [0, 1] sets playback volume; invalid values fall back to 0.8.

### US-08 Edit messages via config [APPROVED]

As a developer, I want to add my own taunts or replace the built-in ones, so that the whip speaks my language.

- AC-08-1: Tray `Open config` opens `config.json` in the OS default editor for `.json` files (shell open), creating it with defaults if missing.
- AC-08-2: `messages.extra` is an array of objects `{ "text": string, "tier": "mild"|"medium"|"spicy" }`. Entries are added to the built-in pack.
- AC-08-3: `messages.replace: true` makes `messages.extra` the only pack. If the resulting pack has an empty tier, that tier falls back to the built-in pack with a warning in the log (docs/ARCHITECTURE.md section 10). If all are empty, the built-in pack is used.
- AC-08-4: Config is re-read when the file changes on disk (watch, 300 ms debounce) and the toast `Config reloaded` is shown. Invalid JSON at load renames the file to `config.json.bak`, restores defaults, and shows `Config invalid, using defaults`; invalid JSON during a watch reload keeps the last good config and shows the same toast.
- AC-08-5: User message text is limited to 200 characters; longer entries are rejected with a warning. Built-in lines are at most 80 characters.
- AC-08-6: Message text containing newline or other control characters is rejected (ignored) on load, since a newline would submit early.

### US-09 macOS Accessibility onboarding [APPROVED]

As a macOS user, I want to be told exactly how to grant the permission WhipZap needs, so that typing works on the first try.

- AC-09-1: On macOS, on the first lock attempt WhipZap checks Accessibility trust. If not trusted, it shows the native dialog from docs/UX.md section 1.3 (`WhipZap needs Accessibility access`) with buttons `Open Settings` and `Later`.
- AC-09-2: `Open Settings` opens the Accessibility pane. `Later` dismisses; the check runs again at the next lock attempt and the dialog is shown again if still untrusted.
- AC-09-3: Until trusted, cracks fall back to sound and visual only with toast `Accessibility permission required`.
- AC-09-4: On Windows and Linux this story is a no-op.

### US-10 No-target fallback [APPROVED]

As a developer, I want a crack with no valid target to still be fun but harmless, so that nothing is typed somewhere unexpected.

- AC-10-1: If no target is locked, or the locked window handle no longer exists, the crack plays sound (unless muted), shows the strike visual with the message, and shows a toast `No target locked`. Nothing is typed.
- AC-10-2: If re-focusing the target fails (OS refused foreground change), nothing is typed and a toast `Could not focus target` is shown. WhipZap never types into whatever window happens to be focused.
- AC-10-3: If the typing helper fails for any other reason, a toast `Typing failed` is shown and the reason is written to the process log (stdout/stderr, see docs/ARCHITECTURE.md section 15).

### US-11 Quit [APPROVED]

As a developer, I want to quit cleanly from the tray.

- AC-11-1: Tray `Quit` unregisters hotkeys, hides the overlay, stops auto mode, and exits within 1 s.
- AC-11-2: Closing the overlay by other means never quits the app.

### US-12 Linux X11 best effort [APPROVED]

As a Linux user on X11, I want WhipZap to work if `xdotool` is installed and tell me clearly if it is not.

- AC-12-1: On Linux, if `xdotool` is not on PATH, launch shows the native dialog from docs/UX.md section 1.4 and each crack toasts `xdotool not found`; cracks fall back to sound and visual only.
- AC-12-2: On Wayland sessions (`XDG_SESSION_TYPE=wayland`), launch shows the native dialog from docs/UX.md section 1.4 once per session and each crack toasts `Wayland is not supported`.

## 5. Functional requirements

### 5.1 Targeting

| ID | Requirement | Label |
|----|-------------|-------|
| FR-01 | Maintain at most one locked target: `{ id, processName, title, pid }` (`id` is the platform window id as a string). | [APPROVED] |
| FR-02 | Lock the foreground window only on these user actions: crack hotkey or tray `Crack now` when unlocked, `Arm whip`, `Auto mode` toggle when unlocked, and tray `Lock target`. A whip-mode or auto crack never locks a window; without a target it plays sound and visual and toasts `No target locked`. A lost target drops the whip and turns auto mode off (D-14). | [APPROVED] |
| FR-03 | Sanity-check the candidate against `target.allowPatterns` (case-insensitive substring or regex on process name and title). Default patterns cover: Windows Terminal, cmd, powershell, pwsh, conhost, mintty, alacritty, wezterm, kitty, ghostty, hyper, Terminal.app, iTerm2, Warp, VS Code, Code - Insiders, Cursor, Windsurf, JetBrains IDEs (idea, pycharm, webstorm, rider, goland, clion, phpstorm, rubymine, datagrip), gnome-terminal, konsole, xterm, tilix. | [APPROVED] |
| FR-04 | Non-matching candidate: native confirm dialog once per window per session (AC-02-4). | [APPROVED] |
| FR-05 | Before typing, re-focus the locked window by id; verify the foreground window equals the target before sending keys. | [APPROVED] |
| FR-06 | Reject WhipZap's own windows as targets. | [APPROVED] |
| FR-07 | Re-arm replaces the lock. There is no "unlock" item in v1; quitting clears it. | [ASSUMED] |

### 5.2 Delivery

| ID | Requirement | Label |
|----|-------------|-------|
| FR-08 | Two delivery modes: `safe` (text + Enter) and `btw` (`/btw ` + text + Enter). | [APPROVED] |
| FR-09 | Never send Ctrl-C, Esc, Ctrl-D, or any modifier-key combination. Enter is the only control key. No modifier key is ever synthesized, not even a bare Alt tap (D-13). | [APPROVED] |
| FR-10 | Typing supports Unicode (including emoji) on Windows and macOS. On Linux via `xdotool type`. | [APPROVED] |
| FR-11 | Typed text equals the displayed message exactly, with the `/btw ` prefix added in btw mode. | [APPROVED] |
| FR-12 | Wait 150 ms (configurable constant, not user-facing) between focus and typing. | [ASSUMED] |

### 5.3 Triggers

| ID | Requirement | Label |
|----|-------------|-------|
| FR-13 | Three global hotkeys, configurable as Electron accelerators: `hotkeys.crack` (default `CommandOrControl+Alt+W`), `hotkeys.armWhip` (default `CommandOrControl+Alt+Shift+W`), `hotkeys.toggleAuto` (default `CommandOrControl+Alt+A`). | [APPROVED] |
| FR-14 | If a hotkey cannot be registered (conflict), show toast `Hotkey <accel> is taken. Change it in config.` and continue. | [ASSUMED] |
| FR-15 | Whip mode: rope physics overlay; crack when tip speed exceeds threshold; rate limit 250 ms; 400 ms grace after arm. | [APPROVED] |
| FR-16 | Tray `Crack now` runs the crack routine identically to the hotkey. | [APPROVED] |
| FR-17 | All triggers call one crack routine (`crack.js`). | [APPROVED] |

### 5.4 Auto mode

| ID | Requirement | Label |
|----|-------------|-------|
| FR-18 | Auto mode is a manual toggle (tray checkbox, hotkey). Requires a locked target. | [APPROVED] |
| FR-19 | Scheduler: seeded PRNG (mulberry32 in `src/main/prng.js`), interval = base + uniform jitter, clamped to a minimum of 20 s. | [APPROVED] |
| FR-20 | Tiers by auto-session crack count: mild 0-4, medium 5-11, spicy 12+. | [APPROVED] |
| FR-21 | Session cap (default 20) ends auto mode with a toast. | [APPROVED] |
| FR-22 | Re-enabling resets count, tier, and (if `seed` is null) draws a new seed. | [APPROVED] |
| FR-23 | Scheduler core is a pure module with injectable clock and RNG for unit tests. | [APPROVED] |

### 5.5 Content

| ID | Requirement | Label |
|----|-------------|-------|
| FR-24 | Built-in pack `assets/messages/default.json`: 30 messages in three tier arrays (`tiers.mild`, `tiers.medium`, `tiers.spicy`, 10 each, docs/UX.md section 9 verbatim), all ASCII, at most 80 characters. Content teases the agent only; no references to real people, groups, or protected characteristics. | [APPROVED] |
| FR-25 | Tier per crack: hotkey and tray cracks pick from `mild`, whip-mode cracks from `medium`, auto cracks from the tier for the auto-session count. While auto mode is on, every crack from any source uses the auto tier and counts toward the session. Supersedes the earlier "uniform across all tiers" assumption (decided 2026-10-21). | [APPROVED] |
| FR-26 | Avoid immediate repeats: the same message is not chosen twice in a row when the pool has more than one entry. | [ASSUMED] |
| FR-27 | Sounds: three CC0 whip-crack clips `assets/sounds/crack-1.wav` to `crack-3.wav` (16-bit mono 48 kHz WAV, at most 0.8 s), chosen by the seeded RNG per crack. Source: Joseph Sardin, BigSoundBank.com, "CC0 (public domain): Free and royalty-free". Provenance and edits in `assets/CREDITS.md`. | [APPROVED] |
| FR-28 | Visual: rope in whip mode; strike-flash (diagonal lash plus brief flash plus big centered message, total under 900 ms) for hotkey, tray, and auto cracks. | [APPROVED] |

### 5.6 Configuration

| ID | Requirement | Label |
|----|-------------|-------|
| FR-29 | Single JSON config at `app.getPath('userData')/config.json`. Schema in docs/ARCHITECTURE.md. Keys: `version`, `delivery`, `hotkeys`, `auto`, `sound`, `messages`, `target`. | [APPROVED] |
| FR-30 | Missing keys take defaults; unknown keys are ignored; invalid values fall back per key with one toast. | [ASSUMED] |
| FR-31 | Tray toggles write config immediately. Config file edits are picked up via file watch with a 300 ms debounce. | [ASSUMED] |
| FR-32 | Log file at `app.getPath('userData')/whipzap.log`, rotated at 1 MB, one previous copy kept. Not in v1: logging goes to the process stdout/stderr (docs/ARCHITECTURE.md section 15). | [FUTURE] |

### 5.7 Tray

| ID | Requirement | Label |
|----|-------------|-------|
| FR-33 | Tray menu, exact order: `Arm whip` (checkbox) / `Crack now` / `Auto mode` (checkbox) / `Delivery` (submenu with radio items `Safe (queued message)` and `/btw (side question)`) / `Mute` (checkbox) / `Open config` / `Lock target` / `Quit`. Labels and separators per docs/UX.md section 3. | [APPROVED] |
| FR-34 | Tray tooltip per docs/UX.md section 2: `WhipZap: no target locked`, `WhipZap: locked on <title truncated to 40 chars>`, `WhipZap: whip armed`, `WhipZap: auto mode, N of CAP`. | [ASSUMED] |
| FR-35 | Tray icon has four state glyphs (idle, locked, armed, auto) as 16 and 32 px PNGs for Windows and Linux plus `*Template.png` variants for macOS, generated by `scripts/gen-icons.ps1`. | [ASSUMED] |

### 5.8 Overlay

| ID | Requirement | Label |
|----|-------------|-------|
| FR-36 | One overlay BrowserWindow: transparent, frameless, always on top, non-focusable, skip taskbar, sized to the primary display, hidden when idle. | [APPROVED] |
| FR-37 | Strike visuals are click-through (mouse events ignored) and auto-hide. Whip mode makes the overlay mouse-interactive. | [APPROVED] |
| FR-38 | Toasts are rendered on the overlay as a bottom-centre pill with the copy and durations in docs/UX.md section 8. Native OS notifications are not used (superseded 2026-10-21). | [APPROVED] |
| FR-39 | Primary display only in v1. | [APPROVED] |

### 5.9 Sound

| ID | Requirement | Label |
|----|-------------|-------|
| FR-40 | Playback through the overlay renderer `Audio` element, pre-loaded at startup, respecting `sound.muted` and `sound.volume`. | [APPROVED] |
| FR-41 | Sound starts within 100 ms of the crack trigger (before typing begins). | [ASSUMED] |

### 5.10 Platform

| ID | Requirement | Label |
|----|-------------|-------|
| FR-42 | Platform adapters implement one contract (`createPlatform()`): `isSupported()`, `checkPermissions({ prompt })`, optional `start()`/`stop()`, `getForegroundWindow()`, `getWindowInfo(id)`, `focusWindow(id)`, `typeText(id, text, { pressEnter })`, `openAccessibilitySettings()`. Errors carry codes 1 other, 2 permission, 3 target gone, 4 unsupported or missing tool, 5 focus failed. Details in docs/ARCHITECTURE.md 4.11 and 6.1. | [APPROVED] |
| FR-43 | Windows: long-lived PowerShell worker `src/main/helpers/win/worker.ps1` with inline C# (`GetForegroundWindow`, `AttachThreadInput` + `SetForegroundWindow` with `SwitchToThisWindow` fallback, `SendInput` with `KEYEVENTF_UNICODE`). Verified on Windows 11 on 2026-10-21. | [APPROVED] |
| FR-44 | macOS: `osascript` / System Events for typing and `open` for the Accessibility pane; focus via process activation by PID. | [APPROVED] |
| FR-45 | Linux X11: `xdotool` for window query, focus, and typing. Wayland: disabled with message. | [APPROVED] |
| FR-46 | WSL2 supported implicitly: WhipZap runs on Windows and targets the Windows terminal hosting the WSL shell. Documented in README. | [APPROVED] |
| FR-47 | No native Node modules. Helpers live in `src/main/helpers/<os>/` and are spawned as child processes with argument arrays, never through a shell string; text travels on stdin. | [APPROVED] |

## 6. Key behaviors (normative summaries)

### 6.1 State machine

States: `Idle` (no target) -> `Locked` (target set) -> `Armed` (whip mode active, implies Locked) and `Auto` (auto mode on, implies Locked, orthogonal to Armed). Events: lock, arm, drop, crack, autoOn, autoOff, targetLost, quit. Full table in docs/ARCHITECTURE.md.

### 6.2 Delivery text

`safe`: `${message}` + Enter. `btw`: `/btw ${message}` + Enter.

### 6.3 Crack routine (normative order)

1. Pick message (tier per FR-25, no immediate repeat).
2. Play sound unless muted.
3. Show strike visual with message on overlay (or rope crack flash in whip mode).
4. If no target is locked, toast `No target locked`, stop. If the locked window no longer exists, clear the lock, toast `Target window closed`, stop.
5. Re-focus target; verify foreground equals target; if not, toast `Could not focus target`, stop.
6. Wait 150 ms.
7. Type delivery text, then Enter (one helper call).
8. Log the crack (timestamp, mode, tier, outcome; message text only at debug level).

### 6.4 Hotkeys

See FR-13. All are global and work regardless of which app has focus.

### 6.5 Tiers

mild (0-4 auto cracks), medium (5-11), spicy (12+). Examples: mild `FASTER!`, `WORK HARDER!`; medium `I have seen glaciers refactor quicker.`; spicy `My grandmother ships features faster, and she is a shell script.` Final pack content is specified in docs/UX.md.

### 6.6 Config path

Windows `%APPDATA%\whipzap\config.json`, macOS `~/Library/Application Support/whipzap/config.json`, Linux `~/.config/whipzap/config.json`.

## 7. Non-functional requirements

| ID | Requirement | Label |
|----|-------------|-------|
| NFR-01 | Startup to tray icon under 3 s. | [APPROVED] |
| NFR-02 | Crack-to-first-keystroke under 500 ms when target already focused, under 800 ms with re-focus. | [APPROVED] |
| NFR-03 | Idle CPU under 1% with overlay hidden; whip mode may use up to one core's worth of GPU/CPU for rendering. | [ASSUMED] |
| NFR-04 | Memory: under 200 MB resident with overlay hidden (Electron baseline). | [ASSUMED] |
| NFR-05 | No network access of any kind at runtime. No telemetry, no update checks, no remote assets. Fully offline. | [APPROVED] |
| NFR-06 | All dialogs and toasts are plain-language, keyboard-operable native dialogs. | [ASSUMED] |
| NFR-07 | English only; i18n not required. | [ASSUMED] |
| NFR-08 | Unicode typing on Windows via `SendInput` with `KEYEVENTF_UNICODE`; on macOS via System Events keystroke; on Linux via `xdotool type`. | [APPROVED] |
| NFR-09 | License MIT. All bundled assets CC0 or produced by the project, listed in `assets/CREDITS.md` with source URLs. | [APPROVED] |
| NFR-10 | No OpenWhip code, text, sounds, or icons are copied. | [APPROVED] |
| NFR-11 | Plain JavaScript (ESM), Node 20 or later, Electron current stable, no native modules, no bundler. | [APPROVED] |
| NFR-12 | Unit tests (Vitest) for scheduler, message selection, target sanity rules, config loading and validation, delivery formatting. CI runs lint and tests on every push. | [APPROVED] |
| NFR-13 | Helper processes are spawned with argument arrays; message text is passed via stdin (a JSON line on Windows, raw on macOS and Linux), never as an argument and never interpolated into a shell command. | [APPROVED] |
| NFR-14 | The app never reads clipboard contents and never modifies the clipboard. | [ASSUMED] |
| NFR-15 | Install footprint acceptable: Electron download (about 100 MB) is the known cost and documented in README. | [APPROVED] |
| NFR-16 | Single-instance: a second launch exits cleanly. | [ASSUMED] |

## 8. Platform support matrix

| Platform | Status | Typing mechanism | Notes |
|----------|--------|------------------|-------|
| Windows 10/11 | First-class | PowerShell + inline C# SendInput | Unicode supported. WSL2 terminals are Windows windows and work. |
| macOS 13+ | First-class | osascript System Events | Requires Accessibility permission; guided prompt. |
| Linux X11 | Best-effort | xdotool | Must be installed by user. |
| Linux Wayland | Unsupported | none | Typing disabled with message. Helper interface left open for ydotool. |

## 9. Out of scope (v1)

All [FUTURE] unless marked excluded.

1. Camera-based gesture whipping.
2. Agent-state detection (hooks, status files, title heuristics).
3. Themed message packs selectable from the tray.
4. Per-agent profiles (Codex, opencode specific behaviors).
5. Wayland typing.
6. Packaged installers (.exe, .dmg, .AppImage), code signing.
7. Multi-monitor overlay.
8. Any interrupt mode (Esc, Ctrl-C). Excluded permanently by D-1, not merely deferred.
9. Telemetry, analytics, crash reporting, auto-update, network access. Excluded.
10. Settings window / GUI editor for config.
11. Localization.

## 10. Assumptions

1. [ASSUMED] Users run a terminal or editor that accepts synthesized keyboard input (true for all listed hosts).
2. [ASSUMED] Claude Code's queue-on-Enter behavior persists; if Claude Code changes it, Safe mode remains harmless because it only ever sends text plus Enter.
3. Verified 2026-10-21: on Windows, `AttachThreadInput` plus `SetForegroundWindow` (with `SwitchToThisWindow` as fallback) re-focuses a background target from the helper worker. No Alt-key nudge is used (D-13).
4. [ASSUMED] Electron `globalShortcut` is reliable on Windows 11 and macOS for the three default accelerators; verified in M1.
5. Resolved 2026-10-21: three CC0 whip cracks by Joseph Sardin (BigSoundBank.com) were obtained and are trimmed into `assets/sounds/`.
6. [ASSUMED] Users accept a 100 MB Electron dependency for a joke app (OpenWhip precedent).
7. [ASSUMED] Default hotkeys do not conflict with common terminal or editor shortcuts; conflicts are user-configurable.

## 11. Glossary

| Term | Meaning |
|------|---------|
| Crack | One execution of the crack routine: sound, visual, type message, Enter. |
| Arm | Enter whip mode: the mouse-driven rope is shown. |
| Drop | Leave whip mode: the rope falls and the overlay hides. |
| Lock | Record a specific window as the only place keystrokes may go. |
| Target | The locked window: id, process name, title, pid. |
| Delivery mode | `safe` (plain message) or `btw` (`/btw` prefixed side question). |
| Tier | Message intensity bucket: mild, medium, spicy. |
| Auto session | The period from enabling auto mode to it turning off; owns the crack count, tier, and seed. |
| Toast | Short transient notification rendered on the overlay (docs/UX.md section 8). |
| Helper | Per-OS script spawned by a platform adapter to query, focus, or type into windows. |

## 12. Traceability

| Decision | Requirements |
|----------|--------------|
| D-1 Delivery | FR-08..FR-12, US-05, NG-3 |
| D-2 Targeting | FR-01..FR-07, US-02, US-10 |
| D-3 Triggers | FR-13..FR-17, US-03, US-04 |
| D-4 Auto mode | FR-18..FR-23, US-06 |
| D-5 Stack | NFR-11, FR-47 |
| D-6 Platforms | FR-42..FR-46, US-09, US-12, section 8 |
| D-7 Content | FR-24..FR-28, US-07, US-08 |
| D-8 Config/install | FR-29..FR-35, US-01, US-11 |
| D-9 Scope/quality | NFR-12, section 9 |
| D-10 Naming | README, package name |
| D-11 Clean-room | NFR-09, NFR-10 |
| D-12 Persistent Windows helper worker | FR-43, NFR-02 |
| D-13 No synthesized modifier keys | FR-09, AC-05-4 |
| D-14 Only explicit user actions lock a target | FR-02, FR-06 |
| D-15 Overlay focusable only while armed | FR-36, FR-37 |

## Deviations (2026-10-21)

1. FR-14, AC-02-3, AC-06-5, AC-06-8, AC-08-4, AC-09-3, AC-10-3, AC-12-1, AC-12-2: toast and dialog copy aligned to docs/UX.md verbatim. Reason: UX.md is the copy source of truth.
2. FR-19: minimum auto interval is 20 s (was 10 s). Reason: align with ARCHITECTURE and TESTING.
3. FR-25, AC-06-7: tier rule decided; cracks of any source count toward the auto session while auto is on. Reason: lead decision replacing the uniform-tier assumption.
4. FR-27: sounds are WAV from BigSoundBank CC0 sources. Reason: no encoder on the dev machine.
5. FR-32: log file moved to [FUTURE]. Reason: v1 logs to stdout/stderr only.
6. FR-33, AC-05-1, AC-05-6: Delivery is a submenu with two radio items. Reason: UX.md section 3.
7. FR-38: toasts render on the overlay, never as native notifications. Reason: ARCHITECTURE and UX agree; native notifications are inconsistent across platforms.
8. FR-42, FR-43, FR-47, FR-01, FR-05, NFR-13: adapter contract, helper paths, worker design and `id` field match the verified implementation; AC-06-1 uses the lock-first flow.
9. Assumptions 3 and 5 resolved by the 2026-10-21 spike and sound sourcing.
10. FR-02 tightened (D-14): whip-mode and auto cracks never lock. Reason: incident during testing, see docs/SMOKE-RESULTS.md.
11. FR-36: the overlay is non-focusable except while the whip is armed (D-15). Reason: Windows delivers no mouse buttons to a non-activatable window.
12. FR-29: config gains `whip.crackFactor` and `whip.cooldownMs`; `WHIPZAP_USER_DATA` overrides the config directory.
