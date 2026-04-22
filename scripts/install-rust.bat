@echo off
REM Install Rust toolchain on Windows. Idempotent — safe to re-run.
REM
REM Usage:  scripts\install-rust.bat
REM
REM This downloads rustup-init from rustup.rs and installs the stable
REM toolchain. After this finishes, open a new terminal and run:
REM
REM   cd ai-engine-rs
REM   cargo build --release
REM
REM The Rust binary is what server/ai/training-manager.js spawns to
REM perform self-play training without touching the Node game server.

where cargo >nul 2>nul
if %ERRORLEVEL%==0 (
  echo Rust is already installed:
  cargo --version
  rustc --version
  exit /b 0
)

echo Downloading rustup-init.exe...
set "RUSTUP_URL=https://win.rustup.rs/x86_64"
powershell -NoProfile -Command "Invoke-WebRequest -Uri '%RUSTUP_URL%' -OutFile '%TEMP%\rustup-init.exe'"
if errorlevel 1 (
  echo Failed to download rustup-init.exe
  exit /b 1
)

echo Running rustup-init.exe (default toolchain: stable)...
"%TEMP%\rustup-init.exe" -y --default-toolchain stable --profile minimal
if errorlevel 1 (
  echo rustup-init failed
  exit /b 1
)

echo.
echo Rust installed. Open a new terminal so PATH is refreshed, then run:
echo    cd ai-engine-rs
echo    cargo build --release
