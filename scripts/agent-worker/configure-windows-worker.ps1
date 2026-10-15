$ErrorActionPreference = 'Stop'
$privatePath = Join-Path $PSScriptRoot 'worker-private-key.xml'
$publicPath = Join-Path $PSScriptRoot 'worker-public-key.txt'
if ((Test-Path $privatePath) -or (Test-Path $publicPath)) {
    throw 'Worker signing identity already exists. Existing credentials were preserved.'
}
if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22.13 or newer is required.' }
$tempPrivate = Join-Path $env:TEMP ("xavier-worker-" + [guid]::NewGuid().ToString('N') + '.pem')
$generator = @"
const fs=require('node:fs'); const {generateKeyPairSync}=require('node:crypto');
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
fs.writeFileSync(process.argv[1],privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
fs.writeFileSync(process.argv[2],publicKey.export({type:'spki',format:'der'}).toString('base64'));
"@
try {
    & node -e $generator $tempPrivate $publicPath
    if ($LASTEXITCODE -ne 0 -or !(Test-Path $tempPrivate) -or !(Test-Path $publicPath)) { throw 'Worker key generation failed.' }
    $privateText = Get-Content $tempPrivate -Raw
    $secure = ConvertTo-SecureString $privateText -AsPlainText -Force
    $secure | Export-Clixml -Path $privatePath
    $privateText = $null
    $secure = $null
} finally {
    Remove-Item $tempPrivate -Force -ErrorAction SilentlyContinue
}
Write-Host 'Windows worker signing identity created.'
Write-Host "Public verification key: $publicPath"
Write-Host 'The private key is protected with Windows user-bound encryption.'
