param(
  [Parameter(Mandatory=$true)] [string] $ResourceGroup,
  [Parameter(Mandatory=$true)] [string] $AppName,
  [string] $Location = 'australiaeast',
  [string] $SkuName = 'B1',
  [string] $PublicAppUrl = "https://$AppName.azurewebsites.net"
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$az = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
if (!(Test-Path $az)) { $az = 'az' }

function Require-Env([string] $name) {
  $value = [Environment]::GetEnvironmentVariable($name, 'Process')
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Set $name in this PowerShell session before deploying."
  }
  return $value
}

Set-Location $repoRoot
& $az account show --output none

$supabaseUrl = Require-Env 'NEXT_PUBLIC_SUPABASE_URL'
$supabaseKey = Require-Env 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
$xavierAwsApiUrl = [Environment]::GetEnvironmentVariable('XAVIER_AWS_API_URL', 'Process')
$xavierTtsUrl = [Environment]::GetEnvironmentVariable('XAVIER_TTS_URL', 'Process')
$xavierTrustedOrigin = [Environment]::GetEnvironmentVariable('XAVIER_TTS_TRUSTED_ORIGIN', 'Process')
$vapidPublicKey = [Environment]::GetEnvironmentVariable('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'Process')

npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build

& $az group create --name $ResourceGroup --location $Location --output table
& $az deployment group create `
  --resource-group $ResourceGroup `
  --template-file (Join-Path $repoRoot 'deploy\azure\app-service.bicep') `
  --parameters appName=$AppName location=$Location skuName=$SkuName publicAppUrl=$PublicAppUrl `
  --parameters supabaseUrl=$supabaseUrl supabasePublishableKey=$supabaseKey `
  --parameters xavierAwsApiUrl=$xavierAwsApiUrl xavierTtsUrl=$xavierTtsUrl xavierTtsTrustedOrigin=$xavierTrustedOrigin vapidPublicKey=$vapidPublicKey `
  --output table

$packageRoot = Join-Path $repoRoot '.azure-package'
$zipPath = Join-Path $repoRoot 'planned-out-azure.zip'
Remove-Item $packageRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $packageRoot | Out-Null
Copy-Item (Join-Path $repoRoot '.next\standalone\*') $packageRoot -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $packageRoot '.next') -Force | Out-Null
Copy-Item (Join-Path $repoRoot '.next\static') (Join-Path $packageRoot '.next\static') -Recurse -Force
Copy-Item (Join-Path $repoRoot 'public') (Join-Path $packageRoot 'public') -Recurse -Force
Compress-Archive -Path (Join-Path $packageRoot '*') -DestinationPath $zipPath -Force

& $az webapp deploy --resource-group $ResourceGroup --name $AppName --src-path $zipPath --type zip --async false --output table
& $az webapp show --resource-group $ResourceGroup --name $AppName --query '{name:name, state:state, url:defaultHostName}' --output table
Write-Host "Deployment complete: https://$AppName.azurewebsites.net"
