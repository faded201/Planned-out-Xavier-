param(
    [Parameter(Mandatory=$true)][string]$ImagePath,
    [string]$Prompt = 'Identify the main object in this image in one short sentence.',
    [string]$Endpoint = 'http://127.0.0.1:11435/v1/chat/completions',
    [string]$Model = 'qwen3-vl:2b-instruct',
    [switch]$Direct
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$source = [Drawing.Image]::FromFile((Resolve-Path $ImagePath))
$scale = [Math]::Min(1, 512 / [Math]::Max($source.Width, $source.Height))
$bitmap = New-Object Drawing.Bitmap([int]($source.Width * $scale), [int]($source.Height * $scale))
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$stream = New-Object IO.MemoryStream
try {
    $graphics.DrawImage($source, 0, 0, $bitmap.Width, $bitmap.Height)
    $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    $image = [Convert]::ToBase64String($stream.ToArray())
} finally { $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $source.Dispose() }
$mime = 'image/png'
$timer = [Diagnostics.Stopwatch]::StartNew()
if ($Direct) {
    $payload = @{ model=$Model; stream=$false; think=$false; keep_alive='2m'; messages=@(@{ role='user'; content=$Prompt; images=@($image) }); options=@{num_ctx=2048; num_predict=64; temperature=0.2} }
    $result = Invoke-RestMethod -Uri http://127.0.0.1:11434/api/chat -Method Post -ContentType application/json -Body ($payload | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 120
    $text = $result.message.content
} else {
    $protected = Import-Clixml (Join-Path $env:LOCALAPPDATA 'XavierVision\gateway-token.xml')
    $credential = New-Object System.Management.Automation.PSCredential('gateway', $protected)
    $headers = @{Authorization='Bearer '+$credential.GetNetworkCredential().Password}
    $parts = @(@{type='text'; text=$Prompt}, @{type='image_url'; image_url=@{url="data:$mime;base64,$image"}})
    $payload = @{ model=$Model; stream=$false; max_tokens=64; messages=@(@{role='user';content=$parts}) }
    $result = Invoke-RestMethod -Uri $Endpoint -Method Post -Headers $headers -ContentType application/json -Body ($payload | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 50
    $text = $result.choices[0].message.content
}
if (!$text.Trim()) { throw 'Model returned no visual observation.' }
[PSCustomObject]@{model=$Model; seconds=[Math]::Round($timer.Elapsed.TotalSeconds,2); observation=$text} | ConvertTo-Json
