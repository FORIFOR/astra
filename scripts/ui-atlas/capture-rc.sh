#!/usr/bin/env bash
# UI Atlas の素材を、署名済み RC .app **だけ**から撮る。
#
# debug 実行体は使わない（署名も TCC の主体も配布物と違う）。selftest は `open -W ... --args` で
# 走らせるので stdout は読めない。結果は出力先のファイルで受け取り、不足は build 側で数える。
# 実データ置き場を読むと機械に溜まった残骸（録りかけ N 件など）が絵に混ざるので、
# ASTRA_DATA_ROOT を空のディレクトリに向ける。**mode ごとに別のディレクトリ**にする。
# 同じ置き場を使い回すと、先に走った shots が残した断片が sections の Home に
# 「録りかけが 2 件」として写る（実際に起きた）。
#
#   bash scripts/ui-atlas/capture-rc.sh apps/astra-macos/.build/Astra.app /tmp/astra-atlas
set -euo pipefail
APP="${1:?Astra.app のパス}"
OUT="${2:?出力先}"
EXE="$APP/Contents/MacOS/AstraMac"
[[ -x "$EXE" ]] || { echo "FAIL: $EXE が無い" >&2; exit 1; }
codesign -v "$APP" 2>/dev/null || { echo "FAIL: $APP の署名が無効" >&2; exit 1; }

rm -rf "$OUT"; mkdir -p "$OUT"

# 撮る前に、どの実行体で撮ったかを固定する（build 側が manifest に写し、gate が突き合わせる）。
python3 - "$APP" "$EXE" "$OUT/rc-fingerprint.json" <<'PY'
import hashlib, json, os, subprocess, sys, datetime
app, exe, out = sys.argv[1:4]
h = hashlib.sha256(open(exe, "rb").read()).hexdigest()
mtime = datetime.datetime.fromtimestamp(os.stat(exe).st_mtime).astimezone().isoformat(timespec="seconds")
cs = subprocess.run(["codesign", "-dv", app], capture_output=True, text=True).stderr
ident = next((l.split("=", 1)[1] for l in cs.splitlines() if l.startswith("Identifier=")), "")
team = next((l.split("=", 1)[1] for l in cs.splitlines() if l.startswith("TeamIdentifier=")), "")
json.dump({"app": os.path.abspath(app), "exe_sha256": h, "built": mtime,
           "codesign_identifier": ident, "team": team,
           "captured_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds")},
          open(out, "w"), indent=2, ensure_ascii=False)
print(f"RC exe {h[:16]}… built {mtime}")
PY

run() {
  local sub="$1"; shift
  if pgrep -x AstraMac >/dev/null; then
    echo "FAIL: AstraMac が既に動いている（$(pgrep -x AstraMac | tr '\n' ' ')）。終わるのを待ってから" >&2
    exit 1
  fi
  local data="$OUT/data-root/$sub"; mkdir -p "$data"
  echo "▶ $*  →  $sub"
  open -W --env "ASTRA_DATA_ROOT=$data" "$APP" --args --selftest "$@"
  echo "  $(ls "$OUT/$sub" 2>/dev/null | grep -c '\.png$') png"
}

run shots-light     shots        "$OUT/shots-light"
run shots-dark      shots        "$OUT/shots-dark" dark
run dock-light      dock8        "$OUT/dock-light"
run dock-dark       dock8        "$OUT/dock-dark" dark
run session-light   sessionshots "$OUT/session-light"
run session-dark    sessionshots "$OUT/session-dark" dark
run sections-light  sections     "$OUT/sections-light"
run sections-dark   sections     "$OUT/sections-dark" dark
run states-light    states       "$OUT/states-light"
run states-dark     states       "$OUT/states-dark" dark
for j in JA JB JC; do
  run "journey-$j"  journey "$j" "$OUT/journey-$j"
done
run motion          surfacemotion "$OUT/motion"
echo "CAPTURE_DONE $OUT"
