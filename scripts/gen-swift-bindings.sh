#!/usr/bin/env bash
# astra-core の Swift bindings を生成する。生成物は手編集しない。
# 生成先: apps/astra-macos/Sources/AstraCoreFFI/{astra_core.swift, include/*}
#   --check: 既存が最新か（stale なら非0）。CI 用（gen-design-tokens と同じ作法）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$ROOT/core/astra-core"
SWIFT_DEST="$ROOT/apps/astra-macos/Sources/AstraCore"
HDR_DEST="$ROOT/apps/astra-macos/Sources/AstraCoreFFI/include"
CHECK="${1:-}"

cd "$CORE"
cargo build --quiet
LIB="$(find target/debug -maxdepth 1 -name 'libastra_core.dylib' | head -1)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cargo run --quiet --bin uniffi-bindgen -- generate --library "$LIB" --language swift --out-dir "$TMP" >/dev/null

# SwiftPM の規約に合わせて配置: Swift は AstraCore、C ヘッダ+modulemap は AstraCoreFFI/include。
mkdir -p "$TMP/swift" "$TMP/inc"
cp "$TMP/astra_core.swift" "$TMP/swift/astra_core.swift"
cp "$TMP/astra_coreFFI.h" "$TMP/inc/astra_coreFFI.h"
cat > "$TMP/inc/module.modulemap" <<MAP
module astra_coreFFI {
    header "astra_coreFFI.h"
    export *
}
MAP

if [ "$CHECK" = "--check" ]; then
  stale=0
  diff -q "$TMP/swift/astra_core.swift" "$SWIFT_DEST/astra_core.swift" >/dev/null 2>&1 || stale=1
  diff -rq "$TMP/inc" "$HDR_DEST" >/dev/null 2>&1 || stale=1
  if [ "$stale" = "1" ]; then
    echo "FAIL: swift bindings are stale. Run: pnpm gen:swift-bindings" >&2
    exit 1
  fi
  echo "swift bindings are current"
else
  mkdir -p "$SWIFT_DEST" "$HDR_DEST"
  cp "$TMP/swift/astra_core.swift" "$SWIFT_DEST/astra_core.swift"
  rm -f "$HDR_DEST"/*.h "$HDR_DEST"/module.modulemap
  cp -R "$TMP/inc/." "$HDR_DEST/"
  echo "wrote $SWIFT_DEST and $HDR_DEST"
fi
