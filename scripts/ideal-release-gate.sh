#!/usr/bin/env bash
# IDEAL_PRODUCT_GATE — 人手 0 のリリース判定を 1 本で回す（2026-09-05、本人の最終原則）。
#
#   HUMAN_INTERVENTION = 0
#   実機・実 Google Meet・実 macOS TCC・VoiceOver 実起動・競合実 UI は使う。
#   人がクリックする・喋る・PASS を出すことは無い。
#   測れないものがあれば人を呼ばず、測定器を作る。無い測定器は AUTOMATION_MISSING と言う
#   （"NOT_MEASURED because human required" は禁止）。
#
# 20 段。1 段でも PASS 以外なら IDEAL_PRODUCT_GATE=FAIL。16・17（配布物）は
# ASTRA_RELEASE=1 のときだけ回す（配布は本人の明示の指示があってから）。
#
#   ./scripts/ideal-release-gate.sh            # 全部
#   ASTRA_GATE_SKIP="01,07" ./scripts/ideal-release-gate.sh   # 開発中に段を飛ばす（SKIPPED は PASS ではない）
#   ASTRA_GATE_WORK=/tmp/x                     # 作業場所（既定 /tmp/astra-ideal-gate）
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WORK="${ASTRA_GATE_WORK:-/tmp/astra-ideal-gate}"
SKIP=",${ASTRA_GATE_SKIP:-},"
APP="$ROOT/apps/astra-macos/.build/Astra.app"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
ATLAS_OUT="$WORK/atlas"
mkdir -p "$WORK"
REPORT="$WORK/report.md"
SHA="$(git rev-parse --short HEAD)"
: > "$REPORT"
STATUSES=""   # "01=PASS 02=FAIL …"

say() { printf '%s\n' "$*" | tee -a "$REPORT"; }
mark() {  # $1 = id, $2 = status, $3 = detail
  STATUSES="$STATUSES $1=$2"
  printf '  %-3s %-32s %-19s %s\n' "$1" "$4" "$2" "$3" | tee -a "$REPORT"
}
# step <id> <name> <pattern-that-means-PASS> <cmd…>
# 出力は $WORK/<id>.log。PASS は「終了 0 かつ pattern が出力にある」。
step() {
  local id="$1" name="$2" pat="$3"; shift 3
  if [[ "$SKIP" == *",$id,"* ]]; then mark "$id" SKIPPED "ASTRA_GATE_SKIP" "$name"; return; fi
  local log="$WORK/$id.log"
  "$@" > "$log" 2>&1; local rc=$?
  if [[ $rc -eq 0 ]] && grep -qE "$pat" "$log"; then
    mark "$id" PASS "$(grep -E "$pat" "$log" | tail -1 | cut -c1-90)" "$name"
  elif [[ $rc -eq 2 ]]; then
    # 測定器の約束: exit 2 = 測れる所まで測った / 測定器が足りない（人を呼ばない）。
    mark "$id" AUTOMATION_MISSING "$(grep -E 'AUTOMATION_MISSING|PARTIAL|SKIP' "$log" | tail -1 | cut -c1-110; true)" "$name"
  else
    mark "$id" FAIL "$(grep -E 'FAIL|error' "$log" | tail -1 | cut -c1-90; true)  → $log" "$name"
  fi
}
# 測定器がまだ無い段。あるべきスクリプトの場所を言う（人を呼ばない）。
missing() {  # $1 id, $2 name, $3 script
  local id="$1" name="$2" script="$3"
  if [[ -x "$ROOT/$script" ]]; then
    step "$id" "$name" "_GATE=PASS" bash "$ROOT/$script"
  else
    mark "$id" AUTOMATION_MISSING "測定器を作る: $script" "$name"
  fi
}

