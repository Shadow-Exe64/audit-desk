#!/usr/bin/env bash
# Audit Desk - macOS evidence collector (READ-ONLY)
#
# Runs only read commands (no settings are changed, nothing is installed) and saves
# the output to ~/audit-macos-<host>-<date>.txt so you can paste the relevant parts
# into Audit Desk as evidence. A few sections use sudo and will prompt for your
# password; press Ctrl+C at the prompt to skip them. Read the script before you run
# it: bash audit-macos.sh

OUT="${HOME}/audit-macos-$(hostname -s)-$(date +%Y%m%d).txt"

run() {  # run "Title" 'command'
  printf '\n=== %s ===\n' "$1"
  bash -c "$2" 2>&1 || printf '(not available or needs privileges)\n'
}

{
  echo "Audit Desk - macOS evidence  |  $(date -u '+%Y-%m-%d %H:%M UTC')  |  $(hostname -s)"
  run "macOS version"               'sw_vers'
  run "Pending software updates"    'softwareupdate -l 2>&1 | head -30'
  run "Application firewall"        '/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate'
  run "Firewall stealth mode"       '/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode'
  run "FileVault disk encryption"   'fdesetup status'
  run "Admin group members"         'dscl . -read /Groups/admin GroupMembership'
  run "Guest account (1 = enabled)" 'defaults read /Library/Preferences/com.apple.loginwindow GuestEnabled'
  run "System Integrity Protection" 'csrutil status'
  run "Gatekeeper"                  'spctl --status'
  run "Screen lock"                 'sysadminctl -screenLock status 2>&1'
  run "Wi-Fi security"              'system_profiler SPAirPortDataType 2>/dev/null | grep -E "Security:|Current Network" | head -6'
  run "Remote login (SSH)"          'sudo systemsetup -getremotelogin'
  run "Listening ports"             'sudo lsof -iTCP -sTCP:LISTEN -n -P'
  run "Latest Time Machine backup"  'tmutil latestbackup'
  run "Installed applications"      'ls /Applications ~/Applications 2>/dev/null'
} | tee "$OUT"

echo
echo "Saved to: $OUT"
