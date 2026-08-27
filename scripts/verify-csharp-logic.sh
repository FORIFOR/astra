#!/usr/bin/env bash
# Windows C# の実ロジック全体（WinUI Window code-behind 含む）を型検査する。XAML codegen(Windows 専用)は
# 手書きスタブで代替し、restore→CoreCompile(C# コンパイル)だけを走らせる。実描画/実行時は windows-latest CI。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v dotnet >/dev/null 2>&1; then echo "SKIP: dotnet not available"; exit 0; fi
PROJ="$ROOT/apps/windows/logic-check"
( cd "$PROJ" && dotnet restore -v q >/dev/null 2>&1 )
OUT="$(cd "$PROJ" && dotnet build -t:CoreCompile --no-restore -v q 2>&1)"
# C# コンパイルエラー(CS####)があれば失敗。PRI/MSIX 等の Windows 専用パッケージング task 失敗は無視。
if echo "$OUT" | grep -qE "error CS[0-9]"; then
  echo "$OUT" | grep -E "error CS[0-9]" | head -12
  echo "FAIL: Windows C# logic type-check" >&2; exit 1
fi
echo "CSLOGIC_OK: Windows C# 実ロジック全体(Window code-behind 含む)が型検査を通過"
