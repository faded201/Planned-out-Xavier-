param([string]$Model = 'qwen3-vl:2b-instruct')
$ErrorActionPreference = 'Stop'
$secretDirectory = Join-Path $env:LOCALAPPDATA 'XavierVision'
$secretPath = Join-Path $secretDirectory 'gateway-token.xml'
if (!(Test-Path $secretPath)) {
    New-Item -ItemType Directory -Path $secretDirectory -Force | Out-Null
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    ConvertTo-SecureString $secret -AsPlainText -Force | Export-Clixml -Path $secretPath
    $secret = $null
}
# Windows DPAPI binds this stored token to the current user and machine.
$protectedToken = Import-Clixml $secretPath
$credential = New-Object System.Management.Automation.PSCredential('gateway', $protectedToken)
$env:XAVIER_VISION_API_KEY = $credential.GetNetworkCredential().Password
$env:XAVIER_VISION_MODEL = $Model
try {
    & node (Join-Path $PSScriptRoot 'xavier-vision-gateway.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Vision gateway exited unsuccessfully.' }
} finally {
    Remove-Item Env:XAVIER_VISION_API_KEY -ErrorAction SilentlyContinue
}
