@echo off
title UIU Exam Countdown WhatsApp Bot - 24/7 Persistent Runner
color 0B
echo ========================================================
echo   UIU Exam Countdown WhatsApp Bot (Fall 2026)
echo   United International University
echo   Mode: 24/7 Self-Healing Auto-Restart Runner
echo ========================================================
cd /d "%~dp0"

:loop
echo.
echo [%date% %time%] 🚀 Starting UIU WhatsApp Bot...
node index.js
echo.
echo ========================================================
echo ⚠️ Bot process exited or restarted during code changes.
echo 🔄 Auto-restarting in 3 seconds to keep bot active forever...
echo ========================================================
timeout /t 3 /nobreak >nul
goto loop

