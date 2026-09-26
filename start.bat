@echo off
title TelemetryHub Pro - Starting Services...
echo ===================================================
echo Starting TelemetryHub Pro Services
echo ===================================================

echo [1/2] Launching FastAPI Backend on http://127.0.0.1:8000 ...
start "TelemetryHub Backend" cmd /k "cd /d %~dp0backend && uvicorn main:app --host 127.0.0.1 --port 8000"

timeout /t 2 /nobreak >nul

echo [2/2] Launching Vite React Frontend on http://127.0.0.1:5173 ...
start "TelemetryHub Frontend" cmd /k "cd /d %~dp0frontend && npx vite --host 127.0.0.1 --port 5173"

echo.
echo ===================================================
echo TelemetryHub Pro is running!
echo Frontend: http://127.0.0.1:5173
echo Backend API: http://127.0.0.1:8000/docs
echo ===================================================
timeout /t 3 >nul
start http://127.0.0.1:5173
