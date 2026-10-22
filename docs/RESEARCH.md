# WhipZap Research Notes

Status: Reference, frozen at discovery / Last updated 2026-10-21 / Owner: project lead (Khumoyun1307)

Purpose: capture what was learned about OpenWhip and about Claude Code's input behavior so that implementing agents do not re-research it, and do not reintroduce behaviors (Ctrl-C, unguarded typing) that were deliberately rejected. Platform-integration research (Windows foreground rules, Electron APIs, macOS Accessibility, xdotool) lives in docs/ARCHITECTURE.md.

Items marked UNVERIFIED were not confirmed against primary sources and must not be relied on without checking.

Hard rule for agents: do not fetch or read OpenWhip source code as an implementation reference (D-11). This document contains everything needed.

---

## 1. OpenWhip

Repository: https://github.com/GitFrog1111/OpenWhip (data gathered 2026-10-21).

### 1.1 What it is

A joke standalone Electron desktop tray application, originally published as "badclaude", renamed to OpenWhip on 2026-04-14 after the author reported pressure from Anthropic over the name. It is not a Claude Code plugin, hook, or editor extension and never communicates with Claude Code through any API. It works against any focused window; the author markets it as whipping "any CLI coding agent".

### 1.2 Mechanics

| Aspect | Behavior |
|--------|----------|
| Trigger | Clicking the tray icon shows a transparent, frameless, always-on-top, non-focusable, primary-display-sized overlay and spawns the whip. A second tray click or any mouse-down on the overlay drops it. |
| Focus handling | After showing the overlay it sends one Alt+Tab (Windows via FFI `keybd_event`), Cmd+Tab (macOS via `osascript`), or `xdotool key alt+Tab` (Linux) so focus returns to the previous window. |
| Whip | A multi-segment Verlet rope pinned to the cursor, drawn on a canvas with bend limits and wall bounces. Cursor hidden. |
| Crack detection | Rope tip velocity above a per-frame threshold, with a short grace period after spawn and a cooldown between cracks. Threshold is per frame, so cracks are easier on high-refresh displays (reported issue). |
| On crack | Plays one of five MP3s (all identical size, likely the same clip) through an HTML `Audio` element, then sends a keyboard macro to the focused window. |
| Macro | Ctrl-C, then a taunt, then Enter. Windows: `user32.dll` `keybd_event` via the `koffi` FFI module, ASCII only. macOS: `osascript` System Events (`key code 8 using {control down}`, then `keystroke`, then Return); needs Accessibility permission with no in-app prompt. Linux: `xdotool key ctrl+c`, `xdotool type`, `xdotool key Return`; X11 only. |
| Effect on the agent | Not cosmetic. Ctrl-C aborts the agent's current turn (and in Claude Code a second Ctrl-C exits the app), then the taunt is submitted as a new user prompt. |

Message strings in source (weighted, 7 entries; README says 5): `FASTER` (three times), `GO FASTER`, `Faster CLANKER`, `Work FASTER`, `Speed it up clanker`.

### 1.3 Install and shape

- `npm install -g openwhip` then `openwhip`; npm 1.1.0 is the only published version (2026-04-14). Predecessor package `badclaude` 1.0.0 to 1.0.2.
- Dependencies: `electron ^33`, `koffi ^2.9` (FFI, used on Windows). Node 18 or later.
- About 770 hand-written lines: `main.js` (~290), `overlay.html` (~450), `preload.js`, two `bin/` launchers.
- No configuration, no modes, no tests, no CI, no LICENSE file, no plugin manifest, no hooks. The only knobs are constants at the top of the overlay source and the hardcoded phrase array.
- 13 commits between 2026-04-04 and 2026-05-27; no tags or releases; zero external pull requests merged. Effectively unmaintained.

### 1.4 Limitations and issue themes (about 70 issues and PRs, 61 open)

1. Keystrokes go to whatever window is focused: SSH sessions, database consoles, chat apps. The dominant complaint; forks warn about it in their READMEs.
2. Primary display only; multi-monitor overlay missing.
3. macOS: earlier versions sent Cmd+C leaving a stray `c`; Accessibility permission required with no prompt; tray icon sizing problems; overlay not shown over full-screen iTerm2.
4. Linux: early packages excluded Linux entirely; X11 and `xdotool` only, Wayland unsupported (unmerged PRs for `ydotool` and `wtype`).
5. WSL2 unsupported (the app tried to run Electron inside WSL).
6. Physics tied to refresh rate.
7. Windows typing is ASCII only.
8. Documentation drift (message count, typos).
9. No editor-extension integration (an unmerged PR added a VS Code extension).
10. Trust concerns: roadmap items mentioning a crypto miner and a promoted token.
11. Critiques that interrupting mid-task wastes tokens and that pressure prompts do not make the agent faster.

Unmerged community PRs show the demanded features: sound-only mode, configurable target-agent profiles, phrase editor with persistence and Unicode, per-whip consent, multi-display support.

### 1.5 License situation

