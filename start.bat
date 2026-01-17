@echo off
REM Chessus Project Startup Script for Windows
REM This script starts MySQL, the backend server, and the frontend React app

echo.
echo ========================================
echo   Starting Chessus Project
echo ========================================
echo.

REM Check if MySQL service is running
echo Checking MySQL status...
sc query MySQL 2>nul | find "RUNNING" >nul
if %errorlevel% equ 0 (
    echo [OK] MySQL is already running
) else (
    echo [INFO] Starting MySQL service...
    net start MySQL 2>nul
    if %errorlevel% equ 0 (
        echo [OK] MySQL started successfully
    ) else (
        echo [WARNING] Could not start MySQL automatically.
        echo Please start MySQL manually from:
        echo   - Services (services.msc)
        echo   - MySQL Workbench
        echo   - Or run: net start MySQL (as Administrator)
        echo.
        pause
    )
)

echo.
echo Installing dependencies (if needed)...
if not exist "node_modules\" (
    echo Installing backend dependencies...
    call npm install
)

if not exist "chessus-frontend\node_modules\" (
    echo Installing frontend dependencies...
    cd chessus-frontend
    call npm install
    cd ..
)

echo.
echo ========================================
echo   Starting Backend and Frontend servers
echo ========================================
echo   Backend: http://localhost:3001
echo   Frontend: http://localhost:3000
echo.
echo Press Ctrl+C to stop all servers
echo.

REM Start both servers
call npm run dev
