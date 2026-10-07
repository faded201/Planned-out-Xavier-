$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $RepoRoot '.venv-tts'

if (-not (Test-Path $Venv)) {
    python -m venv $Venv
}

$Python = Join-Path $Venv 'Scripts\python.exe'

& $Python -m pip install --upgrade pip setuptools wheel
& $Python -m pip install --upgrade --force-reinstall --no-deps torch==2.5.1+cpu torchaudio==2.5.1+cpu --index-url https://download.pytorch.org/whl/cpu
& $Python -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')

Write-Host ''
Write-Host 'Xavier TTS dependencies installed.'
Write-Host "Start server with: $Python $PSScriptRoot\tts-server.py"
