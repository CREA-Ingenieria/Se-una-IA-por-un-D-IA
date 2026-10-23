# Descarga node.exe portable (Windows x64) desde nodejs.org y verifica su firma SHA-256.
# Uso: powershell -ExecutionPolicy Bypass -File tools\descargar-node.ps1 [-Version 22.20.0] [-Destino runtime]
param(
  [string]$Version = "22.20.0",
  [string]$Destino = "runtime"
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$base = "https://nodejs.org/dist/v$Version"
New-Item -ItemType Directory -Force -Path $Destino | Out-Null
$exe = Join-Path $Destino "node.exe"
$tmp = "$exe.descarga"

Write-Host "    Descargando $base/win-x64/node.exe ..."
Invoke-WebRequest -UseBasicParsing -Uri "$base/win-x64/node.exe" -OutFile $tmp
$sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt").Content
$line = ($sums -split "`n") | Where-Object { $_ -match "\swin-x64/node\.exe\s*$" } | Select-Object -First 1
if (-not $line) { throw "No se encontro la firma de win-x64/node.exe en SHASUMS256.txt" }
$expected = ($line -split "\s+")[0].ToLower()
$actual = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower()
if ($expected -ne $actual) { Remove-Item $tmp -Force; throw "La firma de node.exe no coincide (descarga danada o alterada)." }
Move-Item -Force $tmp $exe
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/nodejs/node/v$Version/LICENSE" -OutFile (Join-Path $Destino "LICENSE-node.txt") -ErrorAction SilentlyContinue
Write-Host "    node.exe v$Version verificado (SHA-256 $actual)."
