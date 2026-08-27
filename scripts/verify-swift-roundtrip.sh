#!/usr/bin/env bash
# Swift → UniFFI → Rust → Swift の実 round-trip。ライブラリがリンクできただけでは不可。
# 入力を Rust へ渡し、core で処理した構造化結果を Swift で受けて検証する。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$ROOT/core/astra-core"
SWIFT="$ROOT/apps/astra-macos/Sources/AstraCore"
INC="$ROOT/apps/astra-macos/Sources/AstraCoreFFI/include"

cd "$CORE"; cargo build --quiet
LIBDIR="$CORE/target/debug"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/main.swift" <<'SWIFT'
import Foundation

// Rust (astra-core) を Swift から実際に呼ぶ。
let version = astraCoreVersion()
guard version == "0.1.0" else { fatalError("version round-trip failed: \(version)") }

// 構造化入力 → Rust で派生 → 構造化結果
let snap = recordingSnapshot(input: RecordingInput(
    elapsedMs: 261_000, isPaused: false, link: .reconnecting, pendingMs: 12_000))
guard snap.mode == .recording,
      snap.elapsedLabel == "04:21",
      snap.heroText == "録音中",
      snap.linkText == "オフライン保存中…",
      snap.pendingLabel == "未送信 約12秒",
      snap.unsynced
else { fatalError("snapshot round-trip failed: \(snap)") }

// 音声変換 (f32 → 16-bit LE) も Rust 側で
let wire = toWire(samples: [0.0, 1.0, -1.0])
guard wire.count == 6 else { fatalError("wire round-trip failed") }

print("ROUNDTRIP_OK version=\(version) elapsed=\(snap.elapsedLabel) hero=\(snap.heroText)")
SWIFT

swiftc \
  "$SWIFT/astra_core.swift" "$TMP/main.swift" \
  -I "$INC" \
  -L "$LIBDIR" -lastra_core \
  -o "$TMP/roundtrip"

OUT="$("$TMP/roundtrip")"
echo "$OUT"
[[ "$OUT" == ROUNDTRIP_OK* ]] || { echo "FAIL: round-trip assertion failed" >&2; exit 1; }
