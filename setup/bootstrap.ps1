#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Cold-start bootstrap for Jarvis on a fresh Windows install.

.DESCRIPTION
  Installs the OS prerequisites (Node.js, Git) via winget, clones the repo
  if it isn't already present, runs npm install, and hands off to either
  the setup wizard (fresh start) or the ops:recover restore (from an
  existing backup bundle).

  Every external step is retried with exponential backoff and verified
  before moving on. Services that take time to come up (Ollama, LM Studio,
  the dashboard) are polled through scripts/ops/preflight.mjs so the
  script fails fast with an actionable message instead of hanging.

.PARAMETER RepoUrl
  Git URL to clone if the repo isn't already checked out. Defaults to the
  canonical Jarvis repo.

.PARAMETER InstallDir
  Where to clone Jarvis. Defaults to $HOME\Documents\Playground.

.PARAMETER BackupPath
  If given, restore from this backup bundle via ops:recover instead of
  running the setup wizard. Useful when resuming from a previous machine.

.PARAMETER Unattended
  Skip interactive prompts and take defaults (suitable for re-run loops).

.PARAMETER SkipModelRuntime
  Don't install Ollama / LM Studio. Pick this if you manage model runtimes
  some other way.

.EXAMPLE
  # Fresh install on a new PC:
  iwr https://raw.githubusercontent.com/dturcu/jarvis/master/setup/bootstrap.ps1 -OutFile bootstrap.ps1
  .\bootstrap.ps1

.EXAMPLE
  # Restore from a backup on a rebuilt PC:
  .\bootstrap.ps1 -BackupPath "D:\Jarvis-Backup\2026-04-17T03-42Z"
#>

[CmdletBinding()]
param(
  [string]$RepoUrl = "https://github.com/dturcu/jarvis.git",
  [string]$InstallDir = (Join-Path $HOME "Documents\Playground"),
  [string]$BackupPath = "",
  [switch]$Unattended,
  [switch]$SkipModelRuntime
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Host.UI.RawUI.WindowTitle = "Jarvis Bootstrap"

# -- Retry helpers ------------------------------------------------------------

function Invoke-WithRetry {
  param(
    [Parameter(Mandatory=$true)][scriptblock]$Script,
    [string]$Name,
    [int]$MaxAttempts = 4,
    [int]$InitialDelaySec = 2
  )
  for ($i = 1; $i -le $MaxAttempts; $i++) {
    try {
      return & $Script
    } catch {
      $delay = [int]($InitialDelaySec * [Math]::Pow(2, $i - 1))
      $delay = [Math]::Min($delay, 30)
      Write-Host "  [!] $Name attempt $i/$MaxAttempts failed: $_" -ForegroundColor Yellow
      if ($i -eq $MaxAttempts) { throw }
      Write-Host "  [~] Retrying in ${delay}s..." -ForegroundColor DarkYellow
      Start-Sleep -Seconds $delay
    }
  }
}

function Test-CommandExists {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Banner {
  param([string]$Text)
  Write-Host ""
  Write-Host "  +---------------------------------------+" -ForegroundColor DarkCyan
  Write-Host ("  | {0,-37} |" -f $Text) -ForegroundColor Cyan
  Write-Host "  +---------------------------------------+" -ForegroundColor DarkCyan
  Write-Host ""
}

function Step { param([int]$N, [int]$Total, [string]$Msg)
  Write-Host ""
  Write-Host ("  [$N/$Total] $Msg") -ForegroundColor Cyan
}

function Ok { param([string]$Msg) Write-Host "      [OK] $Msg" -ForegroundColor Green }
function Info { param([string]$Msg) Write-Host "      [..] $Msg" -ForegroundColor DarkGray }
function Warn { param([string]$Msg) Write-Host "      [!]  $Msg" -ForegroundColor Yellow }
function Fail { param([string]$Msg) Write-Host "      [XX] $Msg" -ForegroundColor Red }

# -- Preconditions ------------------------------------------------------------

function Assert-Windows11 {
  $caption = (Get-CimInstance Win32_OperatingSystem).Caption
  Info "OS: $caption"
  if ($caption -notmatch "Windows (10|11|Server)") {
    throw "Unsupported OS: $caption. This bootstrap targets Windows 10/11."
  }
}

function Assert-Winget {
  if (-not (Test-CommandExists "winget")) {
    throw "winget is not available. Install 'App Installer' from the Microsoft Store, or use Windows 11 (22H2+) where winget ships by default."
  }
  Ok "winget available"
}

# -- Install steps ------------------------------------------------------------

function Install-Node {
  if (Test-CommandExists "node") {
    $v = (node --version) -replace "^v",""
    $parts = $v.Split(".")
    if ([int]$parts[0] -gt 22 -or ([int]$parts[0] -eq 22 -and [int]$parts[1] -ge 5)) {
      Ok "Node $v already installed"
      return
    }
    Warn "Node $v is below required 22.5.0; upgrading"
  }
  Invoke-WithRetry -Name "winget install Node.js" -Script {
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget exited $LASTEXITCODE" }
  }
  # winget installs may not update $env:PATH in the current session
  $npmDir = Join-Path $env:ProgramFiles "nodejs"
  if ((Test-Path $npmDir) -and -not (($env:PATH -split ";") -contains $npmDir)) {
    $env:PATH = "$npmDir;$env:PATH"
  }
  if (-not (Test-CommandExists "node")) { throw "Node still not on PATH after install" }
  Ok ("Node " + (node --version) + " installed")
}

function Install-Git {
  if (Test-CommandExists "git") {
    Ok (git --version)
    return
  }
  Invoke-WithRetry -Name "winget install Git" -Script {
    winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget exited $LASTEXITCODE" }
  }
  $gitDir = Join-Path $env:ProgramFiles "Git\cmd"
  if ((Test-Path $gitDir) -and -not (($env:PATH -split ";") -contains $gitDir)) {
    $env:PATH = "$gitDir;$env:PATH"
  }
  if (-not (Test-CommandExists "git")) { throw "git still not on PATH after install" }
  Ok (git --version)
}

function Install-ModelRuntime {
  if ($SkipModelRuntime) { Info "skipped by -SkipModelRuntime"; return }

  $ollamaPresent = Test-CommandExists "ollama"
  $lmStudioPresent = Test-Path "$env:LOCALAPPDATA\LM-Studio\LM Studio.exe"

  if ($ollamaPresent -or $lmStudioPresent) {
    if ($ollamaPresent) { Ok "Ollama already installed" }
    if ($lmStudioPresent) { Ok "LM Studio already installed" }
    return
  }

  if ($Unattended) {
    Info "Unattended mode: installing Ollama by default"
    $choice = "O"
  } else {
    $choice = Read-Host "      Install (O)llama, (L)M Studio, or (S)kip? [O]"
    if (-not $choice) { $choice = "O" }
  }

  switch -Regex ($choice.ToLower()) {
    "^o" {
      Invoke-WithRetry -Name "winget install Ollama" -Script {
        winget install --id Ollama.Ollama -e --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw "winget exited $LASTEXITCODE" }
      }
      Ok "Ollama installed (start it with: ollama serve)"
    }
    "^l" {
      Invoke-WithRetry -Name "winget install LM Studio" -Script {
        winget install --id ElementLabs.LMStudio -e --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw "winget exited $LASTEXITCODE" }
      }
      Ok "LM Studio installed (launch the app and start the local server)"
    }
    "^s" { Info "Skipped model runtime install" }
    default { Warn "Unknown choice '$choice'; skipping" }
  }
}

