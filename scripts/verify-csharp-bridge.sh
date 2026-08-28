#!/usr/bin/env bash
# Windows の C# CoreBridge（apps/windows/Astra/CoreBridge/AstraCore.cs）を P/Invoke で実 core に繋ぎ、
# 正しい結果が返ることを検証する。WinUI に依存しないので、dotnet があれば Windows 実機なしで走る。
# WinUI の UI レイヤ（Windows App SDK）は Windows CI でのみビルドできる（ここでは対象外）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v dotnet >/dev/null 2>&1; then
  echo "SKIP: dotnet not available"; exit 0
fi
# 実 core の共有ライブラリを用意（cdylib）。
( cd "$ROOT/core/astra-core" && cargo build --quiet )
PROJ="$ROOT/apps/windows/bridge-check"
dotnet build "$PROJ" -v q -o "$PROJ/bin/out" >/dev/null
# DllImport("astra_core") が見つけられるよう、共有ライブラリを出力先へ置く。
# 注意: Rust の cdylib は macOS=libastra_core.dylib / Linux=libastra_core.so だが
# **Windows は lib 接頭辞なしの astra_core.dll**。両系統の名前を探す。
TARGET="$ROOT/core/astra-core/target/debug"
for f in libastra_core.dylib libastra_core.so libastra_core.dll astra_core.dll; do
  [[ -f "$TARGET/$f" ]] && cp "$TARGET/$f" "$PROJ/bin/out/"
done
# P/Invoke("astra_core") が探す名前を確実に用意する。
if [[ ! -f "$PROJ/bin/out/astra_core.dll" && -f "$PROJ/bin/out/libastra_core.dll" ]]; then
  cp "$PROJ/bin/out/libastra_core.dll" "$PROJ/bin/out/astra_core.dll"
fi
OUT="$(cd "$PROJ/bin/out" && dotnet bridge-check.dll)"
echo "$OUT"
[[ "$OUT" == CS_OK* ]] || { echo "FAIL: C# bridge -> core" >&2; exit 1; }
