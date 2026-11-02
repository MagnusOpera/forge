#!/bin/bash
# macOS only. Run from the repository root.
set -euo pipefail
swift scripts/generate-app-icons.swift
mkdir -p .out/icon-build/forge.iconset
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" assets/forge-icon.png --out ".out/icon-build/forge.iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" assets/forge-icon.png --out ".out/icon-build/forge.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns .out/icon-build/forge.iconset -o assets/forge-icon.icns
python3 - <<'PY'
from pathlib import Path
import struct
sizes = [16, 32, 128, 256]
images = [Path(f'.out/icon-build/forge.iconset/icon_{n}x{n}.png').read_bytes() for n in sizes]
offset = 6 + 16 * len(sizes)
entries = []
for size, data in zip(sizes, images):
    entries.append(struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset))
    offset += len(data)
Path('assets/forge-icon.ico').write_bytes(struct.pack('<HHH', 0, 1, len(images)) + b''.join(entries) + b''.join(images))
PY

# Small, cache-distinct website assets.
for size in 32 128 180; do
  sips -z "$size" "$size" assets/forge-icon.png --out "website/assets/forge-ignition-${size}.png" >/dev/null
done
