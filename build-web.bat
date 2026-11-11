@echo off
rem Baut die Browser-Version nach dist\WerkFab-Browser und packt sie als ZIP.
cd /d "%~dp0"
node tools/build-web.mjs || goto :err
powershell -NoProfile -Command "Compress-Archive -Path 'dist\WerkFab-Browser\*' -DestinationPath 'dist\WerkFab-Browser.zip' -Force" || goto :err
echo Fertig: dist\WerkFab-Browser und dist\WerkFab-Browser.zip
pause
exit /b 0
:err
echo Fehler beim Bauen der Browser-Version.
pause
exit /b 1
