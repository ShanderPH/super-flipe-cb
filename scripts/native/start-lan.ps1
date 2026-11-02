param(
  [string]$Address = '192.168.15.4',
  [ValidateRange(1024,65535)][int]$Port = 8798
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$python = Join-Path $projectRoot 'server/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Instale as dependências do servidor com uv sync --project server' }
$logFolder = Join-Path $projectRoot 'artifacts/native/lan'
New-Item -ItemType Directory -Force -Path $logFolder | Out-Null
$previousHosts = [Environment]::GetEnvironmentVariable('SFCB_HOSTS', 'Process')

try {
    $env:SFCB_HOSTS = "localhost,127.0.0.1,$Address"

    $process = Start-Process `
        -FilePath $python `
        -WorkingDirectory (Join-Path $projectRoot 'server') `
        -ArgumentList @(
            '-m',
            'uvicorn',
            'app.main:create_app',
            '--factory',
            '--host', $Address,
            '--port', "$Port"
        ) `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput (Join-Path $logFolder "server-$Port.stdout.log") `
        -RedirectStandardError (Join-Path $logFolder "server-$Port.stderr.log")
}
finally {
    [Environment]::SetEnvironmentVariable('SFCB_HOSTS', $previousHosts, 'Process')
}
$record = @{ pid=$process.Id; address=$Address; port=$Port; startedAt=(Get-Date).ToUniversalTime().ToString('o') }
$record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logFolder "server-$Port.json") -Encoding utf8
for ($attempt=0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 500
  if ($process.HasExited) { throw "Servidor encerrou com código $($process.ExitCode)" }
  try {
    $health = Invoke-RestMethod -Uri "http://${Address}:$Port/api/health" -TimeoutSec 2
    if ($health.status -eq 'ok') { Write-Output "Servidor ativo: http://${Address}:$Port (PID $($process.Id))"; return }
  } catch { if ($attempt -eq 29) { throw } }
}
