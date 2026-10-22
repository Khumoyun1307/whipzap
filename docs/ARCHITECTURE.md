# WhipZap Architecture

Status: Approved for implementation
Last updated: 2026-10-21
Owner: Technical lead (architecture decisions require a DECISIONS.md entry to change)

This document is the implementation contract. An agent implementing WhipZap must be able to build every module from this file plus `UX.md` without asking a human. Where a detail is marked [ASSUMED], implement it as written and record any deviation in `DECISIONS.md`. Where a detail is marked UNVERIFIED, implement the primary approach and the stated fallback, and verify on real hardware in the milestone that owns it (see `ROADMAP.md`).

## 1. Overview

WhipZap is a standalone Electron tray application. It plays a whip-crack sound, draws a strike on a transparent full-screen overlay, and types a short taunt into one locked terminal or editor window. It never interrupts the agent: the only keys it ever emits are printable text and Enter.

Three triggers share one crack routine:

| Trigger | Source | Visual |
|---|---|---|
| Instant crack | Global hotkey or tray "Crack now" | Strike flash |
| Whip mode | Mouse-swing rope on the overlay | Rope + crack flash at tip |
| Auto mode | Seeded jittered timer | Strike flash |

### 1.1 Hard constraints (from D-1, D-2, D-5, D-9, D-11)

1. Never send Ctrl-C, Esc, or any control or modifier combination to the target. The only key events WhipZap ever synthesizes are Unicode text events and Enter. No modifier key, including a bare Alt tap, is ever synthesized (D-13): a lone Alt press activates menu bars in some applications.
2. Text is sent only to the locked target window, and only after the helper has verified that the target is the foreground window.
3. No network access, no telemetry, no auto-update, no remote content. The app reads only its own package files and its config file.
4. No native Node modules. OS integration is via shell helpers spawned with `child_process.execFile`.
5. No code or assets from OpenWhip. Independent implementation of a shared idea.
6. Plain JavaScript (ESM), Node >= 20, Vitest, ESLint flat config. No TypeScript, no bundler.

### 1.2 Non-goals for v1 (D-9) [APPROVED]

Camera gestures, Claude Code hooks or any agent-state detection, themed message packs, per-agent profiles, Wayland, installers, multi-monitor overlay, interrupt delivery, telemetry, auto-update.

## 2. Process model

```
+--------------------------------------------------------------+
| Electron main process (src/main/app.js)                      |
|  tray.js  hotkeys.js  config.js  target.js  crack.js         |
|  scheduler.js  messages.js  delivery.js  platform/*.js       |
|         |                               |                    |
|         | IPC (contextBridge)           | execFile            |
|         v                               v                    |
| Overlay renderer (src/overlay/*)   Helper processes          |
|  overlay.html overlay.js rope.js    src/main/helpers/win/    |
|  strike.js audio.js                 src/main/helpers/mac/    |
|  (sandbox on, contextIsolation on)  src/main/helpers/linux/  |
+--------------------------------------------------------------+
```

1. **Main process** owns all state, the tray, hotkeys, config, the scheduler, and target management. It is the only process that spawns helpers.
2. **Overlay renderer** is a single `BrowserWindow` loading `src/overlay/overlay.html` from disk. It draws visuals, plays audio, and runs the rope simulation. It has no Node access. It talks to main only through the channels in section 3.
3. **Preload** (`src/preload.js`) exposes a minimal `window.whipzap` bridge via `contextBridge.exposeInMainWorld`.
4. **Helpers** are static scripts shipped in the package under `src/main/helpers/<os>/`. On Windows the helper is one long-lived worker process (`worker.ps1`) started at app launch and restarted on crash, because compiling the inline C# costs seconds on first start (D-12). On macOS and Linux each helper run is one short-lived process: one invocation per crack, plus one per lock or permission check.
5. **CLI launcher** (`bin/whipzap.js`) resolves the Electron binary from the `electron` dependency and spawns it detached with the app directory as the argument, then exits. `whipzap --foreground` keeps it attached for debugging [ASSUMED].

### 2.1 Overlay window options

```js
new BrowserWindow({
  x: primary.bounds.x, y: primary.bounds.y,
  width: primary.bounds.width, height: primary.bounds.height,
  transparent: true, frame: false, hasShadow: false,
  alwaysOnTop: true, focusable: false, skipTaskbar: true,
  resizable: false, movable: false, minimizable: false, maximizable: false,
  show: false,
  webPreferences: {
    preload: path.join(appRoot, 'src/preload.js'),
    contextIsolation: true, nodeIntegration: false, sandbox: true,
    backgroundThrottling: false,
  },
});
win.setAlwaysOnTop(true, 'screen-saver');
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); // macOS/Linux only
win.setIgnoreMouseEvents(true, { forward: true });
```

Rules:

1. Primary display only (`screen.getPrimaryDisplay()`), re-bounded on `screen` `display-metrics-changed`.
2. Hidden (`win.hide()`) whenever no visual is active, so an idle WhipZap costs no GPU. Shown just before a strike or whip spawn, hidden 200 ms after the last animation ends.
3. `setIgnoreMouseEvents(true, { forward: true })` while not in whip mode. In whip mode, `setIgnoreMouseEvents(false)` so the overlay sees mouse moves and clicks; the canvas paints a `rgba(0,0,0,0.004)` full-screen fill each frame so Windows hit-tests the window. Mouse moves verified reaching the overlay on Windows 11 (2026-10-21).
4. `focusable: false` except while the whip is armed (D-15). Verified on Windows 11: a non-activatable window receives mouse moves but no button presses, so `setMouseMode(true)` calls `win.setFocusable(true)` and `win.focus()`, and `setMouseMode(false)` restores `focusable: false`; app.js then re-focuses the locked target through the helper on drop. Outside whip mode the overlay never becomes the foreground window (`showInactive()`), so the helper never sees it as the target. Click-to-drop after this change is UNVERIFIED (see docs/SMOKE-RESULTS.md W-09). On Linux, `focusable` is not supported; `win.blur()` after show [ASSUMED].
5. `type: 'panel'` and `'toolbar'` window types are not used; `screen-saver` level is sufficient for showing above full-screen apps on macOS when combined with `visibleOnFullScreen: true`. Shows over the macOS Dock and Windows taskbar.

## 3. IPC contract

All channels are strings prefixed `overlay:`. Payloads are plain JSON objects. Main sends with `win.webContents.send`; the overlay sends with `ipcRenderer.send` through the bridge. No `invoke` is used.

### 3.1 Main to overlay

