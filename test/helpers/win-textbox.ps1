# Test fixture: opens a WinForms window with a TextBox, prints its window handle as JSON on the first line,
# stays open for -Seconds, then prints the TextBox content as JSON and exits.
# Used by the Windows integration test to assert exactly what the helper typed.
param([int]$Seconds = 6, [string]$Title = "WhipZap typing fixture")
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.Width = 700; $form.Height = 200
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$tb = New-Object System.Windows.Forms.TextBox
$tb.Multiline = $true
$tb.Dock = 'Fill'
$tb.Font = New-Object System.Drawing.Font('Consolas', 14)
$form.Controls.Add($tb)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $Seconds * 1000
$timer.Add_Tick({ $form.Close() })
$script:captured = ''
$form.Add_FormClosing({ $script:captured = $tb.Text })
$form.Add_Shown({
  $tb.Focus() | Out-Null
  [Console]::Out.WriteLine((@{ hwnd = ("{0}" -f $form.Handle.ToInt64()); title = $Title } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  $timer.Start()
})
[System.Windows.Forms.Application]::Run($form)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.WriteLine((@{ text = $script:captured } | ConvertTo-Json -Compress))
