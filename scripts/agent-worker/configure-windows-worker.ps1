$ErrorActionPreference = 'Stop'
$secretPath = Join-Path $PSScriptRoot 'worker-token.xml'
if (Test-Path $secretPath) { throw 'Worker is already paired. Existing credentials were preserved.' }
$secret = Read-Host 'Enter the Windows worker token from the server configuration' -AsSecureString
if ($secret.Length -lt 43) { throw 'Worker tokens must be at least 43 characters.' }
$secret | Export-Clixml -Path $secretPath
Write-Host 'Worker credential saved with Windows user-bound encryption.'
