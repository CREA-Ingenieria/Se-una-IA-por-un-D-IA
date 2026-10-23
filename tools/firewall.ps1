# Abre en el firewall de Windows (todas las redes, incluida la del hotspot):
#   - TCP: el puerto del servidor y el 3000 de respaldo
#   - UDP 5353: mDNS, para que los iPads encuentren el nombre seunaia.local
# Si no se ejecuta como administrador, se vuelve a lanzar pidiendo permiso (un solo aviso de Windows).
# Uso: powershell -ExecutionPolicy Bypass -File tools\firewall.ps1 -Puerto 80 [-Quitar]
param([int]$Puerto = 80, [switch]$Quitar)
$nombre = "Se una IA por un d-IA"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  $argsList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-Puerto", $Puerto)
  if ($Quitar) { $argsList += "-Quitar" }
  try { $p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList $argsList; exit $p.ExitCode }
  catch { Write-Host "    No se dio permiso de administrador."; exit 1 }
}
try {
  Get-NetFirewallRule -DisplayName "$nombre*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  if (-not $Quitar) {
    $puertos = @($Puerto, 3000) | Select-Object -Unique
    New-NetFirewallRule -DisplayName "$nombre (web)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $puertos -Profile Any | Out-Null
    New-NetFirewallRule -DisplayName "$nombre (nombre .local)" -Direction Inbound -Action Allow -Protocol UDP -LocalPort 5353 -Profile Any | Out-Null
  }
  exit 0
} catch { Write-Host "    Error del firewall: $($_.Exception.Message)"; Start-Sleep 4; exit 1 }
