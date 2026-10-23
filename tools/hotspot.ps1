# Enciende o apaga el "Zona con cobertura inalambrica movil" (hotspot) de Windows 10/11
# para que los iPads se conecten directo a este PC, sin depender de la WiFi de la universidad.
# Usa el nombre y la clave de config.json (hotspotNombre, hotspotClave).
# Uso: powershell -ExecutionPolicy Bypass -File tools\hotspot.ps1 -Accion iniciar|detener|estado
# Necesita Windows PowerShell 5.1 (el que trae Windows) y un adaptador WiFi que soporte hotspot.
param([ValidateSet("iniciar", "detener", "estado")][string]$Accion = "iniciar")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$nombre = "SeUnaIA-CREA"; $clave = "crea2026ia"
$cfgPath = Join-Path $root "config.json"
if (Test-Path $cfgPath) {
  $cfg = Get-Content -Raw $cfgPath | ConvertFrom-Json
  if ($cfg.hotspotNombre) { $nombre = $cfg.hotspotNombre }
  if ($cfg.hotspotClave) { $clave = $cfg.hotspotClave }
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncAction" })[0]
# cada llamada a Windows espera como maximo 20 s para no dejar colgada la ventana
function Await($op, [Type]$type) { $t = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op)); if (-not $t.Wait(20000)) { throw "Windows no respondio a tiempo." }; $t.Result }
function AwaitAction($op) { $t = $asTaskAction.Invoke($null, @($op)); if (-not $t.Wait(20000)) { throw "Windows no respondio a tiempo." } }

[void][Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
[void][Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
$resultType = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]

function Manager {
  # El hotspot de Windows comparte una conexion existente (cable o WiFi). Sin internet,
  # se intenta con cualquier conexion activa.
  $p = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if (-not $p) { $p = [Windows.Networking.Connectivity.NetworkInformation]::GetConnectionProfiles() | Select-Object -First 1 }
  if (-not $p) { throw "Este PC no tiene ninguna conexion de red activa para compartir." }
  [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($p)
}

function Abrir-Configuracion {
  Write-Host ""
  Write-Host "  No se pudo encender el hotspot automaticamente."
  Write-Host "  Se abrira la configuracion de Windows: activa 'Zona con cobertura inalambrica movil'"
  Write-Host "  con el nombre $nombre y la clave $clave."
  Start-Process "ms-settings:network-mobilehotspot"
}

try {
  $tm = Manager
  if ($Accion -eq "estado") { Write-Host "  Hotspot: $($tm.TetheringOperationalState) ($($tm.ClientCount) conectados)"; exit 0 }
  if ($Accion -eq "detener") {
    # Windows a veces responde con error aunque sí apague, o queda "en transición": se reintenta y se confirma
    for ($i = 0; $i -lt 6 -and $tm.TetheringOperationalState -ne "Off"; $i++) {
      try { [void](Await ($tm.StopTetheringAsync()) $resultType) } catch { }
      Start-Sleep -Seconds 2
      $tm = Manager
    }
    if ($tm.TetheringOperationalState -eq "Off") { Write-Host "  Hotspot apagado." ; exit 0 }
    Write-Host "  Windows no confirmo el apagado (estado: $($tm.TetheringOperationalState))."
    Write-Host "  Apagalo en Configuracion > Zona con cobertura inalambrica movil."
    Start-Process "ms-settings:network-mobilehotspot"
    exit 1
  }
  if ($clave.Length -lt 8) { throw "La clave del hotspot debe tener al menos 8 caracteres (config.json)." }
  $ap = $tm.GetCurrentAccessPointConfiguration()
  if ($ap.Ssid -ne $nombre -or $ap.Passphrase -ne $clave) {
    $ap.Ssid = $nombre; $ap.Passphrase = $clave
    AwaitAction ($tm.ConfigureAccessPointAsync($ap))
  }
  if ($tm.TetheringOperationalState -ne "On") {
    $r = Await ($tm.StartTetheringAsync()) $resultType
    if ($r.Status -ne "Success") { throw "Windows respondio: $($r.Status) $($r.AdditionalErrorMessage)" }
  }
  # esperar a que Windows le asigne al PC la IP del hotspot, para que el servidor la muestre al arrancar
  for ($i = 0; $i -lt 20; $i++) {
    if (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like "192.168.137.*" }) { break }
    Start-Sleep -Milliseconds 750
  }
  Write-Host ""
  Write-Host "  =========================================="
  Write-Host "   HOTSPOT ENCENDIDO"
  Write-Host "   Red WiFi:  $nombre"
  Write-Host "   Clave:     $clave"
  Write-Host "  =========================================="
  Write-Host "   Conecta los iPads a esa red (o escanea el QR de la pantalla /conectar)."
  Write-Host ""
} catch {
  Write-Host "  Error: $($_.Exception.Message)"
  if ($Accion -eq "iniciar") { Abrir-Configuracion; exit 2 }
  exit 1
}
