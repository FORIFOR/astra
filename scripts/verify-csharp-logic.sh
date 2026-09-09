#!/usr/bin/env bash
# Windows C#実ロジックを型検査する。XAML codegenは既存スタブを使い、
# Compile targetで参照解決も実行する。WinUIの実描画はWindows実機で検証する。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v dotnet >/dev/null 2>&1; then echo "SKIP: dotnet not available"; exit 0; fi
PROJ="$ROOT/apps/windows/logic-check"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
if ! dotnet restore "$PROJ" -v q >"$LOG" 2>&1; then
  tail -25 "$LOG" >&2
  echo "FAIL: Windows C# dependencies could not be restored" >&2
  exit 1
fi
# CoreCompileを直接呼ぶとSystem等の参照を解決せず大量のCSエラーになる。
# echo | grep -qもpipefail下ではSIGPIPEで判定が反転するため、終了状態を直接使う。
if ! dotnet build "$PROJ" -t:Compile --no-restore -v q >"$LOG" 2>&1; then
  tail -25 "$LOG" >&2
  echo "FAIL: Windows C# logic type-check" >&2
  exit 1
fi
[[ -s "$PROJ/obj/Debug/net8.0-windows10.0.19041.0/logic-check.dll" ]] || {
  echo "FAIL: Windows C# compilation produced no assembly" >&2; exit 1;
}
echo "CSLOGIC_OK: Windows C# 実ロジック全体(Window code-behind 含む)が型検査を通過"
