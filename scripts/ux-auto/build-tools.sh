#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/.build/uxlab"; mkdir -p "$OUT"
for t in ocr uxin winrect calm clicktest axpress motion framediff; do
  src="$ROOT/tools/ux-lab/$t.swift"
  if [ ! -x "$OUT/$t" ] || [ "$src" -nt "$OUT/$t" ]; then
    swiftc -O -o "$OUT/$t" "$src"
    echo "  built $t"
  fi
done
echo "UXLAB_TOOLS_OK: $OUT"
