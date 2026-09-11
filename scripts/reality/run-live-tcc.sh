#!/usr/bin/env bash
# LIVE_TCC_GATE — 実 macOS の TCC を機械でリセットし、署名済み RC が**その機能を使う瞬間にだけ**
# 許可を求めること、断られたときの UI と直しに行く道、許したあとの復帰を、人手 0 で確かめる。
#
# 以前は「TCC のリセットは本人が行う」だった（RC-SESSION-RUNBOOK.md §5）。ここでは tccutil で
# com.astra.desktop の許可を消し、RC を起動して実ダイアログを AX で検出・押下する。
#
#   ASTRA_TCC_CONFIRM=1 bash scripts/reality/run-live-tcc.sh [Astra.app] [out-dir]
#
# **端末の設定を変える**ので、無人で回すには ASTRA_TCC_CONFIRM=1 が要る（無ければ AUTOMATION_MISSING）。
# 終わったあと、マイク / カレンダーの許可は「拒否」のまま残る（ダイアログで許す経路はここで機械が押す）。
#
# 判定:
#   startup bulk permission requests = 0   起動直後に TCC ダイアログが出ない（10 秒観測）
#   purpose-first                    = 100% ダイアログはその機能（livemic / calendarlive）を使った瞬間にだけ出る
#   deny recovery                    = PASS 断られたあと Astra が理由と「設定を開く」を出す（結果面 result-openSettings）
#   grant recovery                   = PASS 許したあと同じ journey が再起動なしで続く
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="${1:-$ROOT/apps/astra-macos/.build/Astra.app}"
OUT="${2:-/tmp/astra-live-tcc}"
BUNDLE=com.astra.desktop
mkdir -p "$OUT"
[[ -x "$APP/Contents/MacOS/AstraMac" ]] || { echo "AUTOMATION_MISSING: 署名済み .app が無い（scripts/package-macos-app.sh）"; exit 2; }
if [[ "${ASTRA_TCC_CONFIRM:-0}" != "1" ]]; then
  echo "AUTOMATION_MISSING: この端末の TCC を消す確認が無い（ASTRA_TCC_CONFIRM=1）。専用ユーザー / VM で回す"
  exit 2
fi
if ! osascript -e 'tell application "System Events" to return count of processes' >/dev/null 2>&1; then
  echo "AUTOMATION_MISSING: 呼び出し元に Accessibility の許可が無い（ダイアログを押せない）"; exit 2
fi
pgrep -x AstraMac >/dev/null && { echo "FAIL: AstraMac が既に動いている"; exit 1; }

# 1. リセット（この 2 つだけ。他の許可は触らない）。
tccutil reset Microphone "$BUNDLE" >/dev/null 2>&1 || { echo "FAIL: tccutil reset Microphone"; exit 1; }
tccutil reset Calendar   "$BUNDLE" >/dev/null 2>&1 || true
echo "  tccutil reset: Microphone / Calendar ($BUNDLE)"

# TCC のダイアログを探す（UserNotificationCenter / CoreServicesUIAgent のどちらかが出す）。
dialog_button() {  # $1 = ボタン名（部分一致）。押せたら 0。
  osascript - "$1" <<'AS' 2>/dev/null
on run argv
  set want to item 1 of argv
  tell application "System Events"
    repeat with pn in {"UserNotificationCenter", "CoreServicesUIAgent", "SecurityAgent"}
      try
        tell process pn
          repeat with w in windows
            repeat with b in buttons of w
              if (name of b as text) contains want then
                click b
                return "CLICKED " & (name of b as text)
              end if
            end repeat
          end repeat
        end tell
      end try
    end repeat
  end tell
  return "NONE"
end run
AS
}
dialog_present() {
  osascript - <<'AS' 2>/dev/null
tell application "System Events"
  repeat with pn in {"UserNotificationCenter", "CoreServicesUIAgent", "SecurityAgent"}
    try
      tell process pn
        if (count of windows) > 0 then return "YES " & (name of window 1 as text)
      end tell
    end try
  end repeat
end tell
return "NO"
AS
}

data="$(mktemp -d)"
# 2. 起動直後に一括で求めないか（10 秒）。
open --env "ASTRA_DATA_ROOT=$data" "$APP" --args --selftest idle-hold 12
bulk=0
for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; if [[ "$(dialog_present)" == YES* ]]; then bulk=1; break; fi; done
pkill -x AstraMac 2>/dev/null || true; sleep 1
echo "  startup bulk permission requests = $bulk"

# 3. マイク: 使う瞬間にだけ出る → 拒否 → 理由と道が出る。
rm -f /tmp/astra-livemic.txt
open --env "ASTRA_DATA_ROOT=$data" "$APP" --args --selftest livemic
purpose=0; denied=NONE
for i in $(seq 1 20); do sleep 0.5; if [[ "$(dialog_present)" == YES* ]]; then purpose=1; break; fi; done
if [[ $purpose -eq 1 ]]; then denied="$(dialog_button "許可しない")"; [[ "$denied" == CLICKED* ]] || denied="$(dialog_button "Don")"; fi
sleep 3; pkill -x AstraMac 2>/dev/null || true
echo "  microphone dialog at feature use = $purpose  deny=$denied"
# 拒否のあと録音を始めると、結果面が理由と「設定を開く」を出すか（recoveryui selftest が state で言う）。
recov="$(ASTRA_DATA_ROOT="$data" "$APP/Contents/MacOS/AstraMac" --selftest recoveryui 2>/dev/null | tail -1)"
echo "  deny recovery: $recov"

# 4. 許したあとの復帰は、System Settings を機械で操作する段（次の測定器）。ここでは AUTOMATION_MISSING と言う。
grant="AUTOMATION_MISSING (System Settings > プライバシーとセキュリティ > マイク を機械で ON にする段が未実装)"
echo "  grant recovery: $grant"

if [[ $bulk -eq 0 && $purpose -eq 1 && "$denied" == CLICKED* && "$recov" == SELFTEST_OK* ]]; then
  echo "LIVE_TCC_GATE=PARTIAL (deny path PASS, grant path AUTOMATION_MISSING)"; exit 2
else
  echo "LIVE_TCC_GATE=FAIL"; exit 1
fi