- `package.json` declares `"license": "MIT"`; the repository contains no LICENSE file; GitHub reports no license.
- Sounds, icons, and images carry no provenance or license notes.
- For WhipZap: no code, text, or assets are copied (D-11), so no attribution is legally required. The README credits OpenWhip as inspiration as a courtesy.
- The original name "badclaude" drew a cease-and-desist (per the author's posts, UNVERIFIED beyond those posts). WhipZap avoids "Claude" in its name (D-10).

### 1.6 Community reception

- About 3,800 stars, about 340 forks at 2026-10-21. Launch video reported at several million views within days.
- Liked: the humor, the rope physics, the "clanker" phrasing.
- Criticized: wrong-window keystrokes, token waste from interruptions, the crypto roadmap items, missing Wayland/WSL/multi-monitor support, abandoned PRs.
- Notable forks and relatives: a "wand" variant that sends encouraging messages instead of taunts; a multi-display fork with a whip counter; a fork with a phrase editor and Unicode typing; a thin Claude Code plugin wrapper that launches the Electron app (plugin dependency install does not run Electron's post-install download, so it needed a workaround script); a derivative that cracks on AirPods head motion.

### 1.7 What WhipZap takes from this

Keep: tray app shape, transparent overlay with rope physics, crack sound, big dumb taunts, one-command npm install.

Fix: window targeting with lock and sanity check; never interrupt; Unicode typing on Windows; macOS permission onboarding; Linux `xdotool` presence check with clear message; WSL2 via Windows; refresh-rate-independent crack detection; configuration file; license file and asset provenance.

---

## 2. Claude Code input behavior (verified against official docs, 2026-10-21)

Sources: https://code.claude.com/docs/en/interactive-mode.md, https://code.claude.com/docs/en/how-claude-code-works.md, https://code.claude.com/docs/en/hooks.md, https://code.claude.com/docs/en/keybindings.md, https://code.claude.com/docs/en/vs-code.md, https://code.claude.com/docs/en/statusline.md, https://code.claude.com/docs/en/plugins/mods/overview.md.

### 2.1 Typing while the agent works

| Action | Behavior | Source |
|--------|----------|--------|
| Type text, press Enter while Claude is working | Message is queued, not an interrupt. Delivered after the current tool calls, within the same turn. Slash commands in the queue wait until the turn ends. | interactive-mode.md |
| Esc | Interrupts the current turn. Draft input is kept; queued items are sent next. | interactive-mode.md |
| Ctrl-C | Clears the input once; pressed twice exits Claude Code. | interactive-mode.md (UNVERIFIED exact wording; behavior consistent across versions) |
| Ctrl+Enter (`chat:sendNow`, v2.1.275+) | Sends the queue now and interrupts if Claude is writing or running non-backgroundable work. | keybindings.md |
| Ctrl+X Enter (`chat:queueSubmit`, v2.1.247+) | Queues, never interrupts. | keybindings.md |

Consequence: Safe mode (text plus Enter) is already the non-disruptive channel. No special key sequence is needed.

### 2.2 `/btw`

- A side question answered from the current context. No tools are run, the exchange is not added to history, and it runs while Claude is working without interrupting. It is not a steering channel and cannot change what the agent is doing.
- In the VS Code extension `/btw` opens a panel (extension v2.1.227+).
- Introduction version: UNVERIFIED.

Consequence: btw mode is a harmless "get a funny reply" channel, Claude Code only. In other hosts, `/btw` is just text that may be ignored or produce an unknown-command message.

### 2.3 Things WhipZap deliberately does not use

| Surface | Why not |
|---------|---------|
| Hooks (33 events; several accept `additionalContext`; `Stop` can keep Claude working) | Would make WhipZap a plugin and require per-user hook configuration. Could report working/idle state; parked as a v2 idea (D-4). |
| Keybindings (`~/.claude/keybindings.json`) | Fixed action namespace; no action sends arbitrary text or runs a slash command. |
| Status line | Display only, about 1 Hz refresh, no input path. |
| Mods (panes, bands, toasts, `/command` with `immediate:true`, timers) | A plugin surface; WhipZap is standalone by decision. |
| Plugins and marketplaces | Out of scope by decision. |

### 2.4 Editor extension notes

- The VS Code extension shares hooks and MCP settings with the CLI, has a chat input panel, and shows `/btw` as a panel. Typing into the extension's input works the same way as any text field once it has focus.
- Keybindings and status line in the extension: UNVERIFIED.
- JetBrains extension: inferred to behave like a terminal host; UNVERIFIED.

### 2.5 Other CLI agents

Safe mode sends plain text plus Enter, which every interactive CLI accepts as a prompt. Whether the text queues or interrupts depends on the host (Codex, opencode, Gemini CLI behaviors UNVERIFIED). None of them is harmed by plain text input. btw mode is meaningless outside Claude Code.

---

## 3. What this means for WhipZap: hard rules

1. Never send Ctrl-C. In Claude Code two presses exit the app; elsewhere it is a kill signal.
2. Never send Esc. It interrupts the agent's turn, which is the behavior the owner rejected (D-1).
3. The only control key WhipZap ever synthesizes is Enter. Everything else is printable text.
4. Only type into the locked target after confirming it is the foreground window (D-2). Never type into "whatever is focused".
5. Message text must not contain newlines; a newline would submit a partial message.
6. Do not depend on Claude Code internals, hooks, keybindings, or plugins. WhipZap must work when Claude Code is replaced by any other terminal program.
7. Label btw mode as Claude Code only.
8. Do not copy OpenWhip code or assets; do not read its source as a reference (D-11).

---

## 4. Related projects (for README "see also" and differentiation)

| Project | Relation |
|---------|----------|
| OpenWhip | Inspiration. Keystroke-injecting Electron tray app. |
| Encouraging "wand" fork | Positive-message variant; suggests a future themed pack. |
| Claude Code sound and notification hook plugins | Play sounds on hook events; different category (plugin, event-driven, no typing). |
| AirPods motion whip derivative | Gesture input; aligns with the [FUTURE] camera-gesture idea. |
