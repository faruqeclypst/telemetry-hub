@echo off
title TelemetryHub Pro - Online Sharing Tunnel
echo ==========================================================
echo TelemetryHub Pro - Quick Online Tunnel
echo ==========================================================
echo.
echo Pastikan TelemetryHub backend sudah berjalan di port 8000
echo (baik via start.bat atau "python main.py").
echo.
echo Membuka tunnel publik gratis melalui localtunnel...
echo URL publik akan muncul di bawah ini (contoh: https://xyz.loca.lt)
echo.
npx --yes localtunnel --port 8000
pause
