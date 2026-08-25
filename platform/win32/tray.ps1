# k0's tray icon for Windows.
#
# The counterpart of menubar/K0MenuBar.swift and platform/linux/tray.py, and deliberately the
# same shape: poll /api/status every couple of seconds, tint a small square with the colour of
# the most urgent session, and put the sessions that are waiting for you at the top of the
# menu so one click brings the right terminal back.
#
# WinForms' NotifyIcon is used because it is part of .NET Framework, which is on every Windows
# install: nothing to download, nothing to compile, no dependency added to a project that has
# none. The icon is drawn at runtime rather than shipped as a file, for the same reason.

param([int]$Port = $(if ($env:K0_PORT) { [int]$env:K0_PORT } else { 4319 }))

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Base = "http://127.0.0.1:$Port"

# The same colours and the same order of urgency as the board. ASK first because a question
# blocks everything behind it; COMPLETED never gets here.
$Urgency = @('ASK', 'PLANNED', 'IDLE', 'WORKING', 'PLANNING')
$Colours = @{
  ASK      = @(232, 106, 51)
  PLANNED  = @(108, 142, 191)
  IDLE     = @(224, 192, 74)
  WORKING  = @(91, 168, 106)
  PLANNING = @(142, 124, 195)
  quiet    = @(154, 154, 154)
  down     = @(176, 80, 80)
}
$Labels = @{
  ASK = 'Needs answer'; PLANNED = 'Needs approval'; IDLE = 'Your turn'
  WORKING = 'Working'; PLANNING = 'Planning'
}
$Modes = [ordered]@{ sleep = 'Sleep'; away = 'Away'; nerd = 'Nerd'; driving = 'Driving' }

$script:IconCache = @{}
$script:Seen = @{}
$script:FirstPass = $true
$script:Mode = $null

function Get-K0Icon([string]$State) {
  if ($script:IconCache.ContainsKey($State)) { return $script:IconCache[$State] }
  $rgb = $Colours[$State]
  if (-not $rgb) { $rgb = $Colours['quiet'] }
  $bitmap = New-Object System.Drawing.Bitmap 16, 16
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($rgb[0], $rgb[1], $rgb[2]))
  $graphics.FillRectangle($brush, 1, 1, 14, 14)
  $graphics.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
  $script:IconCache[$State] = $icon
  return $icon
}

function Invoke-K0([string]$Path, $Body) {
  try {
    if ($null -ne $Body) {
      $json = $Body | ConvertTo-Json -Compress
      return Invoke-RestMethod -Uri ($Base + $Path) -Method Post -Body $json `
        -ContentType 'application/json' -Headers @{ Origin = $Base } -TimeoutSec 3
    }
    return Invoke-RestMethod -Uri ($Base + $Path) -Method Get -Headers @{ Origin = $Base } -TimeoutSec 3
  } catch {
    return $null
  }
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = Get-K0Icon 'quiet'
$notify.Text = 'k0'
$notify.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$notify.ContextMenuStrip = $menu

# Clicking the balloon brings that session's terminal up front, which is the whole point of being
# told. Windows shows one balloon at a time and replaces it rather than queueing, so the card the
# click belongs to is always the last one announced — there is nothing else it could be.
$script:LastNotified = $null
$notify.Add_BalloonTipClicked({
    if ($null -ne $script:LastNotified) {
      Invoke-K0 "/api/card/$($script:LastNotified)/focus" @{} | Out-Null
    }
  }) | Out-Null

function Add-K0Item($Text, $Action, [bool]$Enabled = $true) {
  $item = New-Object System.Windows.Forms.ToolStripMenuItem
  $item.Text = $Text
  $item.Enabled = $Enabled -and ($null -ne $Action)
  if ($null -ne $Action) { $item.Add_Click($Action) | Out-Null }
  $menu.Items.Add($item) | Out-Null
  return $item
}

function Update-K0Menu($Waiting, [bool]$Down) {
  $menu.Items.Clear()
  if ($Down) {
    Add-K0Item 'Server not responding' $null $false | Out-Null
  } elseif (-not $Waiting -or $Waiting.Count -eq 0) {
    Add-K0Item 'Nothing waiting for you' $null $false | Out-Null
  } else {
    foreach ($card in $Waiting) {
      $label = "$($Labels[$card.status]) - $($card.title)"
      $id = $card.id
      Add-K0Item $label ([System.EventHandler]{ Invoke-K0 "/api/card/$id/focus" @{} | Out-Null }.GetNewClosure()) | Out-Null
    }
  }

  $menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
  foreach ($key in $Modes.Keys) {
    $value = $key
    $item = Add-K0Item $Modes[$key] ([System.EventHandler]{
        if ($script:Mode -ne $value) { Invoke-K0 '/api/mode' @{ mode = $value } | Out-Null }
      }.GetNewClosure())
    $item.Checked = ($script:Mode -eq $value)
  }

  $menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
  Add-K0Item 'Dashboard' ([System.EventHandler]{ Start-Process $Base }) | Out-Null
  Add-K0Item 'Restart server' ([System.EventHandler]{
      schtasks /End /TN 'k0 server' | Out-Null; schtasks /Run /TN 'k0 server' | Out-Null
    }) | Out-Null
  Add-K0Item 'Quit' ([System.EventHandler]{
      $notify.Visible = $false; [System.Windows.Forms.Application]::Exit()
    }) | Out-Null
}

# Notify about cards that have just started waiting, not about every one on every pass.
function Show-K0Notifications($Waiting) {
  $now = @{}
  foreach ($card in $Waiting) { $now["$($card.id):$($card.status)"] = $true }
  if (-not $script:FirstPass) {
    foreach ($card in $Waiting) {
      $key = "$($card.id):$($card.status)"
      if (-not $script:Seen.ContainsKey($key)) {
        $script:LastNotified = $card.id
        $notify.BalloonTipTitle = $Labels[$card.status]
        $notify.BalloonTipText = $card.title
        $notify.ShowBalloonTip(4000)
      }
    }
  }
  $script:Seen = $now
  $script:FirstPass = $false
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
    $status = Invoke-K0 '/api/status'
    if ($null -eq $status) {
      $notify.Icon = Get-K0Icon 'down'
      $notify.Text = 'k0: server not responding'
      Update-K0Menu @() $true
      return
    }
    $waiting = @($status.waiting)
    $script:Mode = $status.mode
    $state = if ($status.urgent) { $status.urgent } else { 'quiet' }
    $notify.Icon = Get-K0Icon $state
    $notify.Text = if ($Labels[$state]) { $Labels[$state] } else { 'k0 - nothing waiting for you' }
    Update-K0Menu $waiting $false
    Show-K0Notifications $waiting
  })
$timer.Start()

Update-K0Menu @() $true
[System.Windows.Forms.Application]::Run()
$notify.Visible = $false
