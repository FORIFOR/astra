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

# 求めてよいファイルは、機能の入口だけ。新しい場所で求めるなら、ここに「何の機能の直前か」を
# 書いてから足す（一覧が黙って増えると、いつの間にか「起動時に一括」へ戻る）。
allowed=(
  "Settings/PermissionCenter.swift"           # 機能→要る許可の写像。要求はここを通す
  "Settings/SettingsView.swift"               # 5 つの一覧。あとから見直す場所（一括の案内はしない）
  "Home/HomeView.swift"                       # ⌥Space を使えるようにする → 入力監視
  "VoiceHUD/VoiceHUDState.swift"              # 声で頼む → マイク
  "RecordingWorkspace/RecordingWorkspaceState.swift"  # 会議を録る → マイク（画面収録は system audio を繋いだときに）
)
while IFS= read -r line; do
  f="${line%%:*}"; rel="${f#$SRC/}"; ok=0
  for a in "${allowed[@]}"; do [ "$rel" = "$a" ] && ok=1; done
  if [ $ok -eq 0 ]; then
    echo "  機能の入口ではない場所で求めている: ${line#$ROOT/}" >&2
    fail=1
  fi
done < <(grep -rn "Permissions\.request\|PermissionCenter\.request" "$SRC" | grep -v "Settings/Permissions.swift" | grep -v "App/SelfTest.swift")
[ $fail -eq 0 ] && echo "  求める場所は機能の入口だけ OK"

# 全部の種類を一度に回す書き方（allCases で request）は一括要求そのもの。
if grep -rnE "allCases.*request|for .* in .*Kind.*allCases" "$SRC" --include='*.swift' | grep -v "App/SelfTest.swift" | grep -iq "request"; then
  echo "  すべての許可をまとめて求めている:" >&2
  grep -rnE "allCases.*request|for .* in .*Kind.*allCases" "$SRC" --include='*.swift' | grep -v "App/SelfTest.swift" | sed 's/^/    /' >&2
  fail=1
fi

# 取扱説明書も同じ規則。「最初に 5 つ全部を許可して」と教える段落があれば、アプリが JIT でも
# 読者は一括でやる。1 つの <p> の中に 5 つの許可名と「許可を求める」の語が全部入っていたら、それ。
guide="$ROOT/docs/guide/build.py"
if [ -f "$guide" ]; then
  bulk=$(python3 - "$guide" <<'PY'
import re, sys
s = open(sys.argv[1], encoding="utf-8").read()
names = ["microphone", "screenRecording", "accessibility", "calendar", "inputMonitoring"]
hits = []
for m in re.finditer(r"<p[^>]*>(.*?)</p>", s, re.S):
    p = m.group(1)
    if all(f'fact("permission.{n}")' in p for n in names) and 'fact("permission.request")' in p:
        hits.append(s[:m.start()].count("\n") + 1)
    if "まとめて許可" in p or ("初回" in p and 'fact("permission.request")' in p):
        hits.append(s[:m.start()].count("\n") + 1)
print(" ".join(str(h) for h in sorted(set(hits))))
PY
)
  if [ -n "$bulk" ]; then
    echo "  取扱説明書が「最初に全部許可」を教えている: docs/guide/build.py 行 $bulk" >&2
    fail=1
  else
    echo "  取扱説明書も「使うときに要るものだけ」 OK"
  fi
fi

echo
if [ $fail -eq 0 ]; then
  echo "PERMISSION_JIT_OK: 起動時に求めず、使う直前に求める"
else
  echo "PERMISSION_JIT_FAIL: 起動時に求めているか、機能の入口の外で求めているか、説明書が一括を教えている" >&2
  exit 1
fi