| Channel | Payload | Effect |
|---|---|---|
| `overlay:strike` | `{ message: string, tier: 'mild'\|'medium'\|'spicy', seed: number }` | Run the strike-flash animation and show the message (UX.md section 6). `seed` selects the lash angle deterministically. |
| `overlay:spawnWhip` | `{ seed: number }` | Enter whip mode: show cursor-less rope, enable mouse. |
| `overlay:dropWhip` | `{}` | Rope falls off-screen then overlay reports `overlay:dropped`. |
| `overlay:toast` | `{ text: string, ms: number }` | Bottom-centre toast (UX.md section 8). |
| `overlay:playSound` | `{ file: string, volume: number }` | Play `assets/sounds/<file>` at volume 0..1. `file` is a bare name validated by main against the shipped list. |
| `overlay:setReduceMotion` | `{ enabled: boolean }` | Mirror of `nativeTheme`/`prefers-reduced-motion`; overlay shortens animations. |

### 3.2 Overlay to main

| Channel | Payload | Meaning |
|---|---|---|
| `overlay:cracked` | `{ tipSpeed: number }` | Rope tip exceeded crack threshold. Main runs the crack routine with `source: 'whip'`. |
| `overlay:dropped` | `{}` | Drop animation finished. Main hides the overlay and leaves whip mode. |
| `overlay:clicked` | `{}` | Mouse down while in whip mode. Main treats it as "drop whip". |
| `overlay:animationIdle` | `{}` | No animation running. Main may hide the window. |
| `overlay:ready` | `{}` | Renderer loaded. Main sends initial `overlay:setReduceMotion`. |

### 3.3 Preload bridge

```js
contextBridge.exposeInMainWorld('whipzap', {
  on(channel, fn)   // allowlisted channels from 3.1 only
  send(channel, payload) // allowlisted channels from 3.2 only
  soundUrl(file)    // returns 'whipzap-asset://sounds/<file>' (see 3.4)
});
```

Unknown channels throw in preload. The renderer never receives Node objects.

### 3.4 Asset access

Sounds and fonts are served to the sandboxed renderer through a custom `protocol.handle('whipzap-asset', ...)` registered as privileged (`standard: true, secure: true, supportFetchAPI: true`) before `app.whenReady`. The handler resolves only paths under `assets/` and rejects `..`. This avoids `file://` restrictions with `sandbox: true` [ASSUMED, verify in M3; fallback is `loadFile` plus relative `file://` URLs with `webSecurity` left on, which Chromium permits for same-directory media].

## 4. Modules

All modules are ESM. Each exports pure functions where possible and keeps Electron imports at the edge so Vitest can test logic without Electron. Signatures below are the public surface; private helpers are free.

### 4.1 `src/main/app.js`

Entry point. Order of operations:

1. `app.setName('whipzap')` (keeps `userData` stable when run via the prebuilt Electron binary) [ASSUMED].
2. Request single instance lock; second instance shows toast on the first and exits.
3. `protocol.registerSchemesAsPrivileged` for `whipzap-asset`.
4. `await app.whenReady()`.
5. `config = await loadConfig()`; `platform = selectPlatform()`; `await platform.isSupported()` → on failure show native error dialog and continue with typing disabled (visuals and sound still work).
6. Create overlay window, tray, register hotkeys, create scheduler.
7. Wire events (section 5).
8. `app.on('window-all-closed', e => {/* keep running, tray app */})`.

```js
/** @returns {AppState} */ export function getState()
```

### 4.2 `src/main/config.js`

```js
export const DEFAULT_CONFIG                      // frozen object, section 9
export function configPath(userDataDir)          // `${userDataDir}/config.json`
export function validateConfig(obj)              // returns { config, warnings: string[] } merging defaults (pure)
export async function loadConfig({ configPath, fs })
   // returns { config, warnings }
   // missing → write DEFAULT_CONFIG and return it
   // invalid JSON → rename to config.json.bak, write defaults, return defaults with a warning
   // validation warnings → per-key fallback, warnings[] non-empty
export async function saveConfig({ configPath, fs }, config)   // atomic write (tmp + rename)
export function watchConfig({ configPath, fs }, onChange)      // fs.watch with 300 ms debounce; onChange(loadResult); returns { close() }
```

Tray changes (delivery, mute) call `saveConfig`; the watcher ignores writes it caused (compare serialized content).

### 4.3 `src/main/messages.js`

```js
export function validatePack(pack)                     // schema section 10; returns { errors: string[] }
export function mergePacks(builtin, extra, replace)    // returns { pack, warnings }; replace=true → only extra (fallback to builtin for empty tiers, with a warning)
export function loadPack(builtinPack, messagesConfig)  // validates + merges config.messages; returns { pack, warnings }
export function tierForCount(count)                    // 0-4 'mild', 5-11 'medium', 12+ 'spicy'
export function pickMessage(pack, tier, rng, lastMessage) // rng() in [0,1); never returns lastMessage when the tier has >1 entry; throws on unknown tier
```

Length rules: built-in pack lines are at most 80 characters (validated by MSG tests); user extras are accepted up to 200 characters; `sanitizeForTyping` caps the final typed text at 200.

### 4.4 `src/main/delivery.js`

```js
export function formatForDelivery(message, mode)
   // trims; 'safe' → message (a leading "/" gets a leading space so it is not read as a slash command);
   // 'btw' → `/btw ${message}`; throws on unknown mode, empty message, or any \r \n
export function sanitizeForTyping(text)
   // strips \r \n \t and all C0/C1 control chars, trims, collapses internal whitespace, caps at 200 chars
```

`sanitizeForTyping` is the last gate before the helper. It guarantees that nothing resembling a control sequence reaches the target even from a malicious config.

### 4.5 `src/main/target.js`

```js
/** @typedef {{ id: string, title: string, processName: string, pid: number }} WindowInfo */
export const DEFAULT_ALLOW_PATTERNS                      // section 9 list
export function matchesAllowPatterns(info, patterns)     // case-insensitive substring or "/regex/i" match on processName then title (pure)
export function decideSanity(info, patterns)             // 'allow' | 'confirm' (pure)
export function isSelf(info, { pid, titles })            // true for WhipZap's own pid or window titles (pure)
export function createTargetStore({ platform, confirm, selfPid })
   // returns { lockForeground(), get(), clear(), exists(), set(info) }
   // lockForeground(): info = await platform.getForegroundWindow() (Windows: platform.lastForeground, see below)
   //   isSelf → { ok:false, reason:'self' }
   //   decideSanity === 'confirm' → await confirm(info); false → { ok:false, reason:'declined' }
   //   helper error → { ok:false, reason:'error' }
   //   else set(info) → { ok:true, target: info }
   // exists(): await platform.getWindowInfo(id); HelperError code 3 → false
```

Lock points (D-14: this list is exhaustive; nothing else may lock):

1. Hotkey "arm whip" and hotkey "toggle auto" with no target: lock the window that is foreground at the moment of the keypress.
2. Tray "Arm whip", "Lock target", "Auto mode", "Crack now" with no target: lock from the tray path described in item 4.
3. Hotkey "Crack now" with no target: lock first (the foreground window at keypress), then crack.
4. Tray path per OS. On Windows, clicking the tray gives the taskbar (explorer.exe) the foreground, so `win.js` keeps a `lastForeground` value by polling the warm worker every 1000 ms, ignoring WhipZap's own pid and `explorer.exe`; tray locks use `platform.lastForeground`. On macOS and Linux, menu bar extras and tray menus do not activate the app, so the foreground is read at menu-click time.

