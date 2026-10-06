@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Desktop Pet Setup Builder

echo.
echo ========================================
echo   Desktop Pet - Windows Setup Builder
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 20 or newer, then run this file again.
  goto :failed
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js with npm included.
  goto :failed
)

if not exist "node_modules\electron-builder\package.json" (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 goto :failed
)

if defined OLLAMA_MODELS (
  set "MODEL_ROOT=%OLLAMA_MODELS%"
) else (
  set "MODEL_ROOT=%USERPROFILE%\.ollama\models"
)
set "MODEL_MANIFEST=%MODEL_ROOT%\manifests\registry.ollama.ai\library\qwen2.5\3b"

if not exist "%MODEL_MANIFEST%" (
  echo [ERROR] The Qwen2.5 3B model license metadata was not found:
  echo         %MODEL_MANIFEST%
  echo Install Ollama and run: ollama pull qwen2.5:3b
  goto :failed
)

echo Building the app and Windows installer...
echo First-run setup will install Ollama and download Qwen2.5 3B automatically.
echo.
call npm run dist
if errorlevel 1 goto :failed

echo.
echo ========================================
echo   Setup build completed successfully.
echo ========================================
echo.
if exist "release\DesktopPet Setup 0.1.0.exe" (
  echo Installer: %CD%\release\DesktopPet Setup 0.1.0.exe
  start "" explorer.exe "%CD%\release"
)
echo.
pause
exit /b 0

:failed
echo.
echo Setup build failed. Read the error above, fix the prerequisite, and run this file again.
echo.
pause
exit /b 1
