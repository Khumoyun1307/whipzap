# Windows end-to-end check (manual tool, see docs/TESTING.md section 3.4).
# Starts WhipZap with a throwaway config, opens the typing fixture, and drives the three triggers
# through simulated input: hotkey crack, whip mode (arm, mouse flick, click to drop), and auto mode
# (20 s interval, cap 2). Reports what the fixture received, the app log, and saves screenshots
# taken with Print Screen (the overlay is a DirectComposition window; GDI captures cannot see it).
#
#   powershell -ExecutionPolicy Bypass -File test/helpers/win-e2e.ps1 [-SkipAuto]
#
# Nothing is typed into any window other than the fixture: it is TopMost and focused when the
# hotkey fires, so WhipZap locks it as the target. Uses the clipboard for Print Screen captures.
param([switch]$SkipAuto)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root
$tmp = Join-Path $env:TEMP 'whipzap-e2e'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$log = Join-Path $tmp 'app.log'
$fixtureLog = Join-Path $tmp 'fixture.log'
Remove-Item -Force -ErrorAction SilentlyContinue $log, $fixtureLog
$userData = Join-Path $tmp 'userData'
New-Item -ItemType Directory -Force -Path $userData | Out-Null
@'
{ "version": 1, "delivery": "safe",
  "auto": { "baseIntervalSec": 20, "jitterSec": 0, "sessionCap": 2, "seed": 7 },
  "sound": { "muted": false, "volume": 0.4 } }
'@ | Set-Content -Encoding ascii (Join-Path $userData 'config.json')

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class E2E {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, IntPtr extra);
}
'@
$shotDir = Join-Path $root 'test\helpers\_e2e-shots'
$trigger = Join-Path $tmp 'shot.trigger'
Remove-Item -Force -ErrorAction SilentlyContinue $trigger, "$trigger.quit"
function Snap([string]$name) {
  # Handled by test/helpers/screenshot.cjs (desktopCapturer sees DirectComposition windows).
  Set-Content -Path $trigger -Value $name -Encoding ascii
  "snap requested: $name"
}

$env:WHIPZAP_DEBUG = '1'
$env:WHIPZAP_USER_DATA = $userData
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$shotLog = Join-Path $tmp 'shots.log'
$shooter = Start-Process -FilePath $electron -ArgumentList ('"' + (Join-Path $root 'test\helpers\screenshot.cjs') + '"'), ('"' + $shotDir + '"'), ('"' + $trigger + '"') -RedirectStandardOutput $shotLog -PassThru
$app = Start-Process -FilePath $electron -ArgumentList ('"' + $root + '"') -RedirectStandardOutput $log -PassThru
try {
  $deadline = (Get-Date).AddSeconds(25)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'WhipZap ready' -Quiet)) { $ready = $true; break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $ready) { throw 'WhipZap did not report ready' }
  Start-Sleep -Seconds 6   # one-time Add-Type compile in the Windows helper worker

  $fixtureSeconds = if ($SkipAuto) { 70 } else { 110 }   # must outlive every phase; the lock must never fall back to another window
  $fixture = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'win-textbox.ps1'), '-Seconds', $fixtureSeconds -RedirectStandardOutput $fixtureLog -PassThru
  Start-Sleep -Seconds 3   # fixture is TopMost; a hidden-console process cannot activate it itself
  $fixtureHwnd = [int64]((Get-Content $fixtureLog | Select-Object -First 1 | ConvertFrom-Json).hwnd)
  "fixture hwnd=$fixtureHwnd"

  # SAFETY GUARD: WhipZap locks whatever is foreground when the hotkey fires. Bring the fixture to the
  # foreground with the app's own helper and verify it, otherwise abort before pressing any hotkey.
  function Ensure-FixtureForeground {
    & node (Join-Path $root 'test\helpers\run-helper.mjs') focus $fixtureHwnd | Out-Null
    Start-Sleep -Milliseconds 300
    $fg = (& node (Join-Path $root 'test\helpers\run-helper.mjs') foreground | ConvertFrom-Json)
    if ([int64]$fg.id -ne $fixtureHwnd) { throw "ABORT: fixture is not foreground (foreground is '$($fg.title)'); refusing to press hotkeys" }
  }
  Ensure-FixtureForeground
  Snap 'before'

  # 1. Hotkey crack (locks the fixture, types a mild message + Enter).
  Ensure-FixtureForeground
  [System.Windows.Forms.SendKeys]::SendWait('^%w')
  Start-Sleep -Milliseconds 350
  Snap 'strike'
  Start-Sleep -Seconds 3

  # 2. Whip mode: arm, flick the mouse hard a few times, then click to drop.
  Ensure-FixtureForeground
  [System.Windows.Forms.SendKeys]::SendWait('^%+w')
  Start-Sleep -Milliseconds 900
  Snap 'rope'
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $cx = [int]($b.Width / 2); $cy = [int]($b.Height / 2)
  for ($k = 0; $k -lt 6; $k++) {
    for ($i = 0; $i -lt 6; $i++) { [E2E]::SetCursorPos($cx - 400 + $i * 160, $cy - 120 + $i * 40) | Out-Null; Start-Sleep -Milliseconds 8 }
    Start-Sleep -Milliseconds 250
    for ($i = 0; $i -lt 6; $i++) { [E2E]::SetCursorPos($cx + 400 - $i * 160, $cy + 120 - $i * 40) | Out-Null; Start-Sleep -Milliseconds 8 }
    Start-Sleep -Milliseconds 250
  }
  Start-Sleep -Milliseconds 300
  Snap 'whipcrack'
  Start-Sleep -Seconds 2
  [E2E]::SetCursorPos($cx, $cy) | Out-Null
  [E2E]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 60; [E2E]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  'click sent to drop the whip'
  Start-Sleep -Seconds 2
  # Fallback: if the click did not reach the overlay, the arm hotkey toggles the whip off.
  if (-not (Select-String -Path $log -Pattern 'whip dropped' -Quiet)) { [System.Windows.Forms.SendKeys]::SendWait('^%+w'); 'drop via hotkey fallback'; Start-Sleep -Seconds 1 }

  # 3. Auto mode: toggle on, wait for two scheduled cracks (20 s apart) and the cap toast.
  if (-not $SkipAuto) {
    Ensure-FixtureForeground
    [System.Windows.Forms.SendKeys]::SendWait('^%a')
    'auto mode toggled on; waiting 46 s for two scheduled cracks'
    Start-Sleep -Seconds 46
    Snap 'auto'
  }

  Start-Sleep -Seconds 2
  if (-not $fixture.HasExited) { $fixture.CloseMainWindow() | Out-Null }
  $fixture.WaitForExit(15000) | Out-Null
  'fixture received: ' + ((Get-Content $fixtureLog) | Select-Object -Last 1)
} catch {
  "E2E ERROR: $($_.Exception.Message) at line $($_.InvocationInfo.ScriptLineNumber)"
} finally {
  '--- app log (filtered) ---'
  if (Test-Path $log) { Get-Content $log | Select-String 'ready|toast|crack|lock|auto|error|fail|whip|clicked' | ForEach-Object { $_.Line } }
  Set-Content -Path "$trigger.quit" -Value 'q'
  Start-Sleep -Seconds 1
  '--- screenshots ---'
  if (Test-Path $shotLog) { Get-Content $shotLog }
  foreach ($proc in @($app, $shooter)) { if ($proc -and -not $proc.HasExited) { cmd /c "taskkill /PID $($proc.Id) /T /F >nul 2>&1" } }
}
