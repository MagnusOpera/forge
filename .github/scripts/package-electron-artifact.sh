#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <mac|windows|linux> <x64|arm64> <version>"
  exit 2
fi

platform="$1"
arch="$2"
version="$3"
app_version="${version#v}"

case "$arch" in
  x64 | arm64) ;;
  *)
    echo "ERROR: Unsupported architecture '${arch}'. Expected x64 or arm64."
    exit 1
    ;;
esac

case "$platform" in
  mac)
    if [[ "$arch" != "arm64" ]]; then
      echo "ERROR: mac packaging is currently arm64-only."
      exit 1
    fi
    builder_args=(--mac zip)
    output_suffix="mac-${arch}-unsigned"
    artifact_glob="*.zip"
    ;;
  windows)
    builder_args=(--win zip)
    output_suffix="windows-${arch}"
    artifact_glob="*.zip"
    ;;
  linux)
    builder_args=(--linux tar.gz)
    output_suffix="linux-${arch}"
    artifact_glob="*.tar.gz"
    ;;
  *)
    echo "ERROR: Unsupported platform '${platform}'. Expected mac, windows, or linux."
    exit 1
    ;;
esac

rm -rf .out/electron

npx electron-builder \
  "${builder_args[@]}" \
  "--${arch}" \
  --publish never \
  "-c.extraMetadata.version=${app_version}"

artifacts=()
while IFS= read -r artifact; do
  artifacts+=("${artifact}")
done < <(find .out/electron -maxdepth 1 -type f -name "${artifact_glob}" ! -name "*.blockmap" | sort)
if [[ "${#artifacts[@]}" -ne 1 ]]; then
  echo "ERROR: Expected exactly one ${artifact_glob} artifact for ${platform} ${arch}, found ${#artifacts[@]}."
  find .out/electron -maxdepth 2 -type f -print | sort
  exit 1
fi

extension="${artifacts[0]##*.}"
if [[ "$artifact_glob" == "*.tar.gz" ]]; then
  extension="tar.gz"
fi

mkdir -p .out
output_path=".out/forge-${version}-${output_suffix}.${extension}"
cp "${artifacts[0]}" "${output_path}"
echo "Created ${output_path}"
