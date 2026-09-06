#!/usr/bin/env bash
# TCC を含む verify-all の無人実行（HUMAN_INTERVENTION = 0）。
#
# これまで「AX・入力監視・カレンダー・音声認識を許可した本人のターミナルから verify-all を回す」を
# push の条件にしていた。それは「人が要る」であって、正式には AUTOMATION_MISSING。
# 目標の形:
#   1. 専用の macOS テストアカウント（`astra-verify`）を用意する（sysadminctl）
#   2. そのアカウントで `tccutil reset All <bundle id>` して、まっさらな TCC から始める
#   3. 署名 RC（apps/astra-macos/.build/Astra.app）を `open` で起動する（責任プロセス = バンドル）
#   4. TCC のダイアログを AX / CGEvent で操作し（scripts/reality/tcc-dialog.sh）、許可の状態を `--selftest permissions` で確かめる
#   5. その状態で ./scripts/verify-all.sh を回し、artifacts（VERIFY_ALL_OK / FAIL の全文）を残す
#
# いまはどこまで揃っているかを **測って言う**。揃っていなければ AUTOMATION_MISSING（PASS を捏造しない）。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
ACCOUNT="${ASTRA_VERIFY_ACCOUNT:-astra-verify}"
APP="$ROOT/apps/astra-macos/.build/Astra.app"
missing=()
have=()

if id "$ACCOUNT" >/dev/null 2>&1; then have+=("account:$ACCOUNT"); else missing+=("dedicated macOS test account '$ACCOUNT' (sysadminctl -addUser)"); fi
if command -v tccutil >/dev/null 2>&1; then have+=("tccutil"); else missing+=("tccutil"); fi
if [[ -d "$APP" ]] && codesign -v "$APP" >/dev/null 2>&1; then have+=("signed RC"); else missing+=("signed RC at $APP (scripts/build-macos-app.sh)"); fi
if [[ -x "$ROOT/scripts/reality/tcc-dialog.sh" ]]; then have+=("tcc-dialog driver"); else missing+=("scripts/reality/tcc-dialog.sh"); fi
# 別アカウントで GUI セッションを起こして操作する経路（fast user switching + AX）はまだ無い。
missing+=("second GUI session driver (login the test account, run verify-all inside it, collect artifacts)")

echo "UNATTENDED_VERIFY have=[${have[*]:-}]"
if [[ ${#missing[@]} -gt 0 ]]; then
  printf 'UNATTENDED_VERIFY=AUTOMATION_MISSING %s\n' "$(IFS=';'; echo "${missing[*]}")"
  exit 3
fi
echo "UNATTENDED_VERIFY_GATE=PASS"
