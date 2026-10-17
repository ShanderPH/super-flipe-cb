param([switch]$InstallTools, [ValidateSet('1920x1080', '1280x720')][string]$Resolution = '1920x1080')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$toolsRoot = Join-Path $projectRoot 'tools/webos'
if ($InstallTools) {
    & npm.cmd ci --prefix $toolsRoot
    if ($LASTEXITCODE) { throw 'CLI installation failed' }
}
$packager = Join-Path $toolsRoot 'node_modules/.bin/ares-package.cmd'
if (-not (Test-Path -LiteralPath $packager)) { throw 'Instale o CLI opcional: package.ps1 -InstallTools. Consulte docs/security.md.' }
$output = Join-Path $projectRoot "artifacts/ipk/$Resolution"
New-Item -ItemType Directory -Force $output | Out-Null
$stage = Join-Path $output 'launcher'
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item -Path (Join-Path $projectRoot 'apps/webos-launcher/*') -Destination $stage -Force
$manifestPath = Join-Path $stage 'appinfo.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if (-not $manifest.cloudgame_active -or $manifest.version -eq '0.0.1') { throw 'Manifest must use direct gamepad input and a new version' }
$manifest.resolution = $Resolution
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8
& $packager $stage -o $output
if ($LASTEXITCODE) { throw 'IPK packaging failed' }
& uv run --project (Join-Path $projectRoot 'server') python (Join-Path $projectRoot 'scripts/package/verify-ipk.py') (Join-Path $output "com.superflipcb.app_$($manifest.version)_all.ipk") $Resolution
if ($LASTEXITCODE) { throw 'IPK manifest verification failed' }
