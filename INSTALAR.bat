@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Se una IA por un d-IA - Instalador
cd /d "%~dp0"

echo.
echo   ==============================================
echo     SE UNA IA POR UN D-IA  -  Instalador alpha
echo   ==============================================
echo.
echo   No necesita internet. Solo pide permiso de administrador una vez, para el firewall.
echo   Todo queda en esta carpeta:
echo   %CD%
echo.

rem ---------- 1. Node.js ----------
set "NODE="
if exist "runtime\node.exe" set "NODE=%CD%\runtime\node.exe"
if not defined NODE (
  where node >nul 2>nul && for /f "delims=" %%N in ('where node') do if not defined NODE set "NODE=%%N"
)
if not defined NODE (
  echo   [1/4] No hay Node.js. Descargando la version portable desde nodejs.org...
  powershell -NoProfile -ExecutionPolicy Bypass -File "tools\descargar-node.ps1" -Destino "runtime"
  if exist "runtime\node.exe" set "NODE=%CD%\runtime\node.exe"
)
if not defined NODE (
  echo.
  echo   No se pudo conseguir Node.js. Opciones:
  echo     - Conectate a internet y vuelve a ejecutar INSTALAR.bat, o
  echo     - Descarga node.exe de https://nodejs.org/dist/latest-v22.x/win-x64/node.exe
  echo       y ponlo en la carpeta "runtime" de esta carpeta.
  goto :fail
)
echo   [1/4] Node.js listo: "%NODE%"

rem ---------- 2. Dependencias ----------
if exist "node_modules\socket.io\package.json" (
  echo   [2/4] Dependencias incluidas en el paquete.
) else (
  echo   [2/4] Instalando dependencias (necesita internet^)...
  where npm >nul 2>nul || (
    echo   Falta la carpeta node_modules y no hay npm en este PC.
    echo   Usa el zip completo "se-una-ia-alpha-...zip", que ya las trae.
    goto :fail
  )
  call npm install --omit=dev --no-audit --no-fund || goto :fail
)

rem ---------- 3. Configuracion ----------
echo.
echo   [3/4] Configuracion
set "PASS="
set /p "PASS=    Clave del panel admin (Enter = crea2026): "
if not defined PASS set "PASS=crea2026"
echo.
echo     Los iPads entraran escribiendo un nombre corto, por ejemplo  seunaia.local
:nombre
set "NAME="
set /p "NAME=    Nombre en la red, solo letras, numeros y guiones (Enter = seunaia): "
if not defined NAME set "NAME=seunaia"
"%NODE%" -e "process.exit(/^[a-zA-Z0-9-]{2,30}$/.test(process.argv[1])?0:1)" "%NAME%" || (echo     Usa solo letras, numeros o guiones.& goto :nombre)
rem Puerto 80 = no hay que escribir ":3000" en la direccion. Si esta ocupado, el servidor usa el 3000.
set "PORT=80"
echo.
echo     Si la WiFi de la universidad no deja que los iPads vean este PC, el servidor
echo     puede crear su propia red WiFi (hotspot). Datos de esa red:
set "HSN="
set /p "HSN=    Nombre de la red (Enter = SeUnaIA-CREA): "
if not defined HSN set "HSN=SeUnaIA-CREA"
:hsclave
set "HSC="
set /p "HSC=    Clave de la red, minimo 8 caracteres (Enter = crea2026ia): "
if not defined HSC set "HSC=crea2026ia"
"%NODE%" -e "process.exit(process.argv[1].length>=8?0:1)" "%HSC%" || (echo     Debe tener al menos 8 caracteres.& goto :hsclave)
"%NODE%" -e "const fs=require('fs');const a=process.argv;fs.writeFileSync('config.json',JSON.stringify({claveAdmin:a[1],nombre:a[2].toLowerCase(),puerto:Number(a[3])||80,hotspotNombre:a[4],hotspotClave:a[5]},null,2))" "%PASS%" "%NAME%" "%PORT%" "%HSN%" "%HSC%" || goto :fail
echo     Guardado en config.json (puedes editarlo despues con el Bloc de notas).

rem ---------- 4. Acceso directo y firewall ----------
echo.
echo   [4/4] Acceso directo en el escritorio
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Se una IA - servidor.lnk');$s.TargetPath='%CD%\INICIAR.bat';$s.WorkingDirectory='%CD%';$s.IconLocation='%CD%\public\assets\crea.ico';$s.Description='Inicia el servidor de Se una IA por un d-IA';$s.Save()" && echo     Creado: "Se una IA - servidor" en el escritorio.

echo.
echo   Firewall: para que los iPads lleguen al servidor y encuentren el nombre %NAME%.local
echo   hay que abrir los puertos %PORT% y 3000 (web) y 5353 (nombre) en todas las redes.
echo   Windows pedira permiso de administrador: acepta.
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\firewall.ps1" -Puerto %PORT%
if errorlevel 1 (
  echo     No se creo la regla. La primera vez que inicies el servidor, acepta el aviso del firewall
  echo     marcando redes privadas Y publicas.
) else (
  echo     Reglas del firewall creadas.
)

echo.
echo   ==============================================
echo     Instalacion lista.
echo     Para empezar: doble clic en INICIAR.bat
echo     (o en "Se una IA - servidor" del escritorio)
echo   ==============================================
echo.
set "GO="
set /p "GO=  Iniciar el servidor ahora? (S/N): "
if /i "%GO%"=="S" call "%CD%\INICIAR.bat"
exit /b 0

:fail
echo.
echo   La instalacion no termino. Revisa el mensaje de arriba.
pause
exit /b 1
