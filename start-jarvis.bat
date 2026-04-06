@echo off
title Jarvis Dashboard
color 0A

echo.
echo   ╔═══════════════════════════════════╗
echo   ║       JARVIS DASHBOARD            ║
echo   ║   Thinking in Code - Agent Hub    ║
echo   ╚═══════════════════════════════════╝
echo.

:: Check if node_modules exists
if not exist "node_modules" (
    echo   [!] Dependencies not installed. Running npm install...
    call npm install
    echo.
)

:: Check if dashboard is built
if not exist "packages\jarvis-dashboard\dist\index.html" (
    echo   [~] Building dashboard...
    call npm run dashboard:build
    echo.
)

:: Check if databases exist
if not exist "%USERPROFILE%\.jarvis\crm.db" (
    echo   [~] Initializing databases...
    call npx tsx scripts/init-jarvis.ts
    echo.
)

echo   [*] Starting Jarvis Dashboard on http://localhost:4242
echo   [*] Press Ctrl+C to stop
echo.

:: Open browser after 2 second delay
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:4242"

:: Start the dashboard
call npm run dashboard
