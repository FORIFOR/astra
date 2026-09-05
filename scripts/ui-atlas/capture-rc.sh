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

# Sparkle の面（update-available）用の appcast。鍵の検証と手順は本物のまま、
# 差し替えるのは appcast の場所だけ（`SoftwareUpdate` の ASTRA_SELFTEST_FEED_URL）。
# 入れ替えには使わない（enclosure は存在しない場所、署名は 0 埋め）。
# Sparkle は file:// を拒む（http か https）ので、127.0.0.1 で配る。
write_appcast() {  # $1 = path, $2 = version
  cat > "$1" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
<channel><title>Astra (UI Atlas)</title>
<item><title>Astra $2</title>
<sparkle:version>$2</sparkle:version><sparkle:shortVersionString>$2</sparkle:shortVersionString>
<sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
<description><![CDATA[<p>UI Atlas 用の appcast。入れ替えには使わない。</p>]]></description>
<pubDate>Fri, 05 Sep 2026 12:00:00 +0900</pubDate>
<enclosure url="https://example.invalid/Astra-$2.zip" length="1" type="application/octet-stream" sparkle:edSignature="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="/>
</item></channel></rss>
XML
}
write_appcast "$OUT/appcast-available.xml" "999.0.0"
FEED_PORT="${ASTRA_ATLAS_FEED_PORT:-18765}"
if lsof -nP -iTCP:"$FEED_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "FAIL: port $FEED_PORT が使われている（ASTRA_ATLAS_FEED_PORT で変える）" >&2; exit 1
fi
python3 -m http.server "$FEED_PORT" --bind 127.0.0.1 --directory "$OUT" >/dev/null 2>&1 &
FEED_PID=$!
trap 'kill "$FEED_PID" 2>/dev/null' EXIT
sleep 1
curl -sf -o /dev/null "http://127.0.0.1:$FEED_PORT/appcast-available.xml" || { echo "FAIL: appcast を配れない" >&2; exit 1; }

EXTRA_ENV=()
run() {
  local sub="$1"; shift
  if pgrep -x AstraMac >/dev/null; then
    echo "FAIL: AstraMac が既に動いている（$(pgrep -x AstraMac | tr '\n' ' ')）。終わるのを待ってから" >&2
    exit 1
  fi
  local data="$OUT/data-root/$sub"; mkdir -p "$data"
  echo "▶ $*  →  $sub"
  open -W --env "ASTRA_DATA_ROOT=$data" ${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"} "$APP" --args --selftest "$@"
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
EXTRA_ENV=(--env "ASTRA_SELFTEST_FEED_URL=http://127.0.0.1:$FEED_PORT/appcast-available.xml")
run sys-light       sysshots     "$OUT/sys-light"
run sys-dark        sysshots     "$OUT/sys-dark" dark
EXTRA_ENV=()
for j in JA JB JC; do
  run "journey-$j"  journey "$j" "$OUT/journey-$j"
done
run motion          surfacemotion "$OUT/motion"
echo "CAPTURE_DONE $OUT"
