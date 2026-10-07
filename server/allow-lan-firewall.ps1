$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $args = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    Start-Process powershell.exe -Verb RunAs -ArgumentList $args
    exit
}

$rules = @(
    @{ Name = 'Xavier Planner LAN (TCP 3000)'; Port = 3000 },
    @{ Name = 'Xavier TTS LAN (TCP 5173)'; Port = 5173 }
)

foreach ($rule in $rules) {
    Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule `
        -DisplayName $rule.Name `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $rule.Port `
        -RemoteAddress LocalSubnet `
        -Profile Private | Out-Null
}

Write-Host 'Xavier LAN firewall rules installed for Private networks only.'
Write-Host 'Allowed ports: 3000 (planner), 5173 (local XTTS).'
Read-Host 'Press Enter to close'
