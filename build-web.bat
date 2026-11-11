@echo off
rem Baut die Browser-Version nach dist\Toolbahn-Browser und packt sie als ZIP.
cd /d "%~dp0"
node tools/build-web.mjs || goto :err
powershell -NoProfile -Command "Compress-Archive -Path 'dist\Toolbahn-Browser\*' -DestinationPath 'dist\Toolbahn-Browser.zip' -Force" || goto :err
echo Fertig: dist\Toolbahn-Browser und dist\Toolbahn-Browser.zip
pause
exit /b 0
:err
echo Fehler beim Bauen der Browser-Version.
pause
exit /b 1
