@echo off
rem Baut die Desktop-App neu: dist\Toolbahn-win32-x64\Toolbahn.exe
cd /d "%~dp0"
if not exist node_modules\@electron\packager call npm install --no-audit --no-fund
call npm run build
echo.
echo Fertig: dist\Toolbahn-win32-x64\Toolbahn.exe
pause
