#!/usr/bin/env bash
# Sparkle（自動更新）の xcframework を取ってくる。
#
# SPM の `.package(url:)` 依存にしたかったが、この環境では SwiftPM の
# **binary artifact の取得だけが固まる**（"Downloading binary artifact …" で
# 止まったまま進まない。同じ URL を curl は 0.7 秒で取れる）。
# 取得だけを切り出して、Package.swift からはローカルの xcframework を指す。
#
# checksum は Sparkle 自身の Package.swift が持っている値と同じものを固定する。
# 落ちてきたものが違えば止める（差し替えられたものを黙って使わない）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="2.9.6"
CHECKSUM="8d5fb41d960b43f4a68aa14126bf62b098544ec8d191cdcc73eb14e63a8e7606"
URL="https://github.com/sparkle-project/Sparkle/releases/download/${VERSION}/Sparkle-for-Swift-Package-Manager.zip"
DEST="$ROOT/apps/astra-macos/Vendor/Sparkle"

if [[ -d "$DEST/Sparkle.xcframework" && "${1:-}" != "--force" ]]; then
  echo "sparkle: 取得済み ($DEST)"
  exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "sparkle: $VERSION を取得"
curl -fsSL -o "$TMP/sparkle.zip" "$URL"
GOT="$(shasum -a 256 "$TMP/sparkle.zip" | awk '{print $1}')"
if [[ "$GOT" != "$CHECKSUM" ]]; then
  echo "FAIL: checksum が違う" >&2
  echo "  期待 $CHECKSUM" >&2
  echo "  実際 $GOT" >&2
  exit 1
fi
unzip -q "$TMP/sparkle.zip" -d "$TMP/x"
rm -rf "$DEST"; mkdir -p "$DEST"
cp -R "$TMP/x/Sparkle.xcframework" "$DEST/"
# appcast を作る / 更新に署名する / 鍵を作る。配布の手順で使う。
[[ -d "$TMP/x/bin" ]] && cp -R "$TMP/x/bin" "$DEST/bin"
echo "sparkle: $DEST に置いた（checksum 一致）"
