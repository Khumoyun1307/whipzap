# Contributing to WhipZap

Thanks for helping whip agents into shape. This is a small project; the process is deliberately light.

## Setup

```
git clone https://github.com/Khumoyun1307/whipzap.git
cd whipzap
npm ci
npm start        # launches the tray app
npm test         # unit tests (Vitest)
npm run lint     # ESLint
```

Requirements: Node 20 or newer. On macOS the app needs the Accessibility permission to type; it prompts on first crack. On Linux, X11 and `xdotool` are required; Wayland is not supported yet.

## Where things live

- `docs/` is the specification. Start with `docs/PRD.md` and `docs/ARCHITECTURE.md`.
- `src/main/` is the Electron main process. `src/overlay/` is the transparent overlay renderer. `src/main/helpers/` holds the per-OS scripts that focus a window and type text.
- `assets/messages/default.json` is the built-in message pack. `assets/CREDITS.md` records the provenance of every sound and icon.

## Adding a message

Edit `assets/messages/default.json`. Lines are grouped in three tiers (`mild`, `medium`, `spicy`). Keep each line under 80 characters, printable, single line, teasing the agent only. Never target real people or groups. Run `npm test`; the pack is validated.

## Adding or fixing a platform helper

Read the helper contract in `docs/ARCHITECTURE.md`. A helper receives the text on stdin, prints JSON on stdout, and uses the documented exit codes. It must never send Ctrl-C, Esc, or any control key other than Enter. Add the platform to the manual smoke checklist in `docs/TESTING.md` and say in your PR which checklist items you ran.

## Pull requests

- One topic per PR. Conventional Commit messages (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- `npm test` and `npm run lint` must pass.
- If you change behavior, update the matching section in `docs/`.
- Do not add dependencies without a sentence in the PR explaining why the standard library or Electron cannot do it. No native modules.
- Do not contribute code or assets copied from OpenWhip or other projects with unclear licensing. Sounds and icons must be CC0 with a source link.

## Reporting bugs

Open a GitHub issue with your OS, terminal or editor, the target window title, and the output of running the app with `WHIPZAP_DEBUG=1`.
