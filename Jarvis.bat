@echo off
setlocal

title Jarvis
color 0A
cd /d "%~dp0"

echo.
echo   +-----------------------------------+
echo   ^|       JARVIS                      ^|
echo   ^|   Thinking in Code - Agent Hub    ^|
echo   +-----------------------------------+
echo.

:: If the repo isn't set up yet, run the cold bootstrap (installs Node/Git
:: via winget, clones deps, seeds databases). Else start-jarvis.ps1 handles
:: preflight + dashboard + optional daemon.

if not exist "node_modules" goto BOOTSTRAP
if not exist "%USERPROFILE%\.jarvis\crm.db" goto BOOTSTRAP
goto LAUNCH

:BOOTSTRAP
echo   [!] First-time setup detected. Running cold bootstrap...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\bootstrap.ps1"
if errorlevel 1 (
    echo.
    echo   [X] Bootstrap failed. See messages above.
    echo       Re-run this script after fixing, or run setup\bootstrap.ps1 manually.
    pause
    exit /b 1
)
echo.
echo   [*] Bootstrap complete. Continuing to launch...
echo.

:LAUNCH
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-jarvis.ps1" -all
if errorlevel 1 (
    echo.
    echo   [X] Launch failed. See messages above.
    echo       Run 'npm run preflight' for a detailed status report.
    pause
    exit /b 1
)

endlocal