### 4.6 `src/main/crack.js`

```js
/**
 * @param {object} deps {
 *   platform, targets (target store), pack, rng, state,
 *   delivery: formatForDelivery,
 *   audio: { play(file, volume) },
 *   overlay: { strike({ message, tier, prefix }) },   // prefix is '/btw' in btw mode, '' otherwise
 *   toast(text, ms), clock: { now(), sleep(ms) }, log, sounds: string[]
 * }
 * @returns {{ crack({ source }) }}  source: 'hotkey'|'whip'|'auto'|'tray'
 *   crack resolves { typed: boolean, message: string, tier: string, skipped?: 'busy' }
 */
export function createCrack(deps)
```

Sequence (section 5.2). The function is re-entrant-safe: a busy guard drops overlapping requests within 300 ms and returns `{ skipped: 'busy' }`.

Tier rule: `hotkey` and `tray` → `mild`; `whip` → `medium`; `auto` → `tierForCount(state.autoCount)`. While auto mode is on, every crack from any source increments `state.autoCount` and uses `tierForCount(state.autoCount)` (D-4, decided in M5-T4).

### 4.7 `src/main/scheduler.js`

```js
// src/main/prng.js
export function mulberry32(seed)        // returns rng() in [0,1)
export function createRng(seed)         // { next() } wrapper around mulberry32

// src/main/scheduler.js
export function createScheduler({
  config: { baseIntervalSec, jitterSec, sessionCap, seed },   // seed null → Date.now() based
  clock: { now, setTimeout, clearTimeout },
  rng,                                                        // optional; default createRng(seed)
  onFire({ count, tier }),                                    // count is 1-based; awaited
  onStop({ reason }),                                         // 'cap' | 'user'
})
   // returns { start(), stop(), pause(), resume(), isRunning(), state() }
   // state() → { running, paused, count, nextAt, seed, tier }
   // delay = clamp(base + (rng()*2-1)*jitter, 20, Infinity) seconds; first fire one full delay after start()
   // after the sessionCap-th fire → stop() and onStop({ reason: 'cap' }) exactly once
```

Timers come from the injected `clock` so Vitest fake timers drive it. The scheduler never touches Electron.

### 4.8 `src/main/hotkeys.js`

```js
export function registerHotkeys(globalShortcut, accelerators, handlers)
   // returns { failed: string[] } for accelerators that returned false
export function unregisterAll(globalShortcut)
```

Failed registrations produce a toast "Hotkey <accel> is taken" and a log line. The tray still works.

### 4.9 `src/main/tray.js`

```js
export function buildMenuTemplate(state, handlers) // pure: returns Electron MenuItemConstructorOptions[]
export function createTray(nativeImage, state, handlers) // returns { tray, refresh() }
```

`refresh()` rebuilds the context menu from state after every transition. Icon chosen by state (UX.md section 2).

### 4.10 `src/main/platform/index.js`

```js
export function createPlatform(platformName = process.platform)
   // 'win32' → createWindowsPlatform(), 'darwin' → createMacPlatform(), 'linux' → createLinuxPlatform(), else unsupported stub
export { HelperError, HELPER_CODES } from './errors.js'
```

### 4.11 Platform adapters (contract)

Every adapter returns an object with the same surface (verified implementation in `win.js`). Failures reject with `HelperError { code, message }` from `src/main/platform/errors.js`, where `code` is from the table in section 6.1.

```js
{
  name,                                   // 'win32' | 'darwin' | 'linux'
  async isSupported(),                    // { ok: boolean, reason?: string }   never throws
  async checkPermissions({ prompt }),     // { ok: boolean, message?: string }  never throws
  async start(), async stop(),            // optional lifecycle; Windows starts/stops the worker
  async getForegroundWindow(),            // WindowInfo { id: string, title, processName, pid }
  async getWindowInfo(id),                // WindowInfo; throws HelperError code 3 when the window is gone
  async focusWindow(id),                  // true if verified foreground after focus, false if refused (code 5)
  async typeText(id, text, { pressEnter }), // resolves when typed (and Enter pressed); throws HelperError
  async openAccessibilitySettings(),      // macOS only; no-op elsewhere
  lastForeground,                         // Windows only: WindowInfo from the 1000 ms poll (section 4.5)
}
```

There is no `listWindows`, no separate `pressEnter`, and no `windowExists`: `typeText` presses Enter in the same helper call, and `getWindowInfo` throwing code 3 is the existence check.

`typeText` must itself verify that `id` is the foreground window immediately before sending input and must abort with code 3 or 5 if not. This is the second safety gate for D-2 and is enforced inside the helper, not only in JavaScript.

### 4.12 Overlay modules

| File | Exports | Notes |
|---|---|---|
| `overlay.js` | bootstrap: listens on bridge, owns the single `requestAnimationFrame` loop, routes to strike/rope/toast layers | Hides canvas layers when idle; posts `overlay:animationIdle`. |
| `rope.js` | `createRope(opts)`, `step(rope, mouse, dtMs)`, `draw(rope, ctx)`, `tipSpeed(rope, dtMs)` | Pure simulation, testable in Node with a stub ctx. |
| `strike.js` | `createStrike(seed, w, h)`, `step(strike, dtMs)`, `draw(strike, ctx)` | 600 ms lash plus 1200 ms message. |
| `audio.js` | `play(url, volume)` | `new Audio(url)`; pre-creates one element per file on `overlay:ready`. |

## 5. State and events

### 5.1 AppState

```js
{
  target: null | TargetInfo,
  whipArmed: boolean,
  autoOn: boolean,
  autoCount: number,
  delivery: 'safe' | 'btw',
  muted: boolean,
  typingAvailable: boolean,   // false when platform unsupported or permission missing
}
```

| Transition | Trigger | Preconditions | Effects |
|---|---|---|---|
| lock | hotkey crack, hotkey armWhip, hotkey toggleAuto, tray Crack now, Arm whip, Auto mode, Lock target (each only when no target is set). Never a whip-mode or auto crack (D-14) | foreground is not self | `target` set; toast "Target locked: <title>"; tray icon → locked |
| unlock | target verify fails during crack (any source) | | `target=null`; toast "Target window closed"; autoOn → false; whipArmed → false (whip dropped) |
| arm | hotkey armWhip, tray Arm whip | not armed | lock if needed; `whipArmed=true`; scheduler.pause(); overlay spawnWhip; icon → armed |
| drop | hotkey armWhip, tray Arm whip (uncheck), overlay click, overlay dropped | armed | `whipArmed=false`; scheduler.resume(); icon → locked or idle |
| crack | hotkey crack, tray Crack now, overlay cracked, scheduler fire | not already cracking | section 5.2 |
| autoOn | hotkey toggleAuto, tray Auto mode | target locked (else lock first) | `autoOn=true`, `autoCount=0`, scheduler.start(); toast "Auto mode on" |
| autoOff | hotkey toggleAuto, tray, cap reached, unlock | autoOn | scheduler.stop(); toast "Auto mode off" or "Auto session cap reached (N)" |
| delivery | tray radio | | `config.delivery` saved |
| mute | tray checkbox | | `config.sound.muted` saved; toast "Muted"/"Unmuted" |
| configReload | file watcher | | re-validate; re-register hotkeys if changed; rebuild pack; toast "Config reloaded" or "Config invalid, using defaults" |

