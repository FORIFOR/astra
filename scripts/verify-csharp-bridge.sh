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
for ext in dylib so dll; do
  LIB="$ROOT/core/astra-core/target/debug/libastra_core.$ext"
  [[ -f "$LIB" ]] && cp "$LIB" "$PROJ/bin/out/"
done
# Windows では libastra_core.dll ではなく astra_core.dll を探すので、その名前でも置く。
[[ -f "$PROJ/bin/out/libastra_core.dll" ]] && cp "$PROJ/bin/out/libastra_core.dll" "$PROJ/bin/out/astra_core.dll" || true
OUT="$(cd "$PROJ/bin/out" && dotnet bridge-check.dll)"
echo "$OUT"
[[ "$OUT" == CS_OK* ]] || { echo "FAIL: C# bridge -> core" >&2; exit 1; }
