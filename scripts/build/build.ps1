$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Push-Location (Join-Path $projectRoot 'apps/tv-client')
try {
    & npm.cmd ci
    if ($LASTEXITCODE) { throw 'npm ci failed' }
    if (Test-Path (Join-Path $projectRoot 'vendor/emulatorjs/data/src/emulator.js')) {
        & uv run --project (Join-Path $projectRoot 'server') python (Join-Path $projectRoot 'scripts/runtime/patch_runtime.py')
        if ($LASTEXITCODE) { throw 'Pinned runtime patch failed. Inspect or reinstall with server stopped.' }
        & npm.cmd run runtime:build
        if ($LASTEXITCODE) { throw 'Runtime production build failed' }
    }
    & npm.cmd run build
    if ($LASTEXITCODE) { throw 'UI build failed' }
} finally { Pop-Location }
& uv sync --project (Join-Path $projectRoot 'server') --frozen
if ($LASTEXITCODE) { throw 'Python environment failed' }
Write-Host 'Build pronto. Inicie scripts/dev/start-server.ps1 para servir UI e API na mesma origem.'