The tray menu reflects every field (UX.md section 3). The tray icon reflects `target`, `whipArmed`, `autoOn`.

### 5.2 Crack routine (timing)

```
t=0      crack({source}) called
         if busy (within 300 ms of a crack start) → return {typed:false, skipped:'busy'}
         tier = state.autoOn ? tierForCount(state.autoCount) : (source==='whip' ? 'medium' : 'mild')
         message = pickMessage(pack, tier, rng, lastMessage)
         text = sanitizeForTyping(formatForDelivery(message, state.delivery))
t=0      if !muted: audio.play(pick(sounds), volume)
t=0      overlay.strike {message, tier, prefix}                  (whip source: overlay shows crack flash itself)
t=0      if !targets.get(): toast "No target locked" ; return {typed:false}
         if !(await targets.exists()): targets.clear(); toast "Target window closed"; auto off; return {typed:false}
t=0      ok = await platform.focusWindow(target.id)               (helper verifies foreground)
         if !ok: toast "Could not focus target"; return {typed:false}   (target kept)
t≈+150ms await clock.sleep(150)
         await platform.typeText(target.id, text, { pressEnter: true })
         on HelperError code 2 → typingAvailable=false; toast "Accessibility permission required"
         on code 3 → targets.clear(); toast "Target window closed"
         on code 4 → toast with reason ("Wayland is not supported" / "xdotool not found")
         on code 5 → toast "Could not focus target"
         on other → toast "Typing failed"; log
         if state.autoOn: state.autoCount++
t≈+150ms+len*12ms  resolve {typed:true}
t=+1800ms overlay hides when animationIdle (strike 600 ms + message 1200 ms)
```

Sound and visual never wait for the helper. If a helper request takes longer than 5 s, the crack resolves with `typed:false` and toast "Typing failed"; on Windows the worker is restarted, on macOS and Linux the one-shot process is killed.

## 6. Platform helpers

### 6.1 Invocation contract

| Item | Rule |
|---|---|
| Location | `src/main/helpers/<os>/` resolved relative to `platform/<os>.js`. Never written to at runtime. Windows: `win/worker.ps1`. macOS: `mac/helper.sh`. Linux: `linux/helper.sh`. |
| Windows spawn | One long-lived worker (D-12): `spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', worker.ps1], { windowsHide: true })`, started by `platform.start()` at app launch, restarted on exit. Protocol: one JSON request per line on stdin, one JSON response per line on stdout, strictly in order. Requests: `{"op":"ping"}`, `{"op":"foreground"}`, `{"op":"info","id"}`, `{"op":"focus","id"}`, `{"op":"type","id","text","enter"}`, `{"op":"quit"}`. Per-request timeout 5 s; start timeout 15 s. |
| macOS and Linux spawn | One short-lived process per command: `child_process.execFile('/bin/sh', [helper, command, ...args], { timeout: 5000, maxBuffer: 64 KiB })`. |
| Text input | Windows: the `text` field of the JSON request (UTF-8 stdin). macOS and Linux: raw text on stdin. Never as an argument or shell string. |
| Output | JSON object on stdout: `{ "ok": true, ... }` or `{ "ok": false, "code": n, "error": "..." }`. Human text on stderr only. Windows: the first line after start is `{"ok":true,"ready":true}`. |
| Codes | 0 ok, 1 other, 2 permission missing, 3 target gone or not foreground, 4 unsupported environment or missing tool (Wayland, xdotool absent), 5 focus could not be acquired. One-shot helpers use these as exit codes; the Windows worker uses them as the `code` field. |
| Commands (one-shot) | `foreground` → prints WindowInfo; `info <id>` → WindowInfo or code 3; `focus <id>` → focuses and verifies; `type <id> [--enter]` → verifies foreground == id, reads stdin, types, Enter when `--enter`; `check` → permission check |

Window ids: Windows HWND as decimal string; macOS `pid:<pid>` (process level, see 6.4); Linux X11 window id as decimal string.

### 6.2 `WindowInfo` fields per OS

| Field | Windows | macOS | Linux X11 |
|---|---|---|---|
| id | HWND | `pid:<unix id>` | `_NET_ACTIVE_WINDOW` id |
| title | `GetWindowText` | name of front window of frontmost process (empty if none) | `getwindowname` |
| processName | `Process.GetProcessById(pid).ProcessName` + `.exe` | process `name` from System Events | `/proc/<pid>/comm` via `getwindowpid`, empty if unknown |
| pid | `GetWindowThreadProcessId` | `unix id` | `getwindowpid` |

### 6.3 Windows: `src/main/helpers/win/worker.ps1` (verified 2026-10-21)

Long-lived worker started by `win.js` as `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File worker.ps1`. `pwsh` is not assumed to exist; the script runs on Windows PowerShell 5.1. Inline C# via `Add-Type` declares `user32.dll` imports: `GetForegroundWindow`, `SetForegroundWindow`, `BringWindowToTop`, `IsWindow`, `IsIconic`, `ShowWindow`, `GetWindowThreadProcessId`, `AttachThreadInput`, `AllowSetForegroundWindow`, `SwitchToThisWindow`, `GetWindowTextW`, `SendInput`, and `kernel32.dll` `GetCurrentThreadId`.

Foreground acquisition (verified on Windows 11 against a background Notepad window and Windows Terminal, see Appendix A.1):

```
focus(hwnd):
  if !IsWindow(hwnd) → code 3
  if IsIconic(hwnd) → ShowWindow(hwnd, SW_RESTORE)
  if GetForegroundWindow() == hwnd → ok
  AllowSetForegroundWindow(ASFW_ANY)
  fgThread = GetWindowThreadProcessId(GetForegroundWindow())
  AttachThreadInput(currentThread, fgThread, true)
  SetForegroundWindow(hwnd); BringWindowToTop(hwnd)
  AttachThreadInput(currentThread, fgThread, false)
  poll GetForegroundWindow() == hwnd every 15 ms for up to 250 ms → ok
  SwitchToThisWindow(hwnd, true)
  poll for up to 300 ms → ok
  else → code 5
```

No modifier key is ever synthesized. The Alt-tap workaround was rejected (D-13) because a bare Alt press activates menu bars in some applications and would be a key event aimed at the target.

