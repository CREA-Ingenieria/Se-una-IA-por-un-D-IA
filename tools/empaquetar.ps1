# Arma el paquete instalable para Windows: dist\se-una-ia-alpha-v<version>.zip
# Incluye Node.js portable, las dependencias ya instaladas y las tipografias, asi que
# en el PC de la universidad no hace falta internet ni permisos de administrador.
# Uso (en un PC con internet y npm): powershell -ExecutionPolicy Bypass -File tools\empaquetar.ps1
param([string]$NodeVersion = "22.20.0")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw "$root\package.json" | ConvertFrom-Json).version
$name = "se-una-ia-alpha"
$dist = Join-Path $root "dist"
$stage = Join-Path $dist $name
$zip = Join-Path $dist "$name-v$version.zip"
$cache = Join-Path $root ".cache\node-v$NodeVersion"

Write-Host "1/5 Node.js portable v$NodeVersion"
if (-not (Test-Path "$cache\node.exe")) { & "$PSScriptRoot\descargar-node.ps1" -Version $NodeVersion -Destino $cache }

Write-Host "2/5 Copiando archivos"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
$files = "server.js", "package.json", "package-lock.json", "README.md", "RECURSOS.md", "LEEME-PRIMERO.txt", "INSTALAR.bat", "INICIAR.bat"
foreach ($f in $files) { Copy-Item (Join-Path $root $f) $stage }
foreach ($d in "public", "lib", "tools", "test") { Copy-Item -Recurse (Join-Path $root $d) (Join-Path $stage $d) }
New-Item -ItemType Directory -Force "$stage\runtime" | Out-Null
Copy-Item "$cache\*" "$stage\runtime"

Write-Host "3/5 Instalando dependencias dentro del paquete"
Push-Location $stage
# npm.cmd evita el envoltorio npm.ps1, que en algunos PowerShell 5.1 parte mal los argumentos
try { & npm.cmd ci --omit=dev --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw "npm ci fallo" } } finally { Pop-Location }

Write-Host "4/5 Finales de linea de Windows en .bat y .txt"
$utf8 = New-Object System.Text.UTF8Encoding($false)
Get-ChildItem $stage -Recurse -Include *.bat, *.txt | Where-Object { $_.FullName -notmatch "node_modules" } | ForEach-Object {
  $t = [IO.File]::ReadAllText($_.FullName) -replace "`r?`n", "`r`n"
  [IO.File]::WriteAllText($_.FullName, $t, $utf8)
}

Write-Host "5/5 Comprimiendo"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
"$hash  $(Split-Path -Leaf $zip)" | Set-Content -Encoding ascii "$zip.sha256"
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ""
Write-Host "Listo: $zip ($mb MB)"
Write-Host "SHA-256: $hash"
