#!/usr/bin/env bash
# 起動した瞬間に権限を求めていないか。
#
# まだ何も使っていない人にダイアログを並べると、そこで脱落する。
# Apple も「機能を実際に使う瞬間まで待つ」ことを勧めている。
# 求めてよいのは、その機能を使い始めたときだけ。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apps/astra-macos/Sources/AstraMac"
fail=0

# 起動経路（AppDelegate）で直接求めていないか。
launch="$SRC/App/AstraAppDelegate.swift"
if grep -nE "Permissions\.request|PermissionCenter\.request|CGRequest|AVCaptureDevice\.requestAccess" "$launch" | grep -q .; then
  echo "  起動経路で権限を求めている:" >&2
  grep -nE "Permissions\.request|PermissionCenter\.request|CGRequest" "$launch" | sed 's/^/    /' >&2
  fail=1
else
  echo "  起動経路（AppDelegate）で権限を求めていない OK"
fi

# 求める場所が「その機能の直前」であること。使う側の一覧を出して人が読めるように。
echo "  求めている場所:"
grep -rn "Permissions\.request\|PermissionCenter\.request" "$SRC" \
  | grep -v "Settings/Permissions.swift" \
  | sed "s|$ROOT/||" | sed 's/^/    /'

echo
if [ $fail -eq 0 ]; then
  echo "PERMISSION_JIT_OK: 起動時に求めず、使う直前に求める"
else
  echo "PERMISSION_JIT_FAIL: 起動した瞬間に求めている" >&2
  exit 1
fi
