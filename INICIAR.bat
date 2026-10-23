@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Se una IA por un d-IA - SERVIDOR (no cerrar)
cd /d "%~dp0"

set "NODE="
if exist "runtime\node.exe" set "NODE=%CD%\runtime\node.exe"
if not defined NODE (
  where node >nul 2>nul && for /f "delims=" %%N in ('where node') do if not defined NODE set "NODE=%%N"
)
if not defined NODE (
  echo No se encontro Node.js. Ejecuta primero INSTALAR.bat.
  pause
  exit /b 1
)
if not exist "node_modules\socket.io\package.json" (
  echo Faltan las dependencias. Ejecuta primero INSTALAR.bat.
  pause
  exit /b 1
)

rem Opciones: INICIAR.bat [red^|hotspot] [--nueva]
rem   red / hotspot  salta el menu      --nueva  ignora el respaldo y empieza de cero
set "MODO="
set "EXTRA="
for %%A in (%*) do (
  if /i "%%~A"=="red" set "MODO=red"
  if /i "%%~A"=="hotspot" set "MODO=hotspot"
  if /i "%%~A"=="--nueva" set "EXTRA=--nueva"
)
if /i "%MODO%"=="red" goto :red
if /i "%MODO%"=="hotspot" goto :hotspot

echo.
echo   SE UNA IA POR UN D-IA
echo.
echo   Como se van a conectar los iPads?
echo     1. A la red donde ya esta este PC (WiFi o cable de la sala)
echo     2. A una red WiFi propia creada por este PC (hotspot)
echo        Usala si los iPads no ven al PC en la WiFi de la universidad.
echo.
choice /c 12 /n /m "  Escribe 1 o 2: "
if errorlevel 2 goto :hotspot

:red
set "HOTSPOT="
goto :run

:hotspot
set "HOTSPOT=1"
set "EXTRA=%EXTRA% --hotspot"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\hotspot.ps1" -Accion iniciar
if errorlevel 2 (
  echo.
  echo   Cuando el hotspot este activo en la configuracion de Windows, presiona una tecla.
  pause >nul
)

:run
"%NODE%" server.js --abrir %EXTRA%
echo.
echo El servidor se detuvo.
if defined HOTSPOT (
  choice /c SN /n /m "Apagar el hotspot? (S/N): "
  if not errorlevel 2 powershell -NoProfile -ExecutionPolicy Bypass -File "tools\hotspot.ps1" -Accion detener
)
pause
