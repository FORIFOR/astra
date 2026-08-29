#!/usr/bin/env bash
# 用途説明の欠落は「動かない」ではなく「**OS がプロセスを落とす**」。
# 実際に Start recording でマイクを要求した瞬間に SIGABRT で落ちた
# （__TCC_CRASHING_DUE_TO_PRIVACY_VIOLATION__）。
#
# `PermissionCenter` が要求しうるものと、パッケージが書く Info.plist を突き合わせる。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 要求しうる権限 → 必要な Info.plist キー
declare -a NEEDED=(
  "NSMicrophoneUsageDescription"        # PermissionCenter .voice / .meeting
  "NSSpeechRecognitionUsageDescription" # SpeechTranscriber（手元 STT）
  "NSCalendarsUsageDescription"         # CalendarAccess
  "NSAppleEventsUsageDescription"       # AccessibilityContext / Dictation
)

fail=0
for script in scripts/package-macos-app.sh scripts/build-macos-app.sh; do
  plist_block="$(awk '/Info.plist/,/^PLIST$/' "$ROOT/$script")"
  for key in "${NEEDED[@]}"; do
    if ! grep -q "$key" <<<"$plist_block"; then
      echo "FAIL: $script に $key が無い（要求すると OS に落とされる）" >&2
      fail=1
    fi
  done
done

# 実際にビルド済みの .app があれば、そちらも見る（配布物が正）。
APP="$ROOT/apps/astra-macos/.build/Astra.app"
if [[ -f "$APP/Contents/Info.plist" ]]; then
  for key in "${NEEDED[@]}"; do
    if ! /usr/libexec/PlistBuddy -c "Print :$key" "$APP/Contents/Info.plist" >/dev/null 2>&1; then
      echo "FAIL: ビルド済み .app に $key が無い" >&2
      fail=1
    fi
  done
fi

[[ $fail -eq 0 ]] || exit 1
echo "USAGE_DESCRIPTIONS_OK: 要求しうる権限の用途説明が揃っている (${#NEEDED[@]} 件)"
