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
if otool -L "$BIN" | grep -vE "/usr/lib|/System/Library|:$" | grep -q .; then
  echo "  外部 dylib を掴んでいる:" >&2
  otool -L "$BIN" | grep -vE "/usr/lib|/System/Library|:$" >&2; fail=1
else
  echo "  外部 dylib への依存なし OK"
fi
PLUGINS="$(find "$APP/Contents/Resources/plugins/builtin" -name plugin.yaml 2>/dev/null | wc -l | tr -d ' ')"
[[ "$PLUGINS" -gt 0 ]] && echo "  同梱プラグイン $PLUGINS 件 OK" \
  || { echo "  同梱プラグインが入っていない" >&2; fail=1; }

# Gatekeeper は**落とさない**。公証前は必ず rejected になるので、状態を報告するだけ。
GK="$(spctl --assess --type execute "$APP" 2>&1 | tail -1)"
if spctl --assess --type execute "$APP" >/dev/null 2>&1; then
  echo "  Gatekeeper: 受理（公証済み）"
  READINESS=NOTARIZED
else
  echo "  Gatekeeper: $GK  ← 公証が済んでいない"
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
         uiscale vad waveform; do
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
  [[ "$READINESS" == NOTARIZED ]] || echo "  ※ 公証が済むまで、他人の Mac では Gatekeeper に止められる"
  exit 0
else
  echo "RELEASE_ARTIFACT_FAIL" >&2
  exit 1
fi
