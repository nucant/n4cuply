@echo off
REM PC-te test korar jonno: double-click koro, tarpor browser-e http://localhost:8080 kholo
cd /d "%~dp0"
start "" http://localhost:8080
python -m http.server 8080
