#!/bin/bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_directory/.." && pwd)"
app_path="$project_root/.build/CodexPoolMemu.app"
app_resource_root="$app_path/Contents/Resources"
resource_root="$app_resource_root/codex-pool"
menu_icon="$project_root/macos/assets/codex-pool-account.png"
icon_name="CodexPoolMemu.icns"
icon_work_directory="$(mktemp -d "${TMPDIR:-/tmp}/codex-pool-icon.XXXXXX")"

cleanup() {
  rm -rf "$icon_work_directory"
}

trap cleanup EXIT

rm -rf "$app_path"
mkdir -p "$app_path/Contents/MacOS" "$resource_root/dist/src" "$resource_root/macos/assets"

swiftc -O -parse-as-library \
  -o "$app_path/Contents/MacOS/CodexPoolMemu" \
  "$project_root/macos/CodexPoolMemu.swift" \
  -framework Cocoa \
  -framework SwiftUI

cp "$project_root/macos/Info.plist" "$app_path/Contents/Info.plist"
cp "$project_root/package.json" "$resource_root/package.json"
cp -R "$project_root/dist/src/." "$resource_root/dist/src/"
cp -R "$project_root/macos/assets/." "$resource_root/macos/assets/"

iconset_path="$icon_work_directory/CodexPoolMemu.iconset"
icon_master="$icon_work_directory/icon-1024.png"
mkdir -p "$iconset_path"

# macOS 应用图标需要正方形多尺寸资源；始终从菜单栏图标生成，保证两者同步。
sips --padToHeightWidth 1024 1024 "$menu_icon" --out "$icon_master" >/dev/null

create_icon() {
  local pixels="$1"
  local filename="$2"
  sips --resampleHeightWidth "$pixels" "$pixels" "$icon_master" \
    --out "$iconset_path/$filename" >/dev/null
}

create_icon 16 icon_16x16.png
create_icon 32 icon_16x16@2x.png
create_icon 32 icon_32x32.png
create_icon 64 icon_32x32@2x.png
create_icon 128 icon_128x128.png
create_icon 256 icon_128x128@2x.png
create_icon 256 icon_256x256.png
create_icon 512 icon_256x256@2x.png
create_icon 512 icon_512x512.png
create_icon 1024 icon_512x512@2x.png

iconutil --convert icns --output "$app_resource_root/$icon_name" "$iconset_path"

chmod 755 "$app_path/Contents/MacOS/CodexPoolMemu"

echo "已生成 $app_path"
