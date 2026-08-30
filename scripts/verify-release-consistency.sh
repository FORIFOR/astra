#!/usr/bin/env bash
# 版番号が全部同じか、配布経路が壊れていないか。
#
# 版番号は 4 か所に散っている。ずれたまま配ると、更新の判定も、
# 不具合の報告に付く版も当てにならなくなる。実際 package.json だけ
# 0.0.0 のまま取り残されていた。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

PKG="$(node -p "require('$ROOT/package.json').version")"
TAURI="$(node -p "require('$ROOT/apps/desktop/src-tauri/tauri.conf.json').version")"
CARGO_APP="$(grep -m1 '^version' "$ROOT/apps/desktop/src-tauri/Cargo.toml" | sed 's/.*"\(.*\)".*/\1/')"
CARGO_CORE="$(grep -m1 '^version' "$ROOT/core/astra-core/Cargo.toml" | sed 's/.*"\(.*\)".*/\1/')"

echo "  package.json=$PKG tauri.conf.json=$TAURI src-tauri/Cargo.toml=$CARGO_APP astra-core/Cargo.toml=$CARGO_CORE"
for v in "$TAURI" "$CARGO_APP" "$CARGO_CORE"; do
  [[ "$v" == "$PKG" ]] || { echo "  版番号がずれている（$PKG と $v）" >&2; fail=1; }
done

# 配布物は**外の dylib を掴まない**こと。掴むと、その絶対パスが無い機械では起動しない。
BIN="$ROOT/apps/astra-macos/.build/release/AstraMac"
if [[ -f "$BIN" ]]; then
  if otool -L "$BIN" | grep -q "astra_core.*dylib"; then
    echo "  release の実行体が astra_core を dylib で掴んでいる" >&2; fail=1
  fi
fi

# 実行体に**開発機の絶対パス**が焼き込まれていないこと。
# 焼き込まれていると、そのパスがある機械でだけ動いて、配った先で静かに欠ける
# （同梱プラグインが実際にそうなっていた: バンドルに入れ忘れていたが、
#  ソースの絶対パスで拾えるので手元では 12 件読めていた）。
if grep -rn "/Users/[a-z]" "$ROOT/apps/astra-macos/Sources/AstraMac" --include='*.swift' \
     | grep -v "^.*SelfTest.swift" | grep -q .; then
  echo "  ソースに個人の絶対パスが残っている:" >&2
  grep -rn "/Users/[a-z]" "$ROOT/apps/astra-macos/Sources/AstraMac" --include='*.swift' \
    | grep -v "SelfTest.swift" | head -5 >&2
  fail=1
fi

# 組み上がった .app があるなら、**バンドルとして**成立しているか見る。
APP="$ROOT/dist/Astra.app"
if [[ -d "$APP" ]]; then
  n="$(find "$APP/Contents/Resources/plugins/builtin" -name plugin.yaml 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$n" -gt 0 ]] || { echo "  dist/Astra.app に同梱プラグインが入っていない" >&2; fail=1; }
fi

# 配布スクリプトは Developer ID を要求すること（開発署名で配らない）。
grep -q "Developer ID Application" "$ROOT/scripts/release-macos.sh" || {
  echo "  release-macos.sh が Developer ID を要求していない" >&2; fail=1; }
grep -q "options runtime" "$ROOT/scripts/release-macos.sh" || {
  echo "  release-macos.sh が hardened runtime を付けていない" >&2; fail=1; }

if [[ $fail -eq 0 ]]; then
  echo "RELEASE_CONSISTENCY_OK: 版番号 $PKG で一致・配布物は外部 dylib を掴まない・Developer ID + hardened runtime"
else
  echo "RELEASE_CONSISTENCY_FAIL" >&2; exit 1
fi
