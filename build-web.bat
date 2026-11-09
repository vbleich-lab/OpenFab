@echo off
rem Baut die Browser-Version nach dist\OpenFab-Browser und packt sie als ZIP.
cd /d "%~dp0"
node tools/build-web.mjs || goto :err
powershell -NoProfile -Command "Compress-Archive -Path 'dist\OpenFab-Browser\*' -DestinationPath 'dist\OpenFab-Browser.zip' -Force" || goto :err
echo Fertig: dist\OpenFab-Browser und dist\OpenFab-Browser.zip
pause
exit /b 0
:err
echo Fehler beim Bauen der Browser-Version.
pause
exit /b 1
