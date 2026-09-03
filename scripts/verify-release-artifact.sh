#!/usr/bin/env bash
# **配った先で動くか**を、配布物そのもので確かめる。
#
# ソースツリーで緑でも、配ると動かないことがある。実際に 2 つ出た:
#   - 署名済み .app が、ソースの絶対パスにある debug の dylib を掴んでいた
#   - 同梱プラグインがバンドルに入っておらず、開発機の絶対パスでだけ読めていた
# どちらも `swift build` も `verify:all` も通っていた。
#
# なので、ここでは:
#   - zip を**別の場所へ展開**して（利用者が受け取る形）
#   - **リポジトリの外**を作業ディレクトリにして（手元の資産に頼れない）
#   - **まっさらなデータ置き場**で（初回起動）
# 動かす。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="$(ls -t "$ROOT"/dist/Astra-*.zip 2>/dev/null | head -1)"
[[ -n "$ZIP" ]] || { echo "FAIL: dist に zip が無い。先に scripts/release-macos.sh" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; pkill -f "$WORK" 2>/dev/null || true' EXIT
ditto -x -k "$ZIP" "$WORK/app"
APP="$WORK/app/Astra.app"
BIN="$APP/Contents/MacOS/AstraMac"
[[ -x "$BIN" ]] || { echo "FAIL: 展開しても実行体が無い" >&2; exit 1; }
fail=0

echo "== 形 =="
codesign --verify --strict --deep "$APP" 2>/dev/null \
  && echo "  署名 OK" || { echo "  署名が壊れている" >&2; fail=1; }
# 先に全部受け取ってから調べる。`… | grep -q` にすると、一致した時点で grep が
# パイプを閉じ、codesign が SIGPIPE で死ぬ。pipefail の下ではそれが失敗になり、
# **正しく署名されているのに「署名されていない」と報告する**（実際そうなった）。
SIGINFO="$(codesign -dv --verbose=2 "$APP" 2>&1)"
case "$SIGINFO" in
  *"flags="*"runtime"*) echo "  hardened runtime OK";;
  *) echo "  hardened runtime が無い" >&2; fail=1;;
esac
case "$SIGINFO" in
  *"Authority=Developer ID Application"*) echo "  Developer ID OK";;
  *) echo "  Developer ID で署名されていない" >&2; fail=1;;
esac
# バンドルの外を絶対パスで掴んでいないか。`@rpath` / `@executable_path` は
# バンドル内（Contents/Frameworks）への参照なので正しい —— Sparkle がそれ。
# universal だと otool はアーキごとに見出し行（"… (architecture arm64):"）を出す。
# 見出しを依存と数えないよう、`:` で終わる行は落とす。
OUTSIDE="$(otool -L "$BIN" \
  | grep -vE ":$" \
  | grep -vE "/usr/lib|/System/Library|@rpath|@executable_path|@loader_path" | sed 's/^[[:space:]]*//')"
if [[ -n "$OUTSIDE" ]]; then
  echo "  バンドルの外を掴んでいる:" >&2; echo "$OUTSIDE" >&2; fail=1
else
  echo "  バンドル外への依存なし OK"
fi
# @rpath で参照しているものが、実際に入っているか。
if otool -L "$BIN" | grep -q "@rpath/Sparkle.framework"; then
  [[ -d "$APP/Contents/Frameworks/Sparkle.framework" ]] \
    && echo "  Sparkle 同梱 OK" \
    || { echo "  Sparkle を参照しているのに同梱されていない" >&2; fail=1; }
fi
PLUGINS="$(find "$APP/Contents/Resources/plugins/builtin" -name plugin.yaml 2>/dev/null | wc -l | tr -d ' ')"
[[ "$PLUGINS" -gt 0 ]] && echo "  同梱プラグイン $PLUGINS 件 OK" \
  || { echo "  同梱プラグインが入っていない" >&2; fail=1; }

# 落としてきたものと同じ印（quarantine）を付けて判定する。
# 印が無い状態で見ると Gatekeeper は甘くなる。利用者が受け取るのは印の付いた方。
QDIR="$WORK/quarantined"; mkdir -p "$QDIR"
cp "$ZIP" "$QDIR/dl.zip"
xattr -w com.apple.quarantine "0083;$(printf %x "$(date +%s)");Safari;" "$QDIR/dl.zip" 2>/dev/null || true
( cd "$QDIR" && ditto -x -k dl.zip . )
QAPP="$QDIR/Astra.app"

