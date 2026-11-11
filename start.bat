@echo off
rem Startet WerkFab lokal und oeffnet es im Browser.
cd /d "%~dp0"
start "" http://localhost:8765
python -m http.server 8765
