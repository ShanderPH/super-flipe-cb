param(
  [Parameter(Mandatory=$true)][string]$BuildDirectory,
  [string]$Distro = 'SuperFlipNative',
  [string]$OutputDirectory = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$buildPath = (Resolve-Path -LiteralPath $BuildDirectory).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $buildPath 'ipk' }
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$scriptPath = Join-Path $projectRoot 'scripts/native/package.py'
$linuxScript = (& wsl -d $Distro --exec wslpath -a $scriptPath).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Selected WSL Linux distro is unavailable' }
$linuxBuild = (& wsl -d $Distro --exec wslpath -a $buildPath).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not translate build path' }
$linuxOutput = (& wsl -d $Distro --exec wslpath -a $outputPath).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not translate output path' }
& wsl -d $Distro --exec python3 $linuxScript --build $linuxBuild --output $linuxOutput
if ($LASTEXITCODE -ne 0) { throw 'Native packaging/verification failed; inspect the reported error' }
# Never installs, launches or accesses a TV.
