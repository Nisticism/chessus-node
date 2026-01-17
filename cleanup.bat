@echo off
REM Cleanup Script for Windows - Kills processes on ports 3000 and 3001

echo.
echo ========================================
echo   Cleaning up existing processes
echo ========================================
echo.

echo Checking port 3001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do (
    echo   Killing process %%a on port 3001
    taskkill /PID %%a /F >nul 2>&1
)

echo Checking port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo   Killing process %%a on port 3000
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo [OK] Cleanup complete!
echo.