say "# IDEAL_PRODUCT_GATE — $(date '+%Y-%m-%d %H:%M') · $SHA · HUMAN_INTERVENTION=0"
say ""
say '```'
# 01 verify-all（30 段の自動 gate）
step 01 "verify-all" "VERIFY_ALL_OK" ./scripts/verify-all.sh
# 02 署名済み候補（gate 用 RC。TCC はバンドルに紐づく）
step 02 "build signed candidate" "launch: OK" bash scripts/package-macos-app.sh
# 03 UI Atlas 61/61（RC .app だけが描く → build → UI_ATLAS_GATE）
atlas() {
  bash scripts/ui-atlas/capture-rc.sh "$APP" "$ATLAS_OUT" || return 1
  python3 - "$SHA" <<'PY'
import json, sys
p = "docs/ui-atlas/manifest.json"; m = json.load(open(p, encoding="utf-8")); m["rc"]["sha"] = sys.argv[1]
open(p, "w", encoding="utf-8").write(json.dumps(m, ensure_ascii=False, indent=2) + "\n")
PY
  python3 scripts/ui-atlas/build.py "$ATLAS_OUT" || return 1
  bash scripts/verify-ui-atlas.sh
}
step 03 "UI Atlas 61/61" "UI_ATLAS_GATE=PASS" atlas
# 04 golden（shots 10 面、light / dark）
golden() {
  "$BIN" --selftest golden docs/golden-screenshots "$ATLAS_OUT/shots-light" | tail -1
  "$BIN" --selftest golden docs/golden-screenshots/dark "$ATLAS_OUT/shots-dark" | tail -1
}
step 04 "golden light+dark" "SELFTEST_OK golden" golden
# 05 SurfaceMotion 5/5（Atlas の motion/result.json）
motion() {
  python3 - "$ATLAS_OUT/motion/result.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1])); n = len(r["transitions"])
print(f"SURFACE_CONTINUITY_MOTION={'PASS' if r['pass'] and n >= 5 else 'FAIL'} transitions={n}")
PY
}
step 05 "SurfaceMotion 5/5" "SURFACE_CONTINUITY_MOTION=PASS" motion
# 06 Invocation（ms と音の真実）
invocation() { "$BIN" --selftest invocation; "$BIN" --selftest invocationaudio; }
step 06 "Invocation acoustic" "SELFTEST_OK invocationaudio" invocation
# 07-11 実機の残り。測定器が無い段は AUTOMATION_MISSING（人を呼ばない）。
missing 07 "Automated Real Meeting (2 machines)" scripts/reality/run-real-meeting.sh
missing 08 "Automated Full Keyboard Access"     scripts/reality/run-fka.sh
missing 09 "Automated VoiceOver"                scripts/reality/run-voiceover.sh
missing 10 "Automated LIVE TCC"                 scripts/reality/run-live-tcc.sh
missing 11 "Competitor capture (3 archetypes)"  scripts/reality/run-competitors.sh
# 12 盲検 vision review（3 model、観察を先に、visible_text を OCR で照合）
step 12 "blind multimodel review" "VISUAL_IDEAL_GATE=PASS" env ASTRA_JUDGE_PARALLEL=3 bash scripts/ui-atlas/review-blind.sh "docs/ui-atlas/review/$SHA"
# 13 privacy egress
step 13 "privacy egress" "PRIVACY_EGRESS_GATE=PASS" bash scripts/verify-privacy-egress.sh
# 14 recovery（録音 → kill -9 → interrupted → 続きから ready）
step 14 "recovery" "RECORDING_EXPERIENCE_OK" bash scripts/verify-recording-experience.sh
# 15 Sparkle（設定の真実 + Atlas に本物の更新の窓が撮れている）
sparkle() {
  "$BIN" --selftest update
  python3 - <<'PY'
import json
m = json.load(open("docs/ui-atlas/manifest.json", encoding="utf-8"))
s = next(x for x in m["screens"] if x["id"] == "system.update-available")
print(f"SPARKLE_WINDOW={'CAPTURED' if s.get('status') == 'CAPTURED' else 'MISSING'}")
PY
}
step 15 "Sparkle" "SPARKLE_WINDOW=CAPTURED" sparkle
# 16-17 配布物。本人の明示の指示（ASTRA_RELEASE=1）があるときだけ。
if [[ "${ASTRA_RELEASE:-0}" == "1" ]]; then
  step 16 "sign / notarization" "RELEASE_READINESS=NOTARIZED" bash scripts/release-macos.sh
  step 17 "distributed artifact tests" "RELEASE_ARTIFACT_OK" bash scripts/verify-release-artifact.sh
else
  mark 16 NOT_REQUESTED "ASTRA_RELEASE=1 で回す（配布は本人の指示があってから）" "sign / notarization"
  mark 17 NOT_REQUESTED "同上" "distributed artifact tests"
fi
# 18 ガイド生成（golden から。文は fact() だけ）
guide() { ASTRA_GUIDE_OUT="$WORK/guide/Astra-操作ガイド" ASTRA_GUIDE_BIN="$BIN" python3 docs/guide/build.py && ls "$WORK/guide/" && echo GUIDE_BUILT; }
step 18 "guide generation" "GUIDE_BUILT" guide
# 19 ガイド ↔ 実行体の一致
step 19 "guide ↔ binary parity" "GUIDE_FACTS_OK" bash scripts/verify-guide-facts.sh
say '```'
say ""

# 20 最終判定
product_fail=0; release_fail=0; missing_n=0
for kv in $STATUSES; do
  id="${kv%%=*}"; st="${kv#*=}"
  case "$id" in 16|17) [[ "$st" == PASS ]] || release_fail=1 ;;
  *) [[ "$st" == PASS ]] || product_fail=1 ;; esac
  [[ "$st" == AUTOMATION_MISSING ]] && missing_n=$((missing_n+1))
done
say "AUTOMATION_MISSING=$missing_n"
say "HUMAN_INTERVENTION=0"
if [[ $product_fail -eq 0 ]]; then say "IDEAL_PRODUCT_GATE=PASS"; else say "IDEAL_PRODUCT_GATE=FAIL"; fi
if [[ $product_fail -eq 0 && $release_fail -eq 0 ]]; then say "RELEASE_GO=YES"; else say "RELEASE_GO=NO"; fi
say ""
say "report: $REPORT"
[[ $product_fail -eq 0 && $release_fail -eq 0 ]]
