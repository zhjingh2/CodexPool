#!/bin/bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_directory/.." && pwd)"
source_file="$project_root/macos/CodexPoolMemu.swift"
build_root="$project_root/.build"
output_path="$build_root/CodexPoolMemu"
deployment_target="${MACOS_DEPLOYMENT_TARGET:-13.0}"

mkdir -p "$build_root" "$build_root/module-cache"

architectures=(x86_64 arm64)
architecture_binaries=()

for architecture in "${architectures[@]}"; do
  target="${architecture}-apple-macos${deployment_target}"
  module_cache_path="$build_root/module-cache/$architecture"
  architecture_output="$build_root/CodexPoolMemu-$architecture"
  mkdir -p "$module_cache_path"

  echo "编译 macOS ${architecture}（deployment target: macOS ${deployment_target}）"
  swiftc -O -parse-as-library \
    -target "$target" \
    -module-cache-path "$module_cache_path" \
    -o "$architecture_output" \
    "$source_file" \
    -framework Cocoa \
    -framework SwiftUI

  architecture_binaries+=("$architecture_output")
done

lipo -create "${architecture_binaries[@]}" -output "$output_path"
chmod 755 "$output_path"

echo "已生成 Universal macOS 可执行文件：$output_path"
lipo -info "$output_path"
