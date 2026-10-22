# WhipZap Decision Log

Status: Approved / Last updated 2026-10-21 / Owner: project lead (Khumoyun1307)

Format: compact architecture decision records. D-1 to D-9 are the nine product-discovery decisions in the order they were made. D-10 and D-11 are approved constraints that emerged from research. All are [APPROVED] unless noted. Revisit requires owner sign-off and an entry update, never silent drift.

---

## D-1 Delivery: two non-interrupting modes, no interrupt mode

**Context.** OpenWhip sends Ctrl-C, a taunt, and Enter into the focused terminal, aborting the agent's turn. Research on current Claude Code (docs/RESEARCH.md) showed: pressing Enter while the agent works queues the message without interrupting; Esc interrupts the turn; Ctrl-C clears input once and exits Claude Code when pressed twice; `/btw` is a side question answered from context that cannot steer the agent's work.

**Decision.** WhipZap offers exactly two delivery modes, both non-interrupting:
- `safe` (default): type `<message>`, press Enter. Queued while the agent is busy, starts a turn when idle.
- `btw`: type `/btw <message>`, press Enter. Gets a reply, never changes the work. Claude Code only.

WhipZap never sends Ctrl-C, Esc, or any control key other than Enter.

**Alternatives rejected.**
- Esc-based "Crack" interrupt mode (lead's recommendation): rejected by the owner. Interrupting wastes the in-flight work and tokens; the product's reliability promise is stronger without it.
- Ctrl-C like OpenWhip: unsafe; two presses exit Claude Code entirely and Ctrl-C is a kill signal in other hosts.
- `/btw` as the primary "safe" channel: it cannot reach the agent's working context, so it would make the whip purely decorative.

**Consequences.** The product cannot break anything, which simplifies targeting failure handling. A whip to an idle agent starts a short, cheap turn; documented as acceptable. The btw mode is host-specific and labeled so in the UI.

## D-2 Targeting: lock on arm with sanity check

**Context.** OpenWhip types into whatever window is focused. Its most frequent complaint and the subject of most forks is keystrokes landing in SSH sessions, database consoles, and chat apps.

**Decision.** When the user arms the whip, presses the crack hotkey with no lock, or selects tray `Lock target`, WhipZap records the foreground window (handle, process name, title). Every crack re-focuses that exact window and verifies the foreground before typing. If the window does not look like a terminal or editor (configurable allow patterns), a one-time native dialog asks `Whip this window?`. If the window is gone or focus fails, the crack plays sound and visual only and shows a toast. Re-arming moves the lock.

**Alternatives rejected.**
- Type into whatever is focused (OpenWhip style): repeats the main flaw.
- Allowlist only, no lock: still types into the wrong terminal if the user alt-tabs between two terminals.

**Consequences.** Needs per-OS window query and focus helpers (D-5). Windows foreground-change restrictions must be handled (verified in M1). Slightly more setup for the user (one arm step), offset by the "Lock target" tray item and auto-lock on first crack.

## D-3 Triggers: hotkey, mouse whip, auto, one crack routine

**Context.** OpenWhip's mouse-swing rope is the signature fun and the reason for its virality. The owner also asked for keyboard-focused operation, and auto mode needs a trigger with no human input.

**Decision.** Three ways to fire one shared crack routine:
1. Global hotkey instant crack (`CommandOrControl+Alt+W`).
2. Whip mode: armed by hotkey (`CommandOrControl+Alt+Shift+W`) or tray; rope follows the cursor on a transparent overlay; flicking fast enough cracks; click or hotkey drops it.
3. Auto scheduler (D-4).

**Alternatives rejected.**
- Hotkey only (no rope physics): far less code but loses the showpiece.
- Mouse only: blocks keyboard users and auto mode.

**Consequences.** Overlay must support two input modes (click-through for strike flashes, interactive for whip mode). Rope physics is isolated in `src/overlay/rope.js` and tested visually, not by unit tests.

## D-4 Auto mode: manual toggle, seeded jittered timer, no agent-state detection

**Context.** A standalone app cannot see whether the agent is working. Claude Code hooks could report state but would require users to install a hook configuration, which the owner excluded. Terminal-title heuristics are fragile and unverified.

**Decision.** Auto mode is a deliberate toggle (tray checkbox or hotkey), active only while a target is locked. A seeded PRNG picks intervals of `base + uniform(-jitter, +jitter)` seconds (defaults 180 and 90) and picks messages from a tier that escalates with the crack count (mild 0-4, medium 5-11, spicy 12+). A session cap (default 20) turns auto mode off. Re-enabling resets the session.

**Alternatives rejected.**
- Optional opt-in Claude Code hook writing a status file: parked as a v2 idea; it is a second install step.
- Heuristic detection from window title or screen changes: platform-specific and unreliable.

**Consequences.** An auto crack may reach an idle agent and start a short turn; accepted and documented. The scheduler is a pure module with injectable clock and RNG, fully unit-testable. Deterministic behavior with a fixed seed enables reproducible tests and bug reports.

## D-5 Stack: Electron, plain JavaScript, shell-out helpers, no native modules

**Context.** Needs: transparent always-on-top overlay with canvas physics, tray icon, global hotkeys, sound, per-window focus and typing, on three OSes, with one-command install and maximal contributor accessibility.

**Decision.** Electron with plain JavaScript (ESM). Overlay is an HTML canvas. Tray and global shortcuts come from Electron. Sound is an `Audio` element. Window query, focus, and typing are done by small per-OS helper scripts spawned as child processes: PowerShell with inline C# on Windows (`SetForegroundWindow`, `SendInput` with Unicode), `osascript` on macOS, `xdotool` on Linux. No node-gyp, no FFI, no compiled dependencies.

**Alternatives rejected.**
- Tauri: 10 MB binary but Rust toolchain for contributors and Rust crates for input injection.
- Python: easy install but weak transparent overlays and tray packaging on macOS.
- Electron with FFI (OpenWhip uses koffi): native dependency, ASCII-only typing, harder to audit.
- TypeScript: adds a build step for a small codebase; may be revisited after v1.

**Consequences.** About 100 MB download and 150 MB RAM for a joke app; OpenWhip had the same cost and nobody complained about it. Helpers are readable scripts, which also serve as the security audit surface.

## D-6 Platforms: Windows and macOS first-class, Linux X11 best-effort, WSL2 via Windows

**Context.** Owner develops on Windows 11. OpenWhip's audience was mostly macOS. OpenWhip's Linux support (X11 only, missing from early packages) and WSL2 support (none) generated many issues.

**Decision.** Windows and macOS are tested on every release; macOS gets a guided Accessibility permission prompt. Linux X11 works via `xdotool` with a clear message when it is missing. Wayland is unsupported in v1 with the helper interface left open. WSL2 is supported by running WhipZap on Windows and targeting the Windows terminal window hosting the WSL shell. Safe mode is host-agnostic (any CLI agent, VS Code, Cursor); btw mode is Claude Code only. No per-agent profiles.

**Alternatives rejected.**
- Windows and macOS only: Linux users were vocal in OpenWhip's issues.
- Wayland now via `ydotool`: requires a root daemon; support burden out of proportion to audience.

**Consequences.** Three helper implementations behind one contract. CI runs unit tests on all three OS runners; manual smoke tests on Windows and macOS are required for release.

## D-7 Content: tiered built-in pack, user overrides, CC0 sounds, two visual styles

**Context.** OpenWhip's seven hardcoded strings and five identical MP3s with no provenance. Humor and escalation are the product. Every line will appear in public screenshots.

**Decision.** Built-in pack of 24 to 30 messages in three tiers (mild, medium, spicy), user-extendable or replaceable via `messages.extra` and `messages.replace` in config. Lines tease the agent only. Two or three CC0 whip-crack sounds with provenance recorded in `assets/CREDITS.md`, plus a mute toggle. Visuals: rope in whip mode; a strike-flash with the message in large text for hotkey, tray, and auto cracks. Themed packs are v2.

**Alternatives rejected.**
- Flat list, no overrides: no escalation, no personalization.
- Themed packs selectable in v1: contributor-friendly but not needed for the core experience.

**Consequences.** Message pack is data, not code; contributors can add lines via JSON. Asset licensing is auditable from one file.

## D-8 Configuration and install: minimal tray menu, one JSON file, npm first

**Context.** OpenWhip has no configuration at all. The owner wants minimal, intuitive controls.

**Decision.** Tray menu with the frequently flipped toggles: `Arm whip`, `Crack now`, `Auto mode`, `Delivery: Safe / btw`, `Mute`, `Open config`, `Lock target`, `Quit`. Everything else lives in `config.json` under the platform user-data directory. Install via `npm install -g whipzap` or `npx whipzap`. Packaged installers come after v1 stabilizes.

**Alternatives rejected.**
- Settings window: more polish, a second window to maintain, not needed for a handful of options.
- Installers from day one: code signing and CI packaging before anything exists.

**Consequences.** Config validation with per-key fallback and file watching are required. Tray state and config must stay in sync.

## D-9 Scope boundary and quality bar

**Context.** Proportionality for a roughly 3,000-line joke app with a few risky OS integrations.

**Decision.** Out of v1: camera gestures, hook-based agent-state detection, themed packs, per-agent profiles, Wayland, installers, multi-monitor overlay, and any interrupt mode. Quality bar: Vitest unit tests for the pure logic (scheduler, message selection, target sanity rules, config loading, delivery formatting), a per-OS manual smoke checklist, GitHub Actions running lint and tests on push, and a README that states exactly what a whip does and does not do to the agent.

**Alternatives rejected.**
- Multi-monitor in v1: frequent OpenWhip complaint but adds overlay-per-display complexity; deferred.
- No CI or tests: not acceptable for a project meant to be implemented and maintained by agents.

**Consequences.** Roadmap milestones each carry explicit verification. Scope creep requires an owner decision.

## D-10 No "Claude" in the name or branding

**Context.** OpenWhip was originally published as "badclaude" and the author reported a cease-and-desist from Anthropic over the name, leading to the rename.

**Decision.** The product, package, repository, icons, and marketing copy never use "Claude" or any Anthropic trademark as part of the name or brand. Descriptive references to Claude Code as a supported host (for example "works with Claude Code") are fine.

**Consequences.** Package name `whipzap`. The btw mode is labeled "(Claude Code only)" as a factual host note.

## D-11 Clean-room: no OpenWhip code, text, or assets

**Context.** OpenWhip declares MIT in `package.json` but ships no LICENSE file, and its sounds and icons have no stated provenance. The owner wants to write everything independently.

**Decision.** No source code, README text, message strings, sounds, icons, or images from OpenWhip or its forks are copied. Inspiration is acknowledged in the README as a courtesy, which carries no license obligation. All assets are CC0 or project-made and listed in `assets/CREDITS.md`.

**Consequences.** Message pack and sounds must be sourced or written fresh. Agents must not fetch OpenWhip source as a reference for implementation; docs/RESEARCH.md contains the behavioral summary that is needed.

## D-12 Persistent Windows helper worker

**Context.** The Windows helper compiles inline C# with `Add-Type`; the spike on 2026-10-21 measured 4.8 s from PowerShell start to ready, far above the 500 ms crack-to-keystroke target if paid per crack.

**Decision.** `src/main/helpers/win/worker.ps1` is a long-lived process started by `platform.start()` at app launch, speaking one JSON request and one JSON response per line over stdin and stdout, restarted automatically if it exits. macOS and Linux helpers stay one-shot because `osascript` and `xdotool` start in well under 100 ms.

**Alternatives rejected.** One-shot PowerShell per crack (4.8 s latency); a compiled native helper (violates D-5, no native modules or build step).

**Consequences.** Warm requests complete in 425 to 560 ms end to end. `win.js` owns the worker lifecycle and uses it for a 1000 ms foreground poll that makes tray locks work on Windows.

## D-13 No synthesized modifier keys, including Alt

**Context.** A widely used workaround for the Windows foreground lock is to simulate an Alt key press so the calling process counts as having received the last input event. The spike showed `AttachThreadInput` plus `SetForegroundWindow` (with `SwitchToThisWindow` as fallback) succeeds without it, and a bare Alt tap activates menu bars in some applications.

**Decision.** WhipZap never synthesizes any modifier key. The only key events it ever produces are Unicode text events and Enter. `npm run lint:keys` fails on `VK_MENU` as well as the D-1 strings.

**Alternatives rejected.** Alt tap before `SetForegroundWindow` (side effects on the target, and a key event aimed at the target by definition).

**Consequences.** If a future Windows build refuses focus via `AttachThreadInput`, the helper reports code 5 and the crack shows "Could not focus target" rather than trying a modifier-key trick.

## D-14 Only explicit user actions lock a target

**Context.** During end-to-end testing on 2026-10-21 the fixture window closed while whip mode was armed. WhipZap reported the target gone, but the next flick had no target and the crack path locked the current foreground window (the operator's VS Code) and typed six taunts into it. Decision D-2 says text goes only to a window the user chose; a whip flick or a timer is not a choice of window.

**Decision.** The lock points are exhaustive: crack hotkey or tray Crack now when nothing is locked, Arm whip, Auto mode toggle when nothing is locked, and Lock target. A crack with source `whip` or `auto` never locks; without a target it plays sound and visual and toasts "No target locked". When the target is lost, auto mode turns off and the whip drops.

**Alternatives rejected.** Re-locking the foreground on any crack (the behaviour that caused the incident); prompting on every whip-mode crack (unusable).

**Consequences.** `app.js` gates locking on the crack source; `onTargetLost` drops the whip. Documented in ARCHITECTURE 4.5 and 5.1, PRD FR-02, SECURITY.md.

## D-15 Overlay focusable only while the whip is armed

**Context.** The overlay is `focusable: false` so it never becomes the foreground window the helper would type into. On Windows 11 that window received mouse moves (flicks cracked) but no mouse button events, so click-to-drop never fired.

**Decision.** `setMouseMode(true)` (arming) calls `setFocusable(true)` and `focus()`; `setMouseMode(false)` (drop) restores `focusable: false`, and app.js re-focuses the locked target through the helper so the user's terminal has the keyboard again. Outside whip mode nothing changes.

**Alternatives rejected.** Keeping the overlay non-focusable and dropping only via hotkey or tray (loses the natural gesture); a separate invisible input window (more surface for the same result).

**Consequences.** While armed, the overlay may be the foreground window; a crack still re-focuses the target before typing, so typing is unaffected. Click-to-drop after this change is UNVERIFIED (docs/SMOKE-RESULTS.md W-09).

---

## Open items (require owner decision)

| ID | Item | Default if unanswered |
|----|------|-----------------------|
| O-1 | Copyright holder string in LICENSE (currently `Khumoyun1307`). | Keep as is. |
| O-2 | Default hotkeys conflict check on the owner's own setup. | Keep defaults; user-configurable. |
| O-3 | Whether to add a CODE_OF_CONDUCT.md (Contributor Covenant). | Not added in v1. |