function Clone-OrUpdate-Repo {
  if (Test-Path (Join-Path $InstallDir ".git")) {
    Ok "Repo already present at $InstallDir"
    Push-Location $InstallDir
    try {
      Invoke-WithRetry -Name "git fetch" -Script {
        git fetch origin --quiet
        if ($LASTEXITCODE -ne 0) { throw "git fetch exited $LASTEXITCODE" }
      }
    } finally { Pop-Location }
    return
  }
  $parent = Split-Path $InstallDir -Parent
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Invoke-WithRetry -Name "git clone" -Script {
    git clone $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) { throw "git clone exited $LASTEXITCODE" }
  }
  Ok "Cloned to $InstallDir"
}

function Install-Dependencies {
  Push-Location $InstallDir
  try {
    Invoke-WithRetry -Name "npm install" -MaxAttempts 3 -Script {
      npm install --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw "npm install exited $LASTEXITCODE" }
    }
    Ok "Dependencies installed"
  } finally { Pop-Location }
}

function Seed-Or-Restore {
  Push-Location $InstallDir
  try {
    if ($BackupPath) {
      if (-not (Test-Path $BackupPath)) {
        throw "BackupPath not found: $BackupPath"
      }
      Info "Restoring from $BackupPath"
      Invoke-WithRetry -Name "ops:recover" -MaxAttempts 2 -Script {
        node scripts/ops/recover-runtime.mjs --bundle $BackupPath
        if ($LASTEXITCODE -ne 0) { throw "ops:recover exited $LASTEXITCODE" }
      }
      Ok "Restored runtime state from backup"
    } else {
      Info "Running setup wizard"
      if ($Unattended) {
        npm run setup -- --all
      } else {
        npm run setup
      }
      if ($LASTEXITCODE -ne 0) { throw "setup wizard exited $LASTEXITCODE" }
      Ok "Setup wizard complete"
    }
  } finally { Pop-Location }
}

function Verify-Bootstrap {
  Push-Location $InstallDir
  try {
    Info "Running preflight"
    node scripts/ops/preflight.mjs --profile=bootstrap
    if ($LASTEXITCODE -ne 0) {
      Warn "Bootstrap preflight reported issues (see output above)"
    } else {
      Ok "Bootstrap preflight passed"
    }
  } finally { Pop-Location }
}

# -- Main ---------------------------------------------------------------------

Banner "JARVIS BOOTSTRAP"

$steps = 7

Step 1 $steps "Checking preconditions"
Assert-Windows11
Assert-Winget

Step 2 $steps "Installing Node.js (via winget, retried up to 4x)"
Install-Node

Step 3 $steps "Installing Git (via winget, retried up to 4x)"
Install-Git

Step 4 $steps "Installing model runtime (Ollama or LM Studio)"
Install-ModelRuntime

Step 5 $steps "Cloning / updating Jarvis repo"
Clone-OrUpdate-Repo

Step 6 $steps "Installing npm dependencies"
Install-Dependencies

Step 7 $steps ("{0} runtime state" -f $(if ($BackupPath) { "Restoring" } else { "Seeding" }))
Seed-Or-Restore

Write-Host ""
Banner "VERIFYING"
Verify-Bootstrap

Write-Host ""
Write-Host "  Next step:" -ForegroundColor Cyan
Write-Host "    cd '$InstallDir'" -ForegroundColor White
Write-Host "    .\start-jarvis.ps1 -all" -ForegroundColor White
Write-Host ""
