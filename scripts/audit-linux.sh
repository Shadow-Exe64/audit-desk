#!/usr/bin/env bash
# Audit Desk - Linux evidence collector (READ-ONLY)
#
# Runs only read commands (no settings are changed, nothing is installed) and saves
# the output to ~/audit-linux-<host>-<date>.txt so you can paste the relevant parts
# into Audit Desk as evidence. Some sections need sudo; they are skipped if you
# decline. Read the script before you run it: bash audit-linux.sh

OUT="${HOME}/audit-linux-$(hostname)-$(date +%Y%m%d).txt"

run() {  # run "Title" 'command'
  printf '\n=== %s ===\n' "$1"
  bash -c "$2" 2>&1 || printf '(not available or needs privileges)\n'
}

{
  echo "Audit Desk - Linux evidence  |  $(date -u '+%Y-%m-%d %H:%M UTC')  |  $(hostname)"
  run "OS and kernel"                'cat /etc/os-release | head -6; uname -r'
  run "Pending updates"              'apt list --upgradable 2>/dev/null | head -25 || dnf check-update 2>/dev/null | head -25'
  run "Automatic updates"            'systemctl is-enabled unattended-upgrades 2>/dev/null; systemctl is-active dnf-automatic.timer 2>/dev/null'
  run "Firewall (ufw)"               'sudo -n ufw status verbose 2>/dev/null || ufw status 2>/dev/null || echo "run: sudo ufw status verbose"'
  run "Disk encryption (LUKS)"       'lsblk -o NAME,TYPE,FSTYPE,MOUNTPOINT | grep -Ei "NAME|crypt|luks" || echo "no crypt volumes found"'
  run "Admin / sudo group members"   'getent group sudo wheel'
  run "Login-capable accounts"       'grep -E ":/(bin|usr/bin)/(bash|zsh|sh|fish):" /etc/passwd | cut -d: -f1,3,7'
  run "Guest account"                'grep -i guest /etc/passwd || echo "no guest account in /etc/passwd"'
  run "Accounts with EMPTY password" 'sudo -n awk -F: "(\$2==\"\"){print \$1}" /etc/shadow 2>/dev/null || echo "run with sudo to check /etc/shadow"'
  run "Listening ports"              'ss -tulpn 2>/dev/null || ss -tuln'
  run "SSH service"                  'systemctl is-active ssh sshd 2>/dev/null'
  run "Secure Boot"                  'mokutil --sb-state'
  run "Screen lock (GNOME)"          'gsettings get org.gnome.desktop.session idle-delay; gsettings get org.gnome.desktop.screensaver lock-enabled'
  run "Wi-Fi security"               'nmcli -f SSID,SECURITY dev wifi | head -10'
  run "Installed package count"      'dpkg -l 2>/dev/null | grep -c "^ii" || rpm -qa | wc -l'
  run "Snap / Flatpak apps"          'snap list 2>/dev/null; flatpak list 2>/dev/null'
} | tee "$OUT"

echo
echo "Saved to: $OUT"
