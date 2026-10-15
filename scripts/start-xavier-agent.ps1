param(
    [string]$Goal,
    [string]$Workspace = 'C:\Users\faded201\Planned-out-Xavier-',
    [string]$Resume
)
$ErrorActionPreference = 'Stop'
$az = (Get-Command az -ErrorAction SilentlyContinue).Source
if (!$az) { $az = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd' }
if (!(Test-Path $az)) { throw 'Azure CLI is required. Install it and sign in with az login.' }
if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22.13 or newer is required.' }
if (!(Test-Path $Workspace -PathType Container)) { throw 'Workspace directory does not exist.' }
if (!$Goal -and !$Resume) { $Goal = Read-Host 'What should Xavier do?' }
if (!$Goal -and !$Resume) { throw 'A goal or resume ID is required.' }

# Read non-secret model configuration and acquire the existing resource key only
# into this process. Xavier strips KEY/TOKEN/SECRET/PASSWORD variables from any
# command it executes, and the key is removed when the runner exits.
$settings = & $az webapp config appsettings list --subscription f3f4ff2b-bd08-418e-a492-f1244e4b30e8 --resource-group planned-out-xavier-rg --name planned-out-xavier --query "[?name=='AZURE_OPENAI_ENDPOINT' || name=='AZURE_OPENAI_DEPLOYMENT']" -o json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Xavier configuration. Sign in to Azure with an authorized account.' }
$config = $settings | ConvertFrom-Json
$env:AZURE_OPENAI_ENDPOINT = ($config | Where-Object name -eq 'AZURE_OPENAI_ENDPOINT').value
$env:AZURE_OPENAI_DEPLOYMENT = ($config | Where-Object name -eq 'AZURE_OPENAI_DEPLOYMENT').value
$env:AZURE_OPENAI_API_KEY = & $az cognitiveservices account keys list --subscription f3f4ff2b-bd08-418e-a492-f1244e4b30e8 --resource-group planned-out-xavier-rg --name planned-out-xavier-ai-jh --query key1 -o tsv
if ($LASTEXITCODE -ne 0 -or !$env:AZURE_OPENAI_API_KEY) { throw 'Unable to acquire the existing Xavier model credential.' }
Push-Location $Workspace
try {
    if ($Resume) { & node (Join-Path $PSScriptRoot 'xavier-agent.mjs') --resume $Resume }
    else { & node (Join-Path $PSScriptRoot 'xavier-agent.mjs') $Goal }
    if ($LASTEXITCODE -ne 0) { throw 'Xavier task stopped. Review the message above.' }
} finally {
    Pop-Location
    Remove-Item Env:AZURE_OPENAI_API_KEY -ErrorAction SilentlyContinue
}
