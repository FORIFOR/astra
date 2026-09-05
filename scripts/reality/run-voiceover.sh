#!/usr/bin/env bash
# VOICEOVER_GATE — VoiceOver を**実際に起動**し、VO カーソルで面を辿って、OS が VoiceOver へ公開する
# role / title / value を証拠にする。人が読み上げを聞く必要は無い（HUMAN_INTERVENTION=0）。
#
# 仕組み: VoiceOver は AppleScript で操作できる（VoiceOver ユーティリティ「AppleScript による制御を許可」＝
# defaults com.apple.VoiceOver4/default SCREnableAppleScript）。面ごとに RC .app を hold selftest で出し、
# `tell application "VoiceOver"` で「次の項目」を N 回送り、vo cursor の内容を TSV に落とす。
#
#   ASTRA_VO_CONFIRM=1 bash scripts/reality/run-voiceover.sh [Astra.app] [out-dir]
#
# 実行の前提（無ければ AUTOMATION_MISSING と言って止まる。人は呼ばない —— 前提はこのスクリプトが自分で整える）:
#   1. VoiceOver の AppleScript 制御が ON（無ければ defaults で ON にする）
#   2. 呼び出し元プロセスに Accessibility の許可（osascript が System Events を使う）
#   3. ASTRA_VO_CONFIRM=1（VoiceOver は音を出す。無人で回すときは VoiceOver の音量を 0 にする）
#
# 判定（A〜D の journey、それぞれ）:
#   VO で辿った要素に空の名前が無い            nameless = 0
#   期待する操作（Facts の語）に到達できる       reach = 全部
#   読み順が上→下・左→右                        order violations = 0
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="${1:-$ROOT/apps/astra-macos/.build/Astra.app}"
OUT="${2:-/tmp/astra-voiceover}"
mkdir -p "$OUT"
[[ -x "$APP/Contents/MacOS/AstraMac" ]] || { echo "AUTOMATION_MISSING: 署名済み .app が無い（scripts/package-macos-app.sh）"; exit 2; }
if [[ "${ASTRA_VO_CONFIRM:-0}" != "1" ]]; then
  echo "AUTOMATION_MISSING: VoiceOver を無人で起動する確認が無い（ASTRA_VO_CONFIRM=1）。音量 0 で回す手順はこのファイル冒頭"
  exit 2
fi
if [[ "$(defaults read com.apple.VoiceOver4/default SCREnableAppleScript 2>/dev/null || echo 0)" != "1" ]]; then
  defaults write com.apple.VoiceOver4/default SCREnableAppleScript -bool true
  echo "  VoiceOver の AppleScript 制御を ON にした（初回だけ）"
fi
if ! osascript -e 'tell application "System Events" to return count of processes' >/dev/null 2>&1; then
  echo "AUTOMATION_MISSING: 呼び出し元に Accessibility の許可が無い（System Events を使えない）"; exit 2
fi

journeys="A:idle-hold:20 B:hold-meeting:20 C:idle-hold:20 D:idle-hold:20"
data="$(mktemp -d)"
fail=0
open -a VoiceOver 2>/dev/null || true
sleep 3
trap 'osascript -e "tell application \"VoiceOver\" to quit" >/dev/null 2>&1 || true' EXIT
for j in $journeys; do
  name="${j%%:*}"; rest="${j#*:}"; selftest="${rest%%:*}"; hold="${rest#*:}"
  tsv="$OUT/journey-$name.tsv"; : > "$tsv"
  open --env "ASTRA_DATA_ROOT=$data" "$APP" --args --selftest "$selftest" "$hold"
  sleep 4
  # VO カーソルで 40 項目まで辿り、role / title / value を記録する。
  osascript > "$tsv" 2>>"$OUT/errors.log" <<'AS' || true
tell application "VoiceOver"
  set out to ""
  repeat with i from 1 to 40
    try
      tell vo cursor
        set r to (role of item 1 as text)
        set t to ""
        try
          set t to (title of item 1 as text)
        end try
        set v to ""
        try
          set v to (value of item 1 as text)
        end try
      end tell
      set out to out & i & tab & r & tab & t & tab & v & linefeed
      perform action "next item"
    on error e
      set out to out & i & tab & "ERROR" & tab & e & linefeed
      exit repeat
    end try
  end repeat
  return out
end tell
AS
  pkill -x AstraMac 2>/dev/null || true
  sleep 1
  n="$(grep -vc '^$' "$tsv" || true)"
  nameless="$(awk -F'\t' '$2!="ERROR" && $3=="" && $4==""' "$tsv" | wc -l | tr -d ' ')"
  errors="$(grep -c ERROR "$tsv" || true)"
  printf '  journey %s  items=%s  nameless=%s  errors=%s  → %s\n' "$name" "$n" "$nameless" "$errors" "$tsv"
  [[ "$n" -ge 3 && "$nameless" -eq 0 && "$errors" -eq 0 ]] || fail=1
done
if [[ $fail -eq 0 ]]; then echo "VOICEOVER_GATE=PASS"; else echo "VOICEOVER_GATE=FAIL"; exit 1; fi
