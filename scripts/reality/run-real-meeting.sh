#!/usr/bin/env bash
# REAL_MEETING_GATE — 実 Google Meet を 2 参加者で回し、相手役は**人ではなく固定音声**にする。人手 0。
#
#   PC A（この Mac）: Astra RC が Meet を検出 → 録音 → Notes / Captions / Ask / Pause / Resume / Stop → Library → 出所
#   PC B（同じ Mac でもよい）: Playwright の Chrome が Meet に参加し、仮想マイク（BlackHole）へ WAV を流す
#
# 判定は fixture との文字列一致（tools/meet-bot/fixture.json、tools/meet-bot/judge-meeting.py）。
#
#   bash scripts/reality/run-real-meeting.sh [Astra.app] [out-dir]
#
# 段階（揃っているものだけで、できる所まで回し、足りない段は AUTOMATION_MISSING と言う）:
#   simulate : 音を使わず台本を確定行として入れる → 判定器の配線だけ確かめる（gate ではない）
#   audio    : 実マイク経路。台本 WAV を BlackHole へ流し、既定入力を BlackHole にして Astra が本当に聞く
#              （Meet は無し。検出は force）→ REAL_MEETING_GATE=PARTIAL
#   meet     : ASTRA_MEET_URL と bot プロファイルがあれば本物の Meet で → REAL_MEETING_GATE=PASS
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="${1:-$ROOT/apps/astra-macos/.build/Astra.app}"
OUT="${2:-/tmp/astra-real-meeting}"
mkdir -p "$OUT"
[[ -x "$APP/Contents/MacOS/AstraMac" ]] || { echo "AUTOMATION_MISSING: 署名済み .app（scripts/package-macos-app.sh）"; exit 2; }
pgrep -x AstraMac >/dev/null && { echo "FAIL: AstraMac が既に動いている"; exit 1; }
bash "$ROOT/tools/meet-bot/make-corpus.sh" "$OUT/corpus" >/dev/null || { echo "FAIL: corpus（say / afconvert）"; exit 1; }

have_blackhole=0; [[ -d /Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver ]] && have_blackhole=1
have_switch=0; command -v SwitchAudioSource >/dev/null && have_switch=1
have_meet=0; [[ -n "${ASTRA_MEET_URL:-}" && -d "${ASTRA_MEET_BOT_PROFILE:-/nonexistent}" ]] && ( cd "$ROOT/tools/meet-bot" && npx --no-install playwright --version >/dev/null 2>&1 ) && have_meet=1

mode=simulate
if [[ $have_blackhole -eq 1 && $have_switch -eq 1 ]]; then mode=audio; fi
if [[ $have_meet -eq 1 ]]; then mode=meet; fi
echo "  mode=$mode (blackhole=$have_blackhole switch=$have_switch meet=$have_meet)"
data="$(mktemp -d)"
rm -rf "$OUT/astra"; mkdir -p "$OUT/astra"

case "$mode" in
  simulate)
    open -W --env "ASTRA_DATA_ROOT=$data" "$APP" --args --selftest realmeeting "$OUT/astra" simulate force
    ;;
  audio)
    # Astra の入力を BlackHole に、再生の出力も BlackHole に。終わったら戻す。
    prev_in="$(SwitchAudioSource -c -t input)"; prev_out="$(SwitchAudioSource -c -t output)"
    restore() { SwitchAudioSource -t input -s "$prev_in" >/dev/null 2>&1; SwitchAudioSource -t output -s "$prev_out" >/dev/null 2>&1; }
    trap restore EXIT
    SwitchAudioSource -t input -s "BlackHole 2ch" >/dev/null
    SwitchAudioSource -t output -s "BlackHole 2ch" >/dev/null
    open --env "ASTRA_DATA_ROOT=$data" "$APP" --args --selftest realmeeting "$OUT/astra" force "seconds=40"
    sleep 6   # 検出 + 録音開始 + Notes を開くまで
    n=0
    while IFS=$'\t' read -r speaker text wav; do
      afplay "$OUT/corpus/$wav"; sleep 1.2; n=$((n+1))
      [[ $n -eq 2 ]] && sleep 6   # 一時停止の窓（bot と同じ）
    done < "$OUT/corpus/lines.tsv"
    while pgrep -x AstraMac >/dev/null; do sleep 1; done
    ;;
  meet)
    open --env "ASTRA_DATA_ROOT=$data" "$APP" --args --selftest realmeeting "$OUT/astra" "seconds=60"
    ( cd "$ROOT/tools/meet-bot" && node join.mjs "$OUT/corpus" "$OUT/bot" ) || { echo "FAIL: meet bot"; exit 1; }
    while pgrep -x AstraMac >/dev/null; do sleep 1; done
    ;;
esac
[[ -f "$OUT/astra/result.json" ]] || { echo "FAIL: Astra が result.json を書かなかった"; exit 1; }
python3 "$ROOT/tools/meet-bot/judge-meeting.py" "$ROOT/tools/meet-bot/fixture.json" "$OUT/astra"; j=$?
case "$mode" in
  meet)     [[ $j -eq 0 ]] && { echo "REAL_MEETING_GATE=PASS"; exit 0; } || { echo "REAL_MEETING_GATE=FAIL"; exit 1; } ;;
  audio)    [[ $j -eq 0 ]] && echo "REAL_MEETING_GATE=PARTIAL (実マイク経路 PASS。Meet 本体は AUTOMATION_MISSING: ASTRA_MEET_URL / bot プロファイル / playwright)" || echo "REAL_MEETING_GATE=FAIL (audio path)"; exit 2 ;;
  simulate) echo "REAL_MEETING_GATE=AUTOMATION_MISSING (simulate は配線の検査。BlackHole と SwitchAudioSource で audio、Meet の bot で PASS)"; exit 2 ;;
esac
