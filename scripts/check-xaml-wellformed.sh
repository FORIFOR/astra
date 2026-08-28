#!/usr/bin/env bash
# Windows の .xaml が整形式 XML であることを検証する（構文レベル）。WinUI の XAML→C# codegen は
# Windows 専用の XamlCompiler.exe が要り macOS では動かないが、**マークアップの整形式性はどのホストでも
# xmllint で確認できる**（閉じ忘れ・属性崩れ等を止める）。完全な WinUI 検証は windows-latest CI。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v xmllint >/dev/null 2>&1; then echo "SKIP: xmllint not available"; exit 0; fi
fail=0
count=0
while IFS= read -r f; do
  count=$((count+1))
  if ! xmllint --noout "$f" 2>/tmp/xaml-err; then
    echo "FAIL: $f is not well-formed XML" >&2; cat /tmp/xaml-err >&2; fail=1
  fi
done < <(find "$ROOT/apps/windows" -name "*.xaml")
# app.manifest（unpackaged WinUI 3 の DPI/supportedOS 宣言）も整形式であること。
while IFS= read -r f; do
  count=$((count+1))
  if ! xmllint --noout "$f" 2>/tmp/xaml-err; then
    echo "FAIL: $f is not well-formed XML" >&2; cat /tmp/xaml-err >&2; fail=1
  fi
done < <(find "$ROOT/apps/windows" -name "*.manifest")
if [[ $fail -ne 0 ]]; then exit 1; fi
echo "xaml well-formed: $count WinUI .xaml files OK"
