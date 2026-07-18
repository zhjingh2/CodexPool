#!/bin/bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_directory/.." && pwd)"
source_app_path="$project_root/.build/CodexPoolMemu.app"
installed_app_path="$HOME/Applications/CodexPoolMemu.app"
app_executable="$installed_app_path/Contents/MacOS/CodexPoolMemu"
launch_agents_directory="$HOME/Library/LaunchAgents"
launch_agent_path="$launch_agents_directory/com.codexpool.menubar.plist"
log_directory="$HOME/Library/Logs/CodexPool"
domain="gui/$UID"
label="com.codexpool.menubar"

if [[ ! -x "$source_app_path/Contents/MacOS/CodexPoolMemu" ]]; then
  echo "找不到已打包的 CodexPoolMemu.app，请先运行 npm run menu:app" >&2
  exit 1
fi

launchctl bootout "$domain/$label" 2>/dev/null || true

mkdir -p "$HOME/Applications" "$launch_agents_directory" "$log_directory"
rm -rf "$installed_app_path"
ditto "$source_app_path" "$installed_app_path"

sed \
  -e "s|__APP_EXECUTABLE__|$app_executable|g" \
  -e "s|__LOG_DIRECTORY__|$log_directory|g" \
  "$script_directory/com.codexpool.menubar.plist" > "$launch_agent_path"

# launchd 不会继承终端的代理环境；保存安装时的本地代理配置，让 App 与终端使用相同的网络出口。
for proxy_key in HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY; do
  proxy_value="${!proxy_key:-}"
  if [[ -z "$proxy_value" ]]; then
    case "$proxy_key" in
      HTTP_PROXY) proxy_value="${http_proxy:-}" ;;
      HTTPS_PROXY) proxy_value="${https_proxy:-}" ;;
      ALL_PROXY) proxy_value="${all_proxy:-}" ;;
      NO_PROXY) proxy_value="${no_proxy:-}" ;;
    esac
  fi
  if [[ -n "$proxy_value" ]]; then
    /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:$proxy_key string $proxy_value" "$launch_agent_path"
  fi
done
chmod 644 "$launch_agent_path"

launchctl bootstrap "$domain" "$launch_agent_path"
launchctl enable "$domain/$label" 2>/dev/null || true
launchctl kickstart -k "$domain/$label"

echo "已安装 App：$installed_app_path"
echo "已安装登录启动：$launch_agent_path"
