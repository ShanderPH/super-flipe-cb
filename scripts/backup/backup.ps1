param([Parameter(Mandatory)][string]$DataPath, [Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference = 'Stop'
$saveRoot = Join-Path ([IO.Path]::GetFullPath($DataPath)) 'saves'
$backupRoot = [IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath $saveRoot -PathType Container)) { throw 'Pasta saves inexistente' }
New-Item -ItemType Directory -Force $backupRoot | Out-Null
$archive = Join-Path $backupRoot ('superflip-saves-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
if (Test-Path -LiteralPath $archive) { throw 'Backup já existe' }
# Quiesce the server first to capture a consistent multi-slot snapshot.
$envelopes = Get-ChildItem -LiteralPath $saveRoot -Filter '*.json' -File
if (-not $envelopes) { throw 'Nenhum save para copiar' }
Compress-Archive -LiteralPath $envelopes.FullName -DestinationPath $archive
Write-Host "Backup criado: $archive"
