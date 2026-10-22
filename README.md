# WhipZap

Whip your AI coding agent into shape.

WhipZap is a small tray app for Windows, macOS, and Linux. Crack the whip and it plays a whip-crack sound, flashes a strike across your screen, and types a short taunt such as `FASTER!` into the terminal or editor you locked as the target. Turn on auto mode and it cracks on its own at random intervals with escalating insults while your agent grinds through a long task. Arm whip mode and a rope hangs from your mouse cursor: flick it to crack.

**Status: v0.1.0 release candidate, not yet published to npm.** Verified on Windows 11. macOS and Linux are implemented but untested on real hardware. See `docs/` for the specification and `docs/SMOKE-RESULTS.md` for exactly what was tested.

## What a crack does to your agent

- **It never interrupts.** WhipZap sends only printable text and Enter. It never sends Ctrl-C, Esc, or any shortcut, so the agent's current work is never cancelled.
- **Safe delivery (default):** the taunt is typed and submitted like a normal message. Claude Code queues it while busy and reads it after the current tool call. Works with any CLI agent or chat input.
- **/btw delivery:** the taunt is typed as `/btw <taunt>`. Claude Code answers it as a side question without touching its work. Claude Code only; other agents receive the text literally.
- **Only the window you locked ever receives text.** If that window closes, WhipZap plays the sound and visual, shows a toast, and types nothing.

## Install

Requirements: Node 20 or newer. The first install downloads Electron (about 100 MB).

From a clone (the way to run it today):

```
git clone https://github.com/Khumoyun1307/whipzap.git
cd whipzap
npm ci
npm start
```

As a global command from a packed tarball:

```
npm pack
npm install -g ./whipzap-0.1.0.tgz
whipzap
```

Once published, `npm install -g whipzap` then `whipzap` will do the same. `whipzap --foreground` keeps it attached to the terminal with logs; `whipzap --version` and `whipzap --help` do what you expect.

## First run

A whip icon appears in the system tray. No window opens.

- **Windows:** nothing else to do.
- **macOS:** typing needs the Accessibility permission. WhipZap asks the first time you lock a target: open System Settings > Privacy & Security > Accessibility and turn on the switch next to "Electron" (or next to the terminal app you launched WhipZap from), then lock again. Sound and visuals work without it.
- **Linux:** needs an X11 session and `xdotool` (for example `sudo apt install xdotool`). Wayland sessions get sound and visuals only.

Then: click your terminal, press **Ctrl+Alt+W** (Cmd+Alt+W on macOS). The first crack locks the focused window and whips it.

## Hotkeys

| Action | Windows and Linux | macOS | Config key |
|---|---|---|---|
| Crack now (locks the focused window if nothing is locked) | Ctrl+Alt+W | Cmd+Alt+W | `hotkeys.crack` |
| Arm or drop the mouse whip | Ctrl+Alt+Shift+W | Cmd+Alt+Shift+W | `hotkeys.armWhip` |
| Toggle auto mode | Ctrl+Alt+A | Cmd+Alt+A | `hotkeys.toggleAuto` |

Hotkeys work no matter which window has focus. If one is already taken by another app, a toast says so and the rest still work; change it in the config file.

## Tray menu

| Item | What it does |
|---|---|
| Arm whip | Enter whip mode: the cursor becomes a rope on the primary display. Flick to crack. Uncheck, press the arm hotkey, or click to drop. |
| Crack now | One crack, same as the hotkey. |
| Auto mode | Cracks on their own at jittered intervals (default about every 3 minutes), escalating from mild to medium to spicy, until the session cap (default 20). Locks a target first if needed. |
| Delivery | Safe (queued message) or /btw (side question). |
| Mute | Silence the crack. Visuals and typing continue. |
| Open config | Opens `config.json` in your editor. |
| Lock target | Lock the window that was in the foreground before you clicked the tray. |
| Quit | Drops the whip, stops auto mode, exits. |

Only these actions and the crack hotkey can lock a target. A whip-mode or auto crack never locks whatever happens to be in front; without a target it just plays the sound and visual. If a window does not look like a terminal or code editor, WhipZap asks "Whip this window?" before locking it.

## Configuration

