@echo off
rem Double-click to start the world over at day 1 (see reset.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reset.ps1"
pause