Typing (`type` request): the worker focuses as above, sleeps 120 ms, re-checks `GetForegroundWindow() == hwnd` (code 5 if not), then calls `SendInput` once with an `INPUT[]` array holding one key-down and one key-up per UTF-16 code unit, `wVk = 0`, `wScan = codeUnit`, `dwFlags = KEYEVENTF_UNICODE (| KEYEVENTF_KEYUP)` (R3), followed by `VK_RETURN (0x0D)` down and up when `enter` is true. Surrogate pairs are sent as two consecutive code units. The worker compares the count returned by `SendInput` with the number of events and reports code 1 on mismatch. Verified exact round-trip of `whipzap ascii OK: FASTER! WORK HARDER! ünïcödé ✓ 日本 end` into a WinForms TextBox and of a command line with Enter into Windows Terminal (cmd).

`SendInput` always targets the foreground window, which is exactly why focus verification precedes it.

Reading `foreground` and `info`: `GetForegroundWindow` or the given HWND, `GetWindowTextW`, `GetWindowThreadProcessId`, then `Get-Process -Id <pid>` for `processName`.

Performance: PowerShell start plus `Add-Type` compilation costs about 4 to 5 s on the development machine, which is why the worker is long-lived (D-12). `platform.start()` runs at app launch so the first crack never pays it. A warm request completes in about 425 to 560 ms end to end including the 120 ms settle. `win.js` also polls `foreground` every 1000 ms to maintain `lastForeground` for tray locks (section 4.5).

Windows Terminal and conhost both accept `VK_PACKET` Unicode input. WSL2 shells run inside those windows, so WSL users are covered without any helper change. The Windows 11 store Notepad mangles burst Unicode input and is not a supported target or test fixture.

### 6.4 macOS: `src/main/helpers/mac/helper.sh`

Invoked as `/bin/sh <path> <command>`. Internally calls `osascript -e` with scripts passed via `-e` and text via stdin to `osascript` (`osascript - <<EOF` is not used; the script reads stdin with `read -r` into a variable and hands it to AppleScript through `osascript -e '...' "$text"` as `item 1 of argv`, which is argument passing to osascript, not a shell string, and does not go through a shell parser again).

| Command | AppleScript |
|---|---|
| `foreground` | `tell application "System Events" to set p to first process whose frontmost is true` then `unix id of p`, `name of p`, and `name of front window of p` guarded by `try`. |
| `focus <pid>` | `tell application "System Events" to set frontmost of (first process whose unix id is N) to true`, then poll `frontmost` up to 5 times with 50 ms sleeps, exit 5 if never frontmost, exit 3 if no such process. |
| `type <pid>` | Verify frontmost process `unix id` equals N (else exit 3). If text is pure ASCII: `keystroke text`. Otherwise (UNVERIFIED reliability of `keystroke` with non-ASCII, see R6): save clipboard text via `pbpaste`, `pbcopy` the text, `keystroke "v" using command down`, sleep 80 ms, restore clipboard. Then `key code 36` for Enter when `--enter`. |
| `check` | Exit 0 if `AXIsProcessTrusted` is true, else 2. Implemented in main via `systemPreferences.isTrustedAccessibilityClient(prompt)` (R5) rather than the helper; the helper's `check` runs `osascript -e 'tell application "System Events" to keystroke ""'` and maps the "not allowed assistive access" error (-1719 or -25211) to exit 2. |

Permissions: the process that needs Accessibility is the one that calls System Events, which is `osascript` launched by Electron. TCC attributes the request to the responsible application. When WhipZap runs via the prebuilt `electron` binary from npm, the entry shown in System Settings > Privacy & Security > Accessibility is expected to be "Electron" (UNVERIFIED which name appears when launched from a terminal via `npx`; the Terminal app may be shown instead). UX.md section 1 words the prompt so both cases are covered. First run: main calls `isTrustedAccessibilityClient(true)` once per launch when `typingAvailable` is false and the user triggers a lock.

Window id is process level (`pid:`) because System Events keystrokes go to the frontmost process, not a specific window. A terminal with several tabs receives input in its active tab, which matches user expectation.

Global hotkeys with Cmd+Alt do not require Accessibility (R4; only media keys do).

### 6.5 Linux X11: `src/main/helpers/linux/helper.sh`

Invoked as `/bin/sh <path> <command>`. Requires `xdotool` on PATH.

| Command | Implementation |
|---|---|
| `check` | `XDG_SESSION_TYPE=wayland` or `WAYLAND_DISPLAY` set and `DISPLAY` unset → exit 4 with error "Wayland is not supported". `command -v xdotool` missing → exit 4 "xdotool not found". Else 0. `isSupported()` in `linux.js` runs this. |
| `foreground` | `id=$(xdotool getactivewindow)`; `xdotool getwindowname $id`; `pid=$(xdotool getwindowpid $id 2>/dev/null)`; `comm=$(cat /proc/$pid/comm)`. |
| `focus <id>` | `xdotool windowactivate --sync $id` then verify `getactivewindow == id` else exit 5. |
| `type <id>` | verify active window equals id (exit 3), read stdin, `xdotool type --clearmodifiers --delay 8 --file -` (UNVERIFIED that `--file -` exists in the installed xdotool; fallback: pass text as a single argv element, which is safe because `execFile` does not use a shell), then `xdotool key --clearmodifiers Return` when `--enter`. |

XWayland sessions where `DISPLAY` is set may work partially; the helper does not block them but `UX.md` documents that Wayland is unsupported.

### 6.6 Unsupported stub

Returns `isSupported → { ok:false, reason:'Unsupported platform' }`; every other call throws `HelperError` code 4.

## 7. Overlay visuals

### 7.1 Rope physics (whip mode)

