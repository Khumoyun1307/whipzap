# Security

## What WhipZap does

WhipZap simulates keyboard input. When you crack the whip, it brings the window you locked as the target to the foreground and types a short message followed by Enter. That is its whole purpose, and it is also the only sensitive thing it does.

Safeguards:

- Text is only ever typed into the window you explicitly locked. If that window is gone, nothing is typed.
- Only your own actions can lock a window: the crack hotkey, Crack now, Arm whip, Auto mode, and Lock target. A whip-mode flick or an auto-mode timer never picks a new window; if the locked window closes, the whip drops, auto mode stops, and nothing is typed anywhere.
- The helper verifies that the locked window is the foreground window immediately before sending input; otherwise it reports failure instead of typing.
- If the locked window does not look like a terminal or code editor, WhipZap asks you to confirm before locking it.
- The only control key ever sent is Enter. WhipZap never sends Ctrl-C, Esc, shortcuts, or any modifier key, not even a bare Alt tap. `npm run lint:keys` fails the build if such a key appears in the source.
- Messages come from the built-in pack and your own config file. They are passed to the helper script on standard input, never through a shell command line.
- No network access, no telemetry, no auto-update, no remote content. The app works fully offline.
- Electron renderer windows run with context isolation, sandboxing, and no Node integration.

## What it needs from the OS

- Windows: nothing beyond a normal user session.
- macOS: the Accessibility permission (System Settings > Privacy & Security > Accessibility), which is what allows simulated keystrokes.
- Linux: X11 and the `xdotool` package.

The helper scripts are static files shipped in the package (`src/main/helpers/`), spawned without a shell; message text travels on stdin. The config file can change hotkeys, intervals, patterns, and message text, and nothing else: it cannot run commands or add keys other than printable text and Enter.

## Reporting a vulnerability

Open a GitHub issue if the problem is not sensitive. For anything that could let a third party type into a user's windows or run code, use GitHub's private vulnerability reporting on the repository instead of a public issue. Please include your OS and reproduction steps.