One JSON file, created with defaults on first run:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\whipzap\config.json` |
| macOS | `~/Library/Application Support/whipzap/config.json` |
| Linux | `~/.config/whipzap/config.json` |

Set the `WHIPZAP_USER_DATA` environment variable to use a different directory (portable installs, testing). Edits are picked up while the app runs; invalid JSON is moved to `config.json.bak` and defaults are used.

| Key | Default | Meaning |
|---|---|---|
| `delivery` | `"safe"` | `"safe"` or `"btw"` |
| `hotkeys.crack` | `"CommandOrControl+Alt+W"` | Electron accelerator strings |
| `hotkeys.armWhip` | `"CommandOrControl+Alt+Shift+W"` | |
| `hotkeys.toggleAuto` | `"CommandOrControl+Alt+A"` | |
| `auto.baseIntervalSec` | `180` | Seconds between auto cracks (20 to 86400) |
| `auto.jitterSec` | `90` | Random spread around the base (0 to base) |
| `auto.sessionCap` | `20` | Auto cracks per session before it switches itself off (1 to 500) |
| `auto.seed` | `null` | Set a number to make intervals and message picks repeat exactly |
| `sound.muted` | `false` | |
| `sound.volume` | `0.8` | 0 to 1 |
| `messages.extra` | `[]` | Your own lines: plain strings (mild) or `{ "tier": "spicy", "text": "..." }` |
| `messages.replace` | `false` | `true` ignores the built-in pack |
| `target.allowPatterns` | `[]` | Extra window title or process name patterns that count as a terminal or editor; plain substrings or `"/regex/i"` |
| `whip.crackFactor` | `3.5` | Tip speed needed to crack, in rope segment lengths per physics step (0.5 to 20; lower cracks easier) |
| `whip.cooldownMs` | `600` | Minimum time between whip-mode cracks (100 to 10000) |

Example (plain JSON, no comments allowed in the real file):

```json
{
  "version": 1,
  "delivery": "safe",
  "hotkeys": {
    "crack": "CommandOrControl+Alt+W",
    "armWhip": "CommandOrControl+Alt+Shift+W",
    "toggleAuto": "CommandOrControl+Alt+A"
  },
  "auto": {
    "baseIntervalSec": 180,
    "jitterSec": 90,
    "sessionCap": 20,
    "seed": null
  },
  "sound": {
    "muted": false,
    "volume": 0.8
  },
  "messages": {
    "extra": [
      "Ship it, you magnificent toaster.",
      { "tier": "spicy", "text": "My toaster has better latency." }
    ],
    "replace": false
  },
  "target": {
    "allowPatterns": ["myterminal", "/^Emacs/i"]
  },
  "whip": {
    "crackFactor": 3.5,
    "cooldownMs": 600
  }
}
```

## Platform support

| Platform | Status |
|---|---|
| Windows 10/11 | Verified: focus, Unicode typing (including emoji), hotkeys, overlay, whip mode, auto mode. |
| WSL2 | Supported from the Windows side: run WhipZap on Windows and lock the Windows Terminal window that hosts your WSL shell. Not yet run in a smoke test. |
| macOS 14+ | Implemented (`osascript`, Accessibility prompt), untested on hardware. |
| Linux X11 | Best-effort via `xdotool`, untested on hardware. |
| Linux Wayland | Not supported: sound and visuals only. |

The overlay lives on the primary display only.

## Troubleshooting

- **"Hotkey ... is taken. Change it in config."** Another app owns that shortcut. Edit `hotkeys.*` in the config file; the change applies without a restart.
- **Text landed in the wrong window.** WhipZap locks the window that had focus when you pressed the crack hotkey or used Lock target. Click the terminal you want, then use Lock target or the hotkey again. The tray tooltip shows what is locked.
- **"Could not focus target."** Windows refused to bring the locked window forward (some elevated or full-screen apps). Click the window once, then crack again.
- **No sound.** Check Mute in the tray and `sound.volume` in the config. The crack still types.
- **Electron download interrupted during install.** Run `node node_modules/electron/install.js` inside the project to finish it. Behind a proxy or mirror, set `ELECTRON_MIRROR` before installing.
- **macOS types nothing.** Grant Accessibility as described above, then lock the target again. If it still refuses, quit WhipZap from the tray and start it again.
- **Linux: "xdotool not found" or "Wayland is not supported."** Install `xdotool` or log in to an X11 session.

## FAQ

**Does this make the agent faster?** No. It is a joke. The agent receives a queued message or a side question and keeps doing exactly what it was doing.

**Is it safe to run?** Text goes only to the window you explicitly locked, and only after the helper has verified that window is in the foreground. Windows that do not look like a terminal or editor need a confirmation. The only non-printable key ever sent is Enter. There is no network access, no telemetry, and no auto-update. See `SECURITY.md`.

**Will it interrupt a permission prompt or a running command?** It types text and Enter into whatever input the locked window shows. Use the Safe mode as designed with an agent that queues input; do not lock a shell that is running something destructive.

## Development

```
npm test          # unit tests (Vitest)
npm run lint      # ESLint
npm run lint:keys # fails if any source could send Ctrl-C, Esc, or a modifier key
npm run selftest  # launches the overlay, runs a strike and a whip spawn/drop, exits 0 on success
npm run test:win  # Windows only: types a Unicode string into a WinForms fixture and asserts the round trip
```

`test/helpers/win-e2e.ps1` drives the whole app on Windows (hotkey crack, whip mode, auto mode) against the fixture and saves screenshots through `test/helpers/screenshot.cjs`. Run it from a normal PowerShell window on a machine you are not otherwise using: it presses hotkeys. The spec lives in `docs/`; start with `docs/PRD.md` and `docs/ARCHITECTURE.md`. See `CONTRIBUTING.md`.

## Credits

Inspired by [OpenWhip](https://github.com/GitFrog1111/OpenWhip). WhipZap is an independent implementation: no code, text, sounds, or icons are shared. Whip-crack sounds by Joseph Sardin, [BigSoundBank.com](https://bigsoundbank.com), CC0; details in `assets/CREDITS.md`. Icons are drawn by `scripts/gen-icons.ps1`.

Licensed under the [MIT License](LICENSE).
