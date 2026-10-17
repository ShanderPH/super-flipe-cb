param(
    [string]$DataPath,
    [string]$BindAddress = '0.0.0.0',
    [ValidateRange(1, 65535)][int]$Port = 8797,
    [string[]]$AllowedHosts = @(
        'localhost',
        '127.0.0.1',
        '[::1]',
        '192.168.15.4'
    )
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$bindIp = $null
if ([Net.IPAddress]::TryParse($BindAddress, [ref]$bindIp)) {
    # Test the requested bind itself. FIN_WAIT/TIME_WAIT rows may outlive a process
    # without preventing a new server from binding to the same address and port.
    $portProbe = [Net.Sockets.Socket]::new(
        $bindIp.AddressFamily,
        [Net.Sockets.SocketType]::Stream,
        [Net.Sockets.ProtocolType]::Tcp
    )
    try {
        $portProbe.ExclusiveAddressUse = $true
        $portProbe.Bind([Net.IPEndPoint]::new($bindIp, $Port))
    } catch {
        $bindError = $_.Exception.Message
        $ownerDescription = ''
        $portCandidates = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
            Where-Object {
                $_.OwningProcess -gt 0 -and (
                    $_.LocalAddress -eq $BindAddress -or
                    $_.LocalAddress -in @('0.0.0.0', '::') -or
                    $BindAddress -in @('0.0.0.0', '::')
                )
            }
        foreach ($candidate in $portCandidates) {
            $ownerProcess = Get-Process -Id $candidate.OwningProcess -ErrorAction SilentlyContinue
            if ($ownerProcess) {
                $ownerDescription = " Processo associado: $($ownerProcess.ProcessName) (PID $($candidate.OwningProcess))."
                break
            }
        }
        throw "Não foi possível usar $($BindAddress):$Port.$ownerDescription Detalhe: $bindError Escolha outra porta com -Port <porta-livre>."
    } finally {
        $portProbe.Dispose()
    }
}
Write-Host "Super Flip CB: http://$($BindAddress):$Port/ (Ctrl+C para encerrar)"
if ($DataPath) { $env:SFCB_DATA = [IO.Path]::GetFullPath($DataPath) }
$env:SFCB_HOSTS = $AllowedHosts -join ','
Push-Location (Join-Path $projectRoot 'server')
try {
    & uv run --frozen uvicorn app.main:create_app --factory --host $BindAddress --port $Port
    if ($LASTEXITCODE) { throw 'Servidor finalizado com erro' }
} finally { Pop-Location }
