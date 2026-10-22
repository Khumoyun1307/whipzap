# WhipZap Windows helper worker.
# Long-lived process: reads one JSON request per line on stdin, writes one JSON response per line on stdout.
# Requires Windows PowerShell 5.1 or later. No third-party dependencies.
#
# Requests:
#   {"op":"ping"}
#   {"op":"foreground"}                       -> {"ok":true,"id":"<hwnd>","title":"...","processName":"...","pid":N}
#   {"op":"info","id":"<hwnd>"}               -> same shape, or code 3 if the window is gone
#   {"op":"focus","id":"<hwnd>"}              -> {"ok":true} or {"ok":false,"code":3|5,...}
#   {"op":"type","id":"<hwnd>","text":"...","enter":true}
#                                             -> {"ok":true} after focusing + typing text (+ Enter)
#   {"op":"quit"}
# Error codes: 2 permission, 3 target gone, 4 unsupported, 5 focus failed, 1 other.
# The worker never sends Ctrl-C, Esc, or any key other than the Unicode text and Enter.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class WZ {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(uint dwProcessId);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public INPUTUNION u; }

  const uint INPUT_KEYBOARD = 1;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_UNICODE = 0x0004;
  const ushort VK_RETURN = 0x0D;
  const int SW_RESTORE = 9;
  const uint ASFW_ANY = 0xFFFFFFFF;

  public static string Title(IntPtr h) {
    var sb = new StringBuilder(512);
    GetWindowTextW(h, sb, sb.Capacity);
    return sb.ToString();
  }

  public static uint Pid(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return pid; }

  // Returns true if h is foreground after the attempt. Uses only documented techniques:
  // restore if minimized, AttachThreadInput to the current foreground thread, SetForegroundWindow,
  // then SwitchToThisWindow as a fallback. Never synthesizes modifier keys.
  public static bool Focus(IntPtr h) {
    if (!IsWindow(h)) return false;
    if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
    if (GetForegroundWindow() == h) return true;
    AllowSetForegroundWindow(ASFW_ANY);
    IntPtr fg = GetForegroundWindow();
    uint fgThread = GetWindowThreadProcessId(fg, out _unused);
    uint cur = GetCurrentThreadId();
    bool attached = false;
    if (fgThread != 0 && fgThread != cur) attached = AttachThreadInput(cur, fgThread, true);
    try {
      SetForegroundWindow(h);
      BringWindowToTop(h);
    } finally {
      if (attached) AttachThreadInput(cur, fgThread, false);
    }
    if (Wait(h, 250)) return true;
    SwitchToThisWindow(h, true);
    return Wait(h, 300);
  }
  static uint _unused;

  static bool Wait(IntPtr h, int ms) {
    int waited = 0;
    while (waited < ms) {
      if (GetForegroundWindow() == h) return true;
      Thread.Sleep(15); waited += 15;
    }
    return GetForegroundWindow() == h;
  }

  // Types text as Unicode key events (works for any UTF-16 text), optionally followed by Enter.
  public static int Type(string text, bool enter) {
    int n = text.Length * 2 + (enter ? 2 : 0);
    var inputs = new INPUT[n];
    int i = 0;
    foreach (char c in text) {
      inputs[i].type = INPUT_KEYBOARD; inputs[i].u.ki.wScan = c; inputs[i].u.ki.dwFlags = KEYEVENTF_UNICODE; i++;
      inputs[i].type = INPUT_KEYBOARD; inputs[i].u.ki.wScan = c; inputs[i].u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP; i++;
    }
    if (enter) {
      inputs[i].type = INPUT_KEYBOARD; inputs[i].u.ki.wVk = VK_RETURN; i++;
      inputs[i].type = INPUT_KEYBOARD; inputs[i].u.ki.wVk = VK_RETURN; inputs[i].u.ki.dwFlags = KEYEVENTF_KEYUP; i++;
    }
    uint sent = SendInput((uint)n, inputs, Marshal.SizeOf(typeof(INPUT)));
    return (int)sent;
  }
}
'@
Add-Type -TypeDefinition $src -Language CSharp

function Get-ProcName([uint32]$procId) {
  try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { "" }
}

function Describe([IntPtr]$h) {
  $procId = [WZ]::Pid($h)
  @{ ok = $true; id = ("{0}" -f $h.ToInt64()); title = [WZ]::Title($h); processName = (Get-ProcName $procId); pid = [int]$procId }
}

function Emit($obj) {
  $json = ($obj | ConvertTo-Json -Compress -Depth 4)
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Fail([int]$code, [string]$msg) { Emit @{ ok = $false; code = $code; error = $msg } }

function ToHandle($id) {
  if ($null -eq $id) { return [IntPtr]::Zero }
  return [IntPtr]::new([int64]$id)
}

Emit @{ ok = $true; ready = $true }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  try {
    $req = $line | ConvertFrom-Json
    switch ($req.op) {
      'ping'       { Emit @{ ok = $true; pong = $true } }
      'quit'       { Emit @{ ok = $true }; exit 0 }
      'foreground' {
        $h = [WZ]::GetForegroundWindow()
        if ($h -eq [IntPtr]::Zero) { Fail 3 'no foreground window' } else { Emit (Describe $h) }
      }
      'info' {
        $h = ToHandle $req.id
        if (-not [WZ]::IsWindow($h)) { Fail 3 'window gone' } else { Emit (Describe $h) }
      }
      'focus' {
        $h = ToHandle $req.id
        if (-not [WZ]::IsWindow($h)) { Fail 3 'window gone' }
        elseif ([WZ]::Focus($h)) { Emit @{ ok = $true } }
        else { Fail 5 'could not bring window to foreground' }
      }
      'type' {
        $h = ToHandle $req.id
        if (-not [WZ]::IsWindow($h)) { Fail 3 'window gone'; break }
        if (-not [WZ]::Focus($h)) { Fail 5 'could not bring window to foreground'; break }
        Start-Sleep -Milliseconds 120
        if ([WZ]::GetForegroundWindow() -ne $h) { Fail 5 'focus lost before typing'; break }
        $text = [string]$req.text
        $enter = [bool]$req.enter
        $sent = [WZ]::Type($text, $enter)
        $expected = $text.Length * 2 + $(if ($enter) { 2 } else { 0 })
        if ($sent -ne $expected) { Fail 1 ("SendInput sent {0} of {1} events" -f $sent, $expected) }
        else { Emit @{ ok = $true; typed = $text.Length } }
      }
      default { Fail 4 ("unknown op '{0}'" -f $req.op) }
    }
  } catch {
    Fail 1 ($_.Exception.Message)
  }
}
