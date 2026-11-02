param(
  [string]$Distro = 'SuperFlipNative',
  [ValidateSet('Debug', 'Release')][string]$Configuration = 'Release',
  [string]$WorkDirectory = '/opt/superflip-native',
  [string]$OutputDirectory = '',
  [ValidateRange(1, 32)][int]$Jobs = 4
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot "artifacts/native/$Configuration" }
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$scriptPath = Join-Path $projectRoot 'scripts/native/build.py'
$linuxScript = (& wsl -d $Distro --exec wslpath -a $scriptPath).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Selected WSL Linux distro is unavailable' }
$linuxOutput = (& wsl -d $Distro --exec wslpath -a $outputPath).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not translate output path' }
& wsl -d $Distro --exec python3 $linuxScript --work $WorkDirectory --output $linuxOutput --config $Configuration --jobs $Jobs
if ($LASTEXITCODE -ne 0) { throw 'Native build failed; inspect the reported build log' }
