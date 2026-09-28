<#
Audit Desk - Windows evidence collector (READ-ONLY)

Runs only read commands (no settings are changed, nothing is installed) and saves the
output to your Desktop as audit-windows-<computer>-<date>.txt so you can paste the
relevant parts into Audit Desk as evidence. Run PowerShell as Administrator for the
BitLocker and SMBv1 sections. Read the script before you run it.

If scripts are blocked:  powershell -ExecutionPolicy Bypass -File .\audit-windows.ps1
#>

$ErrorActionPreference = 'SilentlyContinue'
$path = Join-Path ([Environment]::GetFolderPath('Desktop')) ("audit-windows-{0}-{1:yyyyMMdd}.txt" -f $env:COMPUTERNAME, (Get-Date))

function Run([string]$Title, [scriptblock]$Block) {
    "`n=== $Title ==="
    try {
        $r = & $Block | Out-String -Width 200
        if ([string]::IsNullOrWhiteSpace($r)) { "(no output: not available or needs Administrator)" } else { $r.TrimEnd() }
    } catch { "(not available: $($_.Exception.Message))" }
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

$result = & {
    "Audit Desk - Windows evidence  |  {0:u}  |  {1}  |  Administrator: {2}" -f (Get-Date), $env:COMPUTERNAME, $isAdmin
    Run 'OS version'                    { Get-ComputerInfo | Select-Object OsName, OsVersion, OsBuildNumber }
    Run 'Recent updates (hotfixes)'     { Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 8 HotFixID, Description, InstalledOn }
    Run 'Firewall profiles'             { Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction }
    Run 'BitLocker (needs Administrator)' { Get-BitLockerVolume | Select-Object MountPoint, VolumeStatus, ProtectionStatus, EncryptionMethod }
    Run 'Defender status'               { Get-MpComputerStatus | Select-Object AMServiceEnabled, RealTimeProtectionEnabled, AntivirusSignatureLastUpdated }
    Run 'Administrators group'          { Get-LocalGroupMember -Group 'Administrators' | Select-Object Name, ObjectClass }
    Run 'Local accounts'                { Get-LocalUser | Select-Object Name, Enabled, PasswordRequired, LastLogon }
    Run 'Guest account'                 { Get-LocalUser -Name Guest | Select-Object Name, Enabled }
    Run 'Secure Boot'                   { Confirm-SecureBootUEFI }
    Run 'SMBv1 (needs Administrator)'   { Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol | Select-Object FeatureName, State }
    Run 'RDP (1 = disabled)'            { (Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server').fDenyTSConnections }
    Run 'Screen saver lock'             { Get-ItemProperty 'HKCU:\Control Panel\Desktop' | Select-Object ScreenSaveTimeOut, ScreenSaverIsSecure }
    Run 'Wi-Fi authentication'          { netsh wlan show interfaces | Select-String 'SSID|Authentication' }
    Run 'Listening TCP ports'           { Get-NetTCPConnection -State Listen | Sort-Object LocalPort | Select-Object LocalAddress, LocalPort, OwningProcess }
    Run 'Installed software'            { Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object DisplayName | Sort-Object DisplayName | Select-Object DisplayName, DisplayVersion, Publisher }
}

$result | Tee-Object -FilePath $path
"`nSaved to: $path"
