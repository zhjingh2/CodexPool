#!/bin/bash
set -euo pipefail

launch_agent_path="$HOME/Library/LaunchAgents/com.codexpool.menubar.plist"
installed_app_path="$HOME/Applications/CodexPoolMemu.app"
domain="gui/$UID"
label="com.codexpool.menubar"

launchctl bootout "$domain/$label" 2>/dev/null || true
rm -f "$launch_agent_path"
rm -rf "$installed_app_path"

echo "已移除 CodexPoolMemu App 和登录启动"
