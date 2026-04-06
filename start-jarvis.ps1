#!/usr/bin/env pwsh
# Jarvis Dashboard Launcher
# Usage: .\start-jarvis.ps1 [--daemon] [--rebuild]

param(
    [switch]$daemon,
    [switch]$rebuild,
    [switch]$all
)

$Host.UI.RawUI.WindowTitle = "Jarvis"

Write-Host ""
Write-Host "  ╔═══════════════════════════════════╗" -ForegroundColor DarkCyan
Write-Host "  ║       JARVIS DASHBOARD            ║" -ForegroundColor Cyan
Write-Host "  ║   Thinking in Code - Agent Hub    ║" -ForegroundColor DarkCyan
Write-Host "  ╚═══════════════════════════════════╝" -ForegroundColor DarkCyan
Write-Host ""

$root = $PSScriptRoot
Set-Location $root

# Check deps
if (-not (Test-Path "node_modules")) {
    Write-Host "  [!] Installing dependencies..." -ForegroundColor Yellow
    npm install
    Write-Host ""
}

# Check databases
$jarvisDir = Join-Path $env:USERPROFILE ".jarvis"
if (-not (Test-Path (Join-Path $jarvisDir "crm.db"))) {
    Write-Host "  [~] Initializing databases..." -ForegroundColor DarkYellow
    npx tsx scripts/init-jarvis.ts
    Write-Host ""
}

# Rebuild if requested or if dist doesn't exist
$distPath = Join-Path $root "packages\jarvis-dashboard\dist\index.html"
if ($rebuild -or -not (Test-Path $distPath)) {
    Write-Host "  [~] Building dashboard..." -ForegroundColor DarkYellow
    npm run dashboard:build
    Write-Host ""
}

# Kill any existing process on port 4242
$existing = Get-NetTCPConnection -LocalPort 4242 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1
if ($existing) {
    Write-Host "  [~] Stopping existing process on :4242 (PID $existing)" -ForegroundColor DarkYellow
    Stop-Process -Id $existing -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# Start daemon if requested
if ($daemon -or $all) {
    Write-Host "  [*] Starting daemon in background..." -ForegroundColor Green
    $daemonJob = Start-Process -FilePath "npx" -ArgumentList "tsx packages/jarvis-runtime/src/daemon.ts" -WorkingDirectory $root -WindowStyle Hidden -PassThru
    Write-Host "  [*] Daemon PID: $($daemonJob.Id)" -ForegroundColor DarkGreen
    Write-Host ""
}

# Open browser
Write-Host "  [*] Dashboard: " -NoNewline -ForegroundColor Green
Write-Host "http://localhost:4242" -ForegroundColor White
Write-Host "  [*] Press Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host ""

Start-Job -ScriptBlock { Start-Sleep 2; Start-Process "http://localhost:4242" } | Out-Null

# Start dashboard (foreground)
npm run dashboard
