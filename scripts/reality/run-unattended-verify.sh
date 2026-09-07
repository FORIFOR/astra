#!/usr/bin/env bash
# TCC を含む verify-all の無人実行（HUMAN_INTERVENTION = 0 を製品全体で）。
#
#   ./scripts/reality/run-unattended-verify.sh            # 前提を測って、揃っていれば回す
#   ASTRA_UNATTENDED_CONFIRM=1 ...                        # この Mac の RC の TCC を実際にリセットして回す（破壊的）
#
# 段:
#   1. preflight   専用アカウント / tccutil / 署名 RC / 呼び出し元の AX 許可（ダイアログを押すのに要る）
#   2. tcc-reset   `tccutil reset All <bundle id>`（RC の許可だけ。他アプリには触らない）
#   3. rc-launch   署名 RC を `open` で起こし（責任プロセス = バンドル）、許可を求める selftest を走らせ、
#                  scripts/reality/tcc-dialog.sh が OS のダイアログを押す
#   4. verify-all  ./scripts/verify-all.sh を回し、最終行 VERIFY_ALL_OK / FAIL を artifacts に残す
#   5. artifacts   $OUT/ に permissions・verify-all の全文・rc-fingerprint
#
# 揃っていない前提は **AUTOMATION_MISSING** として名指しする（PASS を捏造しない。人を呼ばない）。
# 一度だけ人が要るもの: 専用アカウントの作成（sysadminctl は admin のパスワードを要る）と、そのアカウントの
# 自動ログイン（第 2 GUI セッションを無人で起こすため）。作った後は無人で回る。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
ACCOUNT="${ASTRA_VERIFY_ACCOUNT:-astra-verify}"
APP="$ROOT/apps/astra-macos/.build/Astra.app"
BUNDLE_ID="$(defaults read "$APP/Contents/Info" CFBundleIdentifier 2>/dev/null || echo com.astra.desktop)"
OUT="${ASTRA_UNATTENDED_OUT:-/tmp/astra-unattended-verify}"
mkdir -p "$OUT"
missing=(); have=()

# ---- 1. preflight
if id "$ACCOUNT" >/dev/null 2>&1; then have+=("account:$ACCOUNT"); else missing+=("dedicated macOS test account '$ACCOUNT' (one-time: sudo sysadminctl -addUser $ACCOUNT -password … ; then enable auto-login for it)"); fi
if command -v tccutil >/dev/null 2>&1; then have+=("tccutil"); else missing+=("tccutil"); fi
if [[ -d "$APP" ]] && codesign -v "$APP" >/dev/null 2>&1; then have+=("signed RC $BUNDLE_ID"); else missing+=("signed RC at $APP (scripts/package-macos-app.sh)"); fi
if [[ -x "$ROOT/scripts/reality/tcc-dialog.sh" ]]; then have+=("tcc-dialog driver"); else missing+=("scripts/reality/tcc-dialog.sh"); fi
# ダイアログを押す側（このシェル）に AX が要る。無ければ押せず、TCC を消した RC は許可を戻せない。
if osascript -e 'tell application "System Events" to get name of first process' >/dev/null 2>&1; then have+=("caller AX"); else missing+=("Accessibility for the calling process (System Events) — needed to press the TCC dialogs"); fi
# 第 2 GUI セッション: 専用アカウントがログイン済みで、そのセッションで実行できること。
if id "$ACCOUNT" >/dev/null 2>&1; then
  uid="$(id -u "$ACCOUNT")"
  if launchctl print "user/$uid" >/dev/null 2>&1; then have+=("gui session:$ACCOUNT"); else missing+=("GUI session for '$ACCOUNT' (auto-login or CGSession -switchToUserID; then launchctl asuser $uid)"); fi
fi

echo "UNATTENDED_VERIFY have=[${have[*]:-}]"
if [[ ${#missing[@]} -gt 0 ]]; then
  printf 'UNATTENDED_VERIFY=AUTOMATION_MISSING %s\n' "$(IFS=';'; echo "${missing[*]}")"
  exit 3
fi
if [[ "${ASTRA_UNATTENDED_CONFIRM:-}" != "1" ]]; then
  echo "UNATTENDED_VERIFY=READY (set ASTRA_UNATTENDED_CONFIRM=1 to reset $BUNDLE_ID's TCC and run)"
  exit 0
fi

# ---- 2. tcc-reset（RC のバンドルだけ）
uid="$(id -u "$ACCOUNT")"
run_as() { launchctl asuser "$uid" sudo -n -u "$ACCOUNT" "$@"; }
run_as tccutil reset All "$BUNDLE_ID" >/dev/null 2>&1 || { echo "UNATTENDED_VERIFY=FAIL tccutil reset"; exit 1; }

# ---- 3. rc-launch: 許可を求める selftest と、ダイアログを押す driver を並走させる
( run_as bash "$ROOT/scripts/reality/tcc-dialog.sh" allow 120 ) &
DRIVER=$!
run_as open -W "$APP" --args --selftest permissions
run_as open -W "$APP" --args --selftest livemic
wait "$DRIVER" 2>/dev/null || true
run_as "$APP/Contents/MacOS/$(defaults read "$APP/Contents/Info" CFBundleExecutable)" --selftest permissions 2>/dev/null | tee "$OUT/permissions.txt"

# ---- 4. verify-all（専用アカウントのセッションで）
run_as bash -c "cd '$ROOT' && ./scripts/verify-all.sh" 2>&1 | tee "$OUT/verify-all.txt"
LAST="$(tail -1 "$OUT/verify-all.txt")"
cp "$OUT/verify-all.txt" "$OUT/verify-all-$(date +%Y%m%d-%H%M).txt"
case "$LAST" in
  *VERIFY_ALL_OK*) echo "UNATTENDED_VERIFY_GATE=PASS"; exit 0 ;;
  *) echo "UNATTENDED_VERIFY=FAIL ($LAST)"; exit 1 ;;
esac