# Gatekeeper は**落とさない**。公証前は必ず rejected になるので、状態を報告するだけ。
#
# **`spctl` だけで判断しない。** 評価は経路ごとに再利用されるので、公証していない
# 版でも「受理」と出ることがある（実際に出た。同じ場所で前に公証した版を
# 評価した結果が効いていた）。券が貼られているか（staple）を別に見る。
# 券が無いと、ネットに繋がっていない利用者は開けない。
GK="$(spctl --assess --type execute "$QAPP" 2>&1 | tail -1)"
STAPLED=no
xcrun stapler validate "$QAPP" >/dev/null 2>&1 && STAPLED=yes
if spctl --assess --type execute "$QAPP" >/dev/null 2>&1 && [ "$STAPLED" = yes ]; then
  echo "  Gatekeeper: 受理・券あり（落としてきた状態でも、圏外でも開ける）"
  READINESS=NOTARIZED
elif [ "$STAPLED" = no ]; then
  echo "  Gatekeeper: $GK / 券が貼られていない"
  echo "    ← 圏外の利用者は開けない。公証と staple が要る。"
  READINESS=SIGNED_NOT_STAPLED
else
  echo "  Gatekeeper: $GK"
  echo "    ← 落としてきた状態では開けない。公証が要る。"
  READINESS=SIGNED_NOT_NOTARIZED
fi

echo "== 初回起動（何も無いところから） =="
DATA="$WORK/data"; rm -rf "$DATA"
ASTRA_DATA_ROOT="$DATA" "$BIN" >"$WORK/launch.log" 2>&1 &
PID=$!; sleep 8
if ps -p $PID >/dev/null 2>&1; then
  echo "  起動して生きている OK"
else
  echo "  起動できない / 落ちた:" >&2; tail -5 "$WORK/launch.log" >&2; fail=1
fi
kill $PID 2>/dev/null; sleep 1
[[ -f "$DATA/astra.sqlite" ]] && echo "  DB を作った OK" \
  || { echo "  DB ができていない" >&2; fail=1; }

echo "== 録音の一生（既定の置き場・強制終了を挟む） =="
DB="$DATA/astra.sqlite"
ASTRA_DATA_ROOT="$DATA" "$BIN" --selftest recordleg "$DB" record >/dev/null 2>&1 &
P=$!; sleep 6; kill -9 $P 2>/dev/null; sleep 1
for leg in inspect resume finish; do
  OUT="$(ASTRA_DATA_ROOT="$DATA" "$BIN" --selftest recordleg "$DB" $leg 2>&1 | tail -1)"
  [[ "$OUT" == RECORDLEG_OK* ]] && echo "  $leg OK" \
    || { echo "  $leg: $OUT" >&2; fail=1; }
done
FINAL="$(sqlite3 "$DB" "select status from meetings limit 1;" 2>/dev/null)"
[[ "$FINAL" == "ready" ]] && echo "  DB に ready で残った OK" \
  || { echo "  DB の最終状態が ready でない ($FINAL)" >&2; fail=1; }

echo "== 全ゲート（repo の外から） =="
PASS=0; SKIP=0; BAD=0; BADLIST=""
for t in acceptance ax axtree breakpoints browser calendar connector connectorexchange \
         connectorflow connectorstate dictation dockanim e2e001 entry files hudlifecycle \
         keychain lifecycle livemeeting livemic livescreen meetingiq navtitle panel pause \
         perf permissions presence rag record recordbutton screen screenshot secret session \
         sessionsync shortcut speech state storage sttrecognize sttstream sysaudio timer \
         uiscale update vad waveform; do
  OUT="$(cd "$WORK" && ASTRA_DATA_ROOT="$DATA" "$BIN" --selftest "$t" 2>&1 | tail -1)"
  case "$OUT" in
    SELFTEST_OK*) PASS=$((PASS+1));;
    SELFTEST_SKIP*) SKIP=$((SKIP+1));;
    *) BAD=$((BAD+1)); BADLIST="$BADLIST\n    $t: $(echo "$OUT" | cut -c1-100)";;
  esac
  pkill -f "$WORK" 2>/dev/null; sleep 0.2
done
echo "  PASS=$PASS SKIP=$SKIP FAIL=$BAD"
[[ "$BAD" -eq 0 ]] || { echo -e "  落ちたもの:$BADLIST" >&2; fail=1; }

echo
if [[ $fail -eq 0 ]]; then
  echo "RELEASE_ARTIFACT_OK: 配布物が、repo の外・まっさらな置き場で動く（$PASS PASS / $SKIP SKIP）"
  echo "RELEASE_READINESS=$READINESS"
  [[ "$READINESS" == NOTARIZED ]] || echo "  ※ 公証と staple が済むまで、配ってはいけない"
  exit 0
else
  echo "RELEASE_ARTIFACT_FAIL" >&2
  exit 1
fi
