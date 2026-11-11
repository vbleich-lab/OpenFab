@echo off
rem Baut die Desktop-App neu: dist\WerkFab-win32-x64\WerkFab.exe
cd /d "%~dp0"
if not exist node_modules\@electron\packager call npm install --no-audit --no-fund
call npm run build
echo.
echo Fertig: dist\WerkFab-win32-x64\WerkFab.exe
pause
