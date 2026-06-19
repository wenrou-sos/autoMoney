$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendPort = 38427
$FrontendPort = 49271

Set-Location $ProjectRoot

if (-not (Test-Path (Join-Path $ProjectRoot 'node_modules'))) {
  Write-Host 'Installing dependencies...'
  npm install
}

foreach ($Port in @($BackendPort, $FrontendPort)) {
  $Listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

  foreach ($PidValue in $Listeners) {
    $Proc = Get-Process -Id $PidValue -ErrorAction SilentlyContinue
    if ($Proc -and ($Proc.ProcessName -eq 'node' -or $Proc.ProcessName -eq 'cmd')) {
      Stop-Process -Id $PidValue -Force -ErrorAction SilentlyContinue
    }
  }
}

$BackendOut = Join-Path $ProjectRoot 'backend.log'
$BackendErr = Join-Path $ProjectRoot 'backend.err.log'
$FrontendOut = Join-Path $ProjectRoot 'frontend.log'
$FrontendErr = Join-Path $ProjectRoot 'frontend.err.log'

Remove-Item -LiteralPath $BackendOut, $BackendErr, $FrontendOut, $FrontendErr -ErrorAction SilentlyContinue

$Backend = Start-Process `
  -FilePath 'node' `
  -ArgumentList 'server/index.js' `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $BackendOut `
  -RedirectStandardError $BackendErr `
  -PassThru

$Frontend = Start-Process `
  -FilePath 'npm.cmd' `
  -ArgumentList 'run', 'client' `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $FrontendOut `
  -RedirectStandardError $FrontendErr `
  -PassThru

Start-Sleep -Seconds 4

$HealthOk = $false
try {
  $Health = Invoke-RestMethod "http://localhost:$BackendPort/api/health"
  $HealthOk = [bool]$Health.ok
} catch {
  $HealthOk = $false
}

Write-Host "Backend PID: $($Backend.Id)"
Write-Host "Frontend PID: $($Frontend.Id)"
Write-Host "Backend: http://localhost:$BackendPort"
Write-Host "Frontend: http://localhost:$FrontendPort"
Write-Host "Backend health: $HealthOk"
Write-Host "Logs: backend.log, backend.err.log, frontend.log, frontend.err.log"

Start-Process "http://localhost:$FrontendPort"
