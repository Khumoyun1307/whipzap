# WhipZap: standing orders for AI agents

WhipZap is a standalone Electron tray app that lets a user "whip" their AI coding agent: a crack plays a sound, flashes a strike on a transparent overlay, and types a short taunt into the terminal or editor window the user locked as the target. It never interrupts the agent.

## Read order

1. `docs/PRD.md` (what and why, requirement IDs)
2. `docs/ARCHITECTURE.md` (modules, contracts, schemas, platform helpers)
3. `docs/UX.md` (tray, overlay, copy, message pack)
4. `docs/ROADMAP.md` (tasks, status, verification)
5. `docs/TESTING.md`, `docs/DECISIONS.md`, `docs/RESEARCH.md` as needed

If code and docs disagree, the docs are the spec. Fix the code, or update the doc in the same change with a one-line rationale, never silently.

## Hard rules

- Never send Ctrl-C, Esc, or any control key other than Enter to the target window. Ctrl-C twice exits Claude Code. Esc interrupts it. WhipZap is non-interrupting by design (D-1).
- Never type into a window that is not the locked target (D-2). No target means sound and visual only.
- No code, text, sounds, icons, or other assets from OpenWhip or its forks (D-11). Write everything fresh. Only CC0 assets with provenance recorded in `assets/CREDITS.md`.
- No "Claude" in the product name, package name, binary name, icons, or marketing copy (D-10).
- No native Node modules, no node-gyp, no bundler, no TypeScript. Plain ESM JavaScript. OS integration goes through static helper scripts in `src/main/helpers/` spawned with `execFile`; text is passed on stdin, never interpolated into a shell string.
- No network access, no telemetry, no auto-update, no remote content in any window.
- Electron windows: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The overlay only talks to main through the preload allowlist.

## Conventions

- Node >= 20. `npm test` runs Vitest, `npm run lint` runs ESLint. Both must pass before a task is marked Done.
- Keep Electron imports at the edges (`app.js`, `tray.js`, `hotkeys.js`, overlay). Pure modules (`scheduler.js`, `messages.js`, `delivery.js`, `config.js` logic, `target.js` rules) take their dependencies as arguments so they are unit-testable without Electron.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), one task per commit where practical, message body names the roadmap task ID.
- Trunk-based on `main`. No force pushes.
- When you finish a roadmap task, update its status row in `docs/ROADMAP.md` with the verification evidence (command run and result).
- Platform code you cannot execute on the current machine is marked `UNVERIFIED-ON-HARDWARE` in the roadmap status, never claimed as verified.

## Development machine notes

- The maintainer develops on Windows 11 with Windows PowerShell 5.1 (no `pwsh`). Windows helpers must run on 5.1 and can be exercised end to end here (lock Notepad or a terminal, crack, observe text). macOS and Linux helpers are written to the contract and verified by the manual checklist in `docs/TESTING.md`.
- Global Git `core.autocrlf` is on; `.gitattributes` forces LF. Do not commit CRLF files.
