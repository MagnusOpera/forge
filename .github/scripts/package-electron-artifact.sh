#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <mac> <arm64> <version>"
  exit 2
fi

platform="$1"
arch="$2"
version="$3"
app_version="${version#v}"

case "$arch" in
  arm64) ;;
  *)
    echo "ERROR: Unsupported architecture '${arch}'. Expected arm64."
    exit 1
    ;;
esac

case "$platform" in
  mac)
    builder_args=(--mac zip)
    output_suffix="mac-${arch}-unsigned"
    artifact_glob="*.zip"
    ;;
  *)
    echo "ERROR: Unsupported platform '${platform}'. Expected mac."
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

mkdir -p .out
output_path=".out/forge-${version}-${output_suffix}.${extension}"
cp "${artifacts[0]}" "${output_path}"
echo "Created ${output_path}"