| Parameter | Value | Note |
|---|---|---|
| Segments | 28 | Fixed; configurable only in code. |
| Segment length | `min(w,h) / 45` px | Scales with display. |
| Integration | Verlet, fixed step 1000/120 ms, accumulator from `requestAnimationFrame` delta | Fixed step makes feel independent of refresh rate (fixes the class of bug in OpenWhip issue #61). |
| Constraint iterations | 12 | |
| Gravity | `0.02 * segmentLength` px per step² | 0.35 (original assumption) gave terminal speeds near 100,000 px/s and cracked on every swing. |
| Damping | 0.975 per step | 0.992 let a free swing keep cracking for 6 s after the last flick (observed 2026-10-21). |
| Bend limit | 20° at handle rising linearly to 140° at tip | Prevents the rope folding on itself. |
| Handle | pinned to the last mouse position each step | |
| Walls | tip and segments clamp to display bounds with 0.4 restitution | |
| Tip speed | distance moved by the last segment per fixed step, in px per step, averaged over 3 steps | |
| Crack threshold | `tipSpeed > crackFactor * segmentLength` px per step, `crackFactor` default 3.5 (`config.whip.crackFactor`, 0.5 to 20) | 6.3 was unreachable: a 400 px head jump reaches about 3.5 segment lengths per step through 28 constrained segments. Default chosen against synthetic input; human tuning owed (ROADMAP section 11). |
| Grace after spawn | 400 ms | No cracks. |
| Cooldown | 600 ms, `config.whip.cooldownMs` (100 to 10000) | Between cracks; 250 ms produced machine-gun cracks under continuous motion. `crack.js` adds its own 300 ms busy guard. |
| Drop | handle unpinned, gravity ×3, hide when all segments are below the display bottom or after 1.5 s | |

Drawing: Catmull-Rom spline through segment points, two strokes: 7 px light halo (`rgba(255,255,255,0.55)`) under a 3 px dark core (`#15110c`), handle drawn as a 10 px rounded rectangle at the cursor. Crack flash at the tip: 120 ms radial burst, 60 px radius.

### 7.2 Strike flash (hotkey, tray, auto)

Specified in `UX.md` section 6. The overlay receives `seed` and derives the lash angle from `mulberry32(seed)` so a test can assert deterministic geometry.

### 7.3 Reduced motion

If `window.matchMedia('(prefers-reduced-motion: reduce)')` matches or main sends `overlay:setReduceMotion {enabled:true}`, the strike becomes a 200 ms static flash plus message, and the rope still works (it is user-driven motion). Flash frequency never exceeds 3 Hz anywhere.

## 8. Scheduler

```
seed   = config.auto.seed ?? (Date.now() ^ (process.pid << 8)) >>> 0
rng    = mulberry32(seed)
delay  = clamp(base + (rng()*2 - 1) * jitter, minIntervalSec, +inf)
```

| Rule | Value |
|---|---|
| First fire | one full `delay` after start (never immediately). |
| Tier | `tierForCount(count)` with count = cracks fired in this auto session. |
| Pause | while `whipArmed`; resume continues the remaining delay. |
| Cap | after the `sessionCap`-th fire the scheduler stops and main toasts the cap message. |
| Reset | `autoCount` resets on every start. |
| Logging | each fire logs `{ seed, count, delaySec, tier }` at debug level. |

With `seed` set in config, a session reproduces the same intervals and the same message picks, which is how `TESTING.md` verifies the scheduler.

## 9. Config schema

File: `app.getPath('userData')/config.json` → `%APPDATA%\whipzap\config.json`, `~/Library/Application Support/whipzap/config.json`, `~/.config/whipzap/config.json`.

```jsonc
{
  "version": 1,
  "delivery": "safe",                       // "safe" | "btw"
  "hotkeys": {
    "crack": "CommandOrControl+Alt+W",
    "armWhip": "CommandOrControl+Alt+Shift+W",
    "toggleAuto": "CommandOrControl+Alt+A"
  },
  "auto": {
    "baseIntervalSec": 180,                 // integer 20..86400
    "jitterSec": 90,                        // integer 0..baseIntervalSec
    "sessionCap": 20,                       // integer 1..500
    "seed": null                            // null | integer 0..2^32-1
  },
  "sound": {
    "muted": false,
    "volume": 0.8                           // number 0..1
  },
  "messages": {
    "extra": [],                            // array of { "tier": "mild"|"medium"|"spicy", "text": string } or plain strings (tier mild)
    "replace": false                        // true → ignore built-in pack
  },
  "target": {
    "allowPatterns": []                     // extra case-insensitive substrings or "/regex/i" strings; merged with defaults
  },
  "whip": {
    "crackFactor": 3.5,                     // number 0.5..20, tip speed to crack in segment lengths per step
    "cooldownMs": 600                       // integer 100..10000
  }
}
```

The `WHIPZAP_USER_DATA` environment variable overrides the directory (app.js calls `app.setPath('userData', ...)` before ready) for portable installs and tests.

Validation rules (`validateConfig`): unknown keys are ignored and preserved on save; wrong types are replaced by defaults and reported; `hotkeys.*` must match `/^[A-Za-z0-9+]+$/`; `messages.extra[].text` goes through the pack rules in section 10; `version` other than 1 → error, defaults used. Errors are surfaced once as a toast and in the log.

Default `target.allowPatterns` (merged, case-insensitive, matched against `processName` then `title`):

```
windowsterminal, wt.exe, cmd.exe, powershell, pwsh, conhost, mintty, alacritty, wezterm, kitty, ghostty, hyper, terminal, iterm, warp, code, cursor, windsurf, idea64, pycharm64, webstorm64, rider64, goland64, clion64, phpstorm64, rubymine64, gnome-terminal, konsole, xterm, tilix, foot, tmux, claude, codex, zellij
```

`terminal` also matches "Terminal.app" and "Windows Terminal" titles; `code` matches `Code.exe`, `Code - Insiders`, and the Electron process name `code`.

Never-lock rule (D-14): a crack whose `source` is `whip` or `auto` and finds no target does not call `lockForeground`; `crack.js` plays sound and visual and toasts "No target locked". `app.js` enforces this in `crackFrom(source)` (`mayLock = source === 'hotkey' || source === 'tray'`). When a target is lost (`exists()` false or helper code 3), `onTargetLost` turns auto mode off and drops the whip.

## 10. Message pack schema

File: `assets/messages/default.json` (built-in) and `messages.extra` in config.

```json
{
  "version": 1,
  "tiers": {
    "mild":   ["FASTER!", "..."],
    "medium": ["..."],
    "spicy":  ["..."]
  }
}
```

Rules: every string is 1 to 80 characters, printable Unicode only (no C0/C1 controls, no `\n`, `\r`, `\t`), trimmed, unique within its tier. Built-in strings are ASCII only so that the macOS `keystroke` path is always used for them. Each tier has at least one entry after merging; an empty tier falls back to the nearest lower tier, then to "FASTER!". The actual built-in lines live in `UX.md` section 9 and must be copied verbatim into `default.json`.

## 11. Sound

| Item | Decision |
|---|---|
| Format | WAV, PCM 16-bit, mono, 48 kHz. Chromium plays WAV natively on all three platforms; no encoder is needed to produce it, and trimmed files are small. MP3 and OGG are not used. |
| Files | `assets/sounds/crack-1.wav`, `crack-2.wav`, `crack-3.wav`, each at most 0.8 s with the transient within the first 40 ms, peak normalised to -1 dBFS. Produced from the sources by `scripts/prepare-sounds.mjs` (trim, normalise, 24-bit to 16-bit). |
| Source | Three CC0 whip cracks by Joseph Sardin, BigSoundBank.com: https://bigsoundbank.com/whip-crack-2-s2950.html, https://bigsoundbank.com/whip-crack-3-s2951.html, https://bigsoundbank.com/whip-crack-4-s2952.html. Licence stated on each page: "CC0 (public domain): Free and royalty-free". |
| Licence | CC0 only, recorded in `assets/CREDITS.md` with source URL, author, and the edits made. OpenWhip's audio is never used. |
| Playback | `audio.js` in the overlay via `HTMLAudioElement`; one element per file created on `overlay:ready` so first play has no decode latency; `volume` from config. |
| Pick | `pick(sounds)` uses the same `rng` as messages so a seeded run is fully deterministic. |
| Mute | main skips `overlay:playSound`; the overlay never decides. |

Audio runs in the renderer rather than main because Electron main has no audio API and spawning a player process per crack would add 100 ms or more of latency on Windows.

## 12. Security model

| Concern | Control |
|---|---|
| Wrong-window typing | Target lock (D-2); helper verifies foreground == target twice (before focus return and before `SendInput`/`keystroke`/`type`); `sanitizeForTyping` strips control characters; only Enter is synthesised. |
| Malicious config | Config can change hotkeys, intervals, patterns, and message text. It cannot execute commands, change which helper runs, add control keys (sanitised), exceed 200 characters per message, or reach the network. `allowPatterns` regexes are compiled with a 1 KiB length cap and tested with a 50 ms budget [ASSUMED] to limit ReDoS. |
| Renderer | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no remote URLs, Content Security Policy `default-src 'self' whipzap-asset:; script-src 'self'; style-src 'self' 'unsafe-inline'` in `overlay.html`. |
| Helpers | Static files in the package under `src/main/helpers/`, resolved by absolute path, never downloaded or generated at runtime. Text goes via stdin (JSON line on Windows, raw on macOS and Linux). `spawn`/`execFile` with argument arrays, never `exec`. 5 s request timeout, 64 KiB output cap. |
| Privileges | No elevation. macOS Accessibility is the only OS permission requested. No camera, microphone, screen recording, or network entitlements. |
| Supply chain | Dependencies: `electron` (runtime), `vitest`, `eslint` (dev). No postinstall scripts of our own. `npm audit` runs in CI. |
| Logging | Logs never include typed text at info level; message text appears only when `WHIPZAP_DEBUG=1`. |

What WhipZap can do to a user who installs it: type up to 200 printable characters plus Enter into a terminal or editor window that the user explicitly locked. Nothing else.

## 13. Dependencies

| Package | Type | Version policy | Why |
|---|---|---|---|
| `electron` | dependency | `^45.0.0` (latest stable 45.0.0 on 2026-10-21, R7) [ASSUMED: bump to the current stable at M0] | Runtime. A dependency, not devDependency, because `bin/whipzap.js` needs the binary after `npm install -g whipzap`. |
| `vitest` | devDependency | latest 3.x or 4.x at M0 | Unit tests. |
| `eslint` + `@eslint/js` + `globals` | devDependency | latest 9.x | Flat config lint. |

No other runtime dependencies. No `koffi`, `ffi-napi`, `robotjs`, `nut.js`, or similar.

## 14. Packaging

```json
{
  "name": "whipzap",
  "version": "0.1.0",
  "type": "module",
  "bin": { "whipzap": "bin/whipzap.js" },
  "main": "src/main/app.js",
  "engines": { "node": ">=20" },
  "os": ["win32", "darwin", "linux"],
  "files": ["bin/", "src/", "assets/", "README.md", "LICENSE"]
}
```

No `postinstall`. `npm install -g whipzap` triggers Electron's own postinstall which downloads the binary (about 100 MB); this is the only download and it is Electron's, not ours. `npx whipzap` works the same way. Installers are out of scope for v1 (D-8).

`bin/whipzap.js`:

1. `import electronPath from 'electron'` resolves the binary path (the `electron` package's default export is the path string when imported from Node).
2. `spawn(electronPath, [appDir, ...passthroughArgs], { detached: true, stdio: 'ignore', windowsHide: false }).unref()` unless `--foreground`.
3. Prints "WhipZap started. Look for the whip icon in your tray." and exits 0.

## 15. Logging

| Level | Destination | Content |
|---|---|---|
| info | stdout of the Electron process (visible with `whipzap --foreground`) | state transitions, helper exit codes, scheduler fires without message text |
| debug | only when `WHIPZAP_DEBUG=1` | helper stdout/stderr, typed text, timings |
| error | stderr | helper failures, config errors |

Implemented as a tiny `src/main/log.js` with `info/debug/error` that prefixes a timestamp. No log files in v1.

## 16. Error handling matrix

| Situation | Detection | User-visible | State effect |
|---|---|---|---|
| Hotkey taken | `globalShortcut.register` false | Toast "Hotkey <accel> is taken" | none; tray still works |
| Platform unsupported (Wayland, other OS) | `isSupported` | Native dialog once at start; toast on each typing attempt | `typingAvailable=false` |
| xdotool missing | `isSupported` | Toast "xdotool not found" | `typingAvailable=false` |
| macOS Accessibility missing | helper exit 2 or `isTrustedAccessibilityClient` false | Prompt once per launch on first lock; toast "Accessibility permission required" | `typingAvailable=false` until next launch or next successful `check` |
| Target closed | `focusWindow` false or helper exit 3 | Toast "Target window closed" | unlock; auto off |
| Focus refused (Windows) | helper exit 5 | Toast "Could not focus target" | target kept; message not typed |
| Helper timeout | execFile timeout | Toast "Typing failed" | none |
| Config invalid | `loadConfig.errors` | Toast "Config invalid, using defaults"; `.bak` written | defaults |
| Second instance | `requestSingleInstanceLock` false | first instance toasts "WhipZap is already running" | second exits |
| Overlay crash | `webContents` `render-process-gone` | Overlay recreated silently; log error | none |

## 17. Known risks

| # | Risk | Likelihood | Mitigation | Retire in |
|---|---|---|---|---|
| 1 | Windows refuses foreground to the helper | Retired 2026-10-21 | AttachThreadInput path (6.3) focused a background window in the spike; SwitchToThisWindow fallback; code 5 and never type blind | M1 (done) |
| 2 | macOS TCC attributes Accessibility to "Electron" or "Terminal" confusingly | High | UX copy covers both names; `check` command verifies; README screenshot | M1 on a Mac |
| 3 | `keystroke` mangles non-ASCII | Medium | Built-in pack is ASCII; clipboard fallback for user text | M1 |
| 4 | Overlay steals focus on Linux | Medium | `blur()` after show; Linux is best-effort | M3 |
| 5 | Transparent overlay not click-through on Windows while idle | Low | `setIgnoreMouseEvents(true, {forward:true})` plus hidden when idle | M3 |
| 6 | Rope feel differs at 60 vs 144 Hz | Low | Fixed-step integration (7.1) | M4 |
| 7 | Add-Type latency makes cracks feel late | Retired 2026-10-21 | Long-lived worker started at launch (D-12); sound and visual fire first; warm request 425 to 560 ms measured | M1 (done) |
| 8 | Global hotkey collides with terminal binding (Ctrl+Alt+W) | Medium | Configurable; toast on failure; documented alternatives | M2 |
| 9 | Electron major bump during implementation | Low | Pin `^45`, CI runs on the pinned version | M0 |

## 18. References

| Id | Source |
|---|---|
| R1 | SetForegroundWindow rules and taskbar flash: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow |
| R2 | Alt-key and AttachThreadInput workarounds (community, long-standing): https://legacy.codeproject.com/Tips/76427/How-to-Bring-Window-to-Top-with-SetForegroundWindo and https://forums.codeguru.com/showthread.php?p=1829780 |
| R3 | KEYBDINPUT and KEYEVENTF_UNICODE (VK_PACKET): https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-keybdinput |
| R4 | Electron globalShortcut (register after ready, returns false when taken, Accessibility only for media keys): https://www.electronjs.org/docs/latest/api/global-shortcut |
| R5 | Electron systemPreferences.isTrustedAccessibilityClient(prompt): https://www.electronjs.org/docs/latest/api/system-preferences |
| R6 | AppleScript keystroke with non-ASCII text is unreliable; clipboard paste workaround: https://www.macscripter.net/t/system-events-keystroke-command-going-crazy-with-international-text/48912 and https://www.macscripter.net/t/keystroke-bug-with-non-breaking-space-character-8239/77588 |
| R7 | Electron releases feed (45.0.0 stable, Node 24.22, Chromium 156 on 2026-10-21): https://releases.electronjs.org/releases.json |
| R8 | Electron BrowserWindow: transparent, focusable, setAlwaysOnTop levels, setIgnoreMouseEvents forward: https://www.electronjs.org/docs/latest/api/browser-window |
| R9 | Electron Tray: template images on macOS, 16x16 and 32x32@2x: https://www.electronjs.org/docs/latest/api/tray |
| R10 | xdotool getactivewindow, windowactivate --sync, type --delay, key: https://github.com/jordansissel/xdotool/blob/master/xdotool.pod |

## Appendix A. Platform research notes (2026-10-21)

1. **Windows foreground lock (spike results, 2026-10-21, Windows 11 build 26200).** Microsoft documents six allow conditions (R1). The spike showed that `AttachThreadInput` to the current foreground thread followed by `SetForegroundWindow` plus `BringWindowToTop` brings a background Notepad window to the foreground from the PowerShell worker without any synthesized input; `GetForegroundWindow` confirmed the target handle afterwards. `SwitchToThisWindow(hwnd, true)` is kept as a second attempt only (Microsoft marks it as not for general use, so it is never the first choice). The simulated Alt tap was rejected (D-13). Measured: worker cold start 4.8 s including PowerShell start and `Add-Type`; warm `type` request 425 to 560 ms end to end including the 120 ms settle; exact Unicode round-trip (`whipzap ascii OK: FASTER! WORK HARDER! ünïcödé ✓ 日本 end`) into a WinForms TextBox in 428 ms; `echo ... ünïcödé` plus Enter typed into Windows Terminal running cmd. Windows 11 store Notepad mangled burst Unicode input (first word correct, remainder garbled), so it is not used as a fixture.
2. **Electron overlay.** `focusable:false` is Windows/macOS only. `setIgnoreMouseEvents(ignore, {forward})` forwards mouse-move on Windows/macOS. `setAlwaysOnTop(true, 'screen-saver')` is above Dock and taskbar. Transparent frameless windows cannot be resized programmatically on Windows; we never resize, we recreate on display change.
3. **Electron tray.** macOS icons must be template images named `*Template.png` with `@2x` variants; 16 px and 32 px. Windows prefers `.ico`. Linux may ignore click events, so all functionality is in the context menu.
4. **macOS Unicode typing.** `keystroke` maps characters to key presses and fails for characters absent from the current layout. The built-in pack is ASCII; user-added non-ASCII text uses the clipboard path with restore.
5. **xdotool.** `windowactivate --sync` blocks until active; `type --delay` default 12 ms; `key Return`. `getwindowpid` depends on `_NET_WM_PID` and may be empty, so `processName` may be empty on Linux and the sanity check then relies on the title.
6. **Electron version.** 45.0.0 was published 2026-10-21 (Chromium 156, Node 24.22). Pin `^45.0.0` at M0; if 45 proves unstable in M0 smoke, fall back to `^44.9.3`.

## Deviations (2026-10-21)

1. Helpers moved from `helpers/` at the package root to `src/main/helpers/<os>/`; `files` no longer lists `helpers/`. Reason: shipped inside `src/` with no extra packaging entry.
2. Windows helper is a long-lived JSON-lines worker (`worker.ps1`), not a one-shot script (D-12). Reason: `Add-Type` costs about 4 s on first start.
3. Windows focus uses `AttachThreadInput` then `SwitchToThisWindow`; the simulated Alt tap is removed everywhere (D-13). Reason: verified in the spike; Alt activates menu bars.
4. Platform adapter contract finalised as `createPlatform()` with `getWindowInfo`, `typeText(id, text, {pressEnter})`, `start`/`stop`, `openAccessibilitySettings`; `listWindows`, `windowExists`, `pressEnter` do not exist. Reason: matches the verified implementation.
5. Sounds are WAV (16-bit mono 48 kHz) from BigSoundBank CC0 sources, not MP3. Reason: no encoder on the dev machine; Chromium plays WAV.
6. `auto.sessionCap` clamp is 1..500 (was 1..1000). Reason: align with TESTING CFG-08.
7. Tier rule decided: hotkey and tray mild, whip medium, auto by count; any crack while auto is on counts toward the auto session.
8. Tray lock on Windows uses a 1000 ms `lastForeground` poll in `win.js`; macOS and Linux read the foreground at click time. Reason: replaces the 500 ms tray-open poll assumption.
9. Lock points are exhaustive (4.5, 5.1): whip-mode and auto cracks never lock; a lost target drops the whip and stops auto (D-14). Reason: a closed fixture during whip mode let the next flick lock and type into the operator's editor.
10. Overlay is focusable only while the whip is armed (2.1, D-15). Reason: no mouse button events reached the non-activatable window on Windows 11.
11. Rope constants (7.1): gravity 0.02, damping 0.975, crack factor 3.5 via `config.whip.crackFactor`, cooldown 600 ms via `config.whip.cooldownMs`. Reason: measured behaviour on 2026-10-21; the assumed values cracked on their own.
12. Config gains a `whip` section (9) and the `WHIPZAP_USER_DATA` override. Reason: tuning knob and test isolation.
13. `src/main/toast.js` was not created; `toast()` is a closure in app.js. `src/main/log.js` added. Reason: size.
14. Self-test accepts `WHIPZAP_SELFTEST_CAPTURE` (renderer capture) and `WHIPZAP_SELFTEST_SCREEN` (desktopCapturer screen capture) for diagnostics; GDI screenshots cannot see the overlay because the window has `WS_EX_NOREDIRECTIONBITMAP`. Reason: verification needed real-screen evidence.
