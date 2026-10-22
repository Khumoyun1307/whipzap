# Generates WhipZap icons with System.Drawing (Windows PowerShell 5.1 compatible).
# Output: assets/icons/tray-{idle,locked,armed,auto}.png (32x32, white glyph), their 16x16 variants,
#         assets/icons/trayTemplate.png + trayTemplate@2x.png (macOS template: black glyph, alpha only),
#         assets/icons/app-256.png (color app icon).
# Original artwork drawn procedurally; no third-party assets.

param([string]$OutDir = (Join-Path $PSScriptRoot "..\assets\icons"))
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Draw-Whip {
  param([System.Drawing.Graphics]$g, [int]$size, [System.Drawing.Color]$color, [string]$badge)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $s = $size / 32.0
  # Handle: short thick bar bottom-left
  $pen = New-Object System.Drawing.Pen($color, [float](4.2 * $s))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($pen, [float](5*$s), [float](27*$s), [float](11*$s), [float](21*$s))
  # Lash: tapering curve from handle up and to the right, ending in a hook (the crack tip)
  $pts = @(
    (New-Object System.Drawing.PointF([float](11*$s), [float](21*$s))),
    (New-Object System.Drawing.PointF([float](14*$s), [float](9*$s))),
    (New-Object System.Drawing.PointF([float](24*$s), [float](4*$s))),
    (New-Object System.Drawing.PointF([float](27*$s), [float](12*$s))),
    (New-Object System.Drawing.PointF([float](21*$s), [float](14*$s)))
  )
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddCurve($pts, [float]0.6)
  $lash = New-Object System.Drawing.Pen($color, [float](2.4 * $s))
  $lash.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $lash.EndCap   = [System.Drawing.Drawing2D.LineCap]::Triangle
  $g.DrawPath($lash, $path)
  # Badge: small filled dot bottom-right that encodes state
  if ($badge -ne "") {
    $brush = New-Object System.Drawing.SolidBrush($color)
    $r = 7 * $s
    $g.FillEllipse($brush, [float](32*$s - $r - 1*$s), [float](32*$s - $r - 1*$s), [float]$r, [float]$r)
    if ($badge -eq "ring") {
      $hole = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Transparent)
      $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $g.FillEllipse($hole, [float](32*$s - $r + 1*$s), [float](32*$s - $r + 1*$s), [float]($r - 4*$s), [float]($r - 4*$s))
      $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    }
  }
}

function Save-Icon {
  param([string]$name, [int]$size, [System.Drawing.Color]$color, [string]$badge, [System.Drawing.Color]$bg)
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear($bg)
  Draw-Whip -g $g -size $size -color $color -badge $badge
  $g.Dispose()
  $bmp.Save((Join-Path $OutDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

$white = [System.Drawing.Color]::White
$black = [System.Drawing.Color]::Black
$clear = [System.Drawing.Color]::Transparent

# Windows/Linux tray: white glyph. State encoded by badge: none=idle, dot=locked, ring=armed, dot+... auto uses same dot but app sets tooltip; keep 4 files for clarity.
foreach ($sz in 16, 32) {
  $suffix = if ($sz -eq 16) { "-16" } else { "" }
  Save-Icon "tray-idle$suffix.png"   $sz $white ""     $clear
  Save-Icon "tray-locked$suffix.png" $sz $white "dot"  $clear
  Save-Icon "tray-armed$suffix.png"  $sz $white "ring" $clear
  Save-Icon "tray-auto$suffix.png"   $sz $white "dot"  $clear
}
# macOS template images: black glyph, Electron treats *Template.png as template (uses alpha only).
Save-Icon "trayTemplate.png"    16 $black "" $clear
Save-Icon "trayTemplate@2x.png" 32 $black "" $clear
Save-Icon "trayLockedTemplate.png"    16 $black "dot" $clear
Save-Icon "trayLockedTemplate@2x.png" 32 $black "dot" $clear
Save-Icon "trayArmedTemplate.png"     16 $black "ring" $clear
Save-Icon "trayArmedTemplate@2x.png"  32 $black "ring" $clear

# App icon: warm orange background, white whip.
$orange = [System.Drawing.Color]::FromArgb(255, 232, 93, 4)
$bmp = New-Object System.Drawing.Bitmap(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear($clear)
$brush = New-Object System.Drawing.SolidBrush($orange)
$rp = New-Object System.Drawing.Drawing2D.GraphicsPath
$rad = 56
$rp.AddArc(0, 0, $rad, $rad, 180, 90); $rp.AddArc(256-$rad, 0, $rad, $rad, 270, 90)
$rp.AddArc(256-$rad, 256-$rad, $rad, $rad, 0, 90); $rp.AddArc(0, 256-$rad, $rad, $rad, 90, 90); $rp.CloseFigure()
$g.FillPath($brush, $rp)
$g.TranslateTransform(24, 24); $g.ScaleTransform(0.8125, 0.8125)
Draw-Whip -g $g -size 256 -color $white -badge ""
$g.Dispose()
$bmp.Save((Join-Path $OutDir "app-256.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "Icons written to $OutDir"
Get-ChildItem $OutDir | ForEach-Object { "{0,-28} {1,6} bytes" -f $_.Name, $_.Length }
