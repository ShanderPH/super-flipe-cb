param([Parameter(Mandatory)][string]$Device, [Parameter(Mandatory)][string]$Ipk)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$installer = Join-Path $projectRoot 'tools/webos/node_modules/.bin/ares-install.cmd'
if (-not (Test-Path -LiteralPath $Ipk -PathType Leaf)) { throw 'IPK inexistente' }
if (-not (Test-Path -LiteralPath $installer)) { throw 'CLI opcional não instalado' }
# Only runs when this explicit deployment script is invoked by the operator.
& $installer --device $Device $Ipk
if ($LASTEXITCODE) { throw 'Instalação na TV falhou' }
