$ErrorActionPreference = 'Stop'

$CosyRoot = Join-Path $HOME 'CosyVoice'
$Venv = Join-Path $CosyRoot '.venv-cosyvoice'
$Python312 = (Get-Command python -ErrorAction Stop).Source
$CosyCommit = '074ca6d'

Write-Host 'Installing uv into the current user Python...'
& $Python312 -m pip install --user uv
& $Python312 -m uv python install 3.10

if (-not (Test-Path $CosyRoot)) {
    git clone --recurse-submodules https://github.com/FunAudioLLM/CosyVoice.git $CosyRoot
    git -C $CosyRoot checkout $CosyCommit
    git -C $CosyRoot submodule update --init --recursive
} else {
    Write-Host "Using existing CosyVoice checkout: $CosyRoot"
}

if (-not (Test-Path $Venv)) {
    & $Python312 -m uv venv $Venv --python 3.10
}
$CosyPython = Join-Path $Venv 'Scripts\python.exe'
$ManagedPython = (& $Python312 -m uv python find 3.10).Trim()
$ManagedRoot = Split-Path $ManagedPython
$RuntimeSource = Split-Path $Python312

# Copy any official Microsoft VC runtime DLLs already available beside the
# system Python into uv's portable Python and the venv launcher directory.
$RuntimeDlls = Get-ChildItem $RuntimeSource -File | Where-Object {
    $_.Name -match '^(msvcp140.*|vcruntime140.*|concrt140|vcamp140|vccorlib140|vcomp140)\.dll$'
}
foreach ($dll in $RuntimeDlls) {
    Copy-Item $dll.FullName (Join-Path $ManagedRoot $dll.Name) -Force
    Copy-Item $dll.FullName (Join-Path (Split-Path $CosyPython) $dll.Name) -Force
}

Write-Host 'Installing CPU-only PyTorch...'
& $Python312 -m uv pip install --python $CosyPython `
    torch==2.3.1+cpu torchaudio==2.3.1+cpu `
    --index-url https://download.pytorch.org/whl/cpu

& $Python312 -m uv pip install --python $CosyPython `
    numpy==1.26.4 setuptools==75.8.0 wheel

Write-Host 'Installing Whisper and the CosyVoice Windows runtime...'
& $Python312 -m uv pip install --python $CosyPython `
    openai-whisper==20231117 --no-build-isolation
& $Python312 -m uv pip install --python $CosyPython `
    -r (Join-Path $PSScriptRoot 'cosyvoice3-requirements-windows.txt')

Write-Host 'Downloading only the CosyVoice 3 inference files...'
& $CosyPython (Join-Path $PSScriptRoot 'download-cosyvoice3-model.py')

Write-Host ''
Write-Host 'CosyVoice 3 is ready.'
Write-Host 'Start Xavier voice with:'
Write-Host "& '$CosyPython' -u '$PSScriptRoot\cosyvoice3-server.py'"
