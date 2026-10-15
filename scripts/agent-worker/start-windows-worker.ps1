param(
    [string]$Server = 'https://planned-out-xavier.azurewebsites.net',
    [string]$Workspace = "$env:LOCALAPPDATA\XavierAgent\Tasks"
)
$ErrorActionPreference = 'Stop'
$az = (Get-Command az -ErrorAction SilentlyContinue).Source
if (!$az) { $az = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd' }
if (!(Test-Path $az)) { throw 'Azure CLI is required.' }
$privatePath = Join-Path $PSScriptRoot 'worker-private-key.xml'
if (!(Test-Path $privatePath)) { throw 'Run configure-windows-worker.ps1 before starting this worker.' }
$credential = New-Object System.Management.Automation.PSCredential('worker', (Import-Clixml $privatePath))
$env:XAVIER_AGENT_PRIVATE_KEY = $credential.GetNetworkCredential().Password
$credential = $null
$env:XAVIER_AGENT_SERVER = $Server
$env:XAVIER_AGENT_WORKSPACE = $Workspace
$env:XAVIER_AZ_PATH = $az
$settings = & $az webapp config appsettings list --subscription f3f4ff2b-bd08-418e-a492-f1244e4b30e8 --resource-group planned-out-xavier-rg --name planned-out-xavier --query "[?name=='AZURE_OPENAI_ENDPOINT' || name=='AZURE_OPENAI_DEPLOYMENT']" -o json
if ($LASTEXITCODE -ne 0) { throw 'Cannot load model configuration. Sign in to Azure.' }
$config = $settings | ConvertFrom-Json
$env:AZURE_OPENAI_ENDPOINT = ($config | Where-Object name -eq 'AZURE_OPENAI_ENDPOINT').value
$env:AZURE_OPENAI_DEPLOYMENT = ($config | Where-Object name -eq 'AZURE_OPENAI_DEPLOYMENT').value
$env:AZURE_OPENAI_API_KEY = & $az cognitiveservices account keys list --subscription f3f4ff2b-bd08-418e-a492-f1244e4b30e8 --resource-group planned-out-xavier-rg --name planned-out-xavier-ai-jh --query key1 -o tsv
if ($LASTEXITCODE -ne 0 -or !$env:AZURE_OPENAI_API_KEY) { throw 'Cannot acquire the existing Xavier model credential.' }
try {
    & node (Join-Path $PSScriptRoot 'worker.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Worker stopped with an error.' }
} finally {
    Remove-Item Env:XAVIER_AGENT_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:AZURE_OPENAI_API_KEY -ErrorAction SilentlyContinue
}
