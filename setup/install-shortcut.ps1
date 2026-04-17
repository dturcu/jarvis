#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Place a double-click Jarvis launcher on the Desktop and Start Menu.

.DESCRIPTION
  Creates a .lnk shortcut pointing at Jarvis.bat in this repo, with a
  recognizable label. The shortcut can be pinned to the taskbar from
  Start like any normal app. Uses the system shell.dll terminal icon
  by default; supply -IconPath to use a custom .ico.

.PARAMETER IconPath
  Absolute path to a .ico file to use for the shortcut. Falls back to
  shell32 index 25 (the PowerShell-style icon).

.PARAMETER NoStartMenu
  Don't create a Start Menu entry. Desktop-only.

.PARAMETER NoDesktop
  Don't create a Desktop entry. Start-Menu-only.

.EXAMPLE
  .\setup\install-shortcut.ps1

.EXAMPLE
  .\setup\install-shortcut.ps1 -IconPath "D:\icons\jarvis.ico"
#>

[CmdletBinding()]
param(
  [string]$IconPath = "",
  [switch]$NoStartMenu,
  [switch]$NoDesktop
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
$target = Join-Path $repoRoot "Jarvis.bat"

if (-not (Test-Path $target)) {
    throw "Jarvis.bat not found at $target. Are you running this from a fresh clone?"
}

$icon = if ($IconPath -and (Test-Path $IconPath)) { $IconPath } else { "$env:SystemRoot\System32\shell32.dll,25" }

function New-JarvisShortcut {
    param([string]$LnkPath)
    $parent = Split-Path $LnkPath -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($LnkPath)
    $lnk.TargetPath = $target
    $lnk.WorkingDirectory = $repoRoot
    $lnk.WindowStyle = 1
    $lnk.Description = "Jarvis - Thinking in Code Agent Hub"
    $lnk.IconLocation = $icon
    $lnk.Save()

    Write-Host "  [OK] $LnkPath" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Installing Jarvis shortcut..." -ForegroundColor Cyan
Write-Host "  target: $target" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoDesktop) {
    $desktop = [Environment]::GetFolderPath("Desktop")
    New-JarvisShortcut -LnkPath (Join-Path $desktop "Jarvis.lnk")
}

if (-not $NoStartMenu) {
    $startMenu = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs"
    New-JarvisShortcut -LnkPath (Join-Path $startMenu "Jarvis.lnk")
}

Write-Host ""
Write-Host "  Done. Double-click 'Jarvis' on the Desktop to launch." -ForegroundColor Green
Write-Host "  (Right-click the shortcut -> Pin to Taskbar for faster access.)" -ForegroundColor DarkGray
Write-Host ""
