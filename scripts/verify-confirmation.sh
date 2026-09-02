#!/usr/bin/env bash
# CONFIRMATION_GATE — 実行の前に見せる面が、決断に足りているか。
#
# 面の型として外の製品に負けていた。理由は造形ではなく、**宛先も中身も出所も
# 持っていなかった**こと。ここを機械で守る。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
LAB="$ROOT/.build/uxlab"
OUT="$(mktemp -d)"
bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null

pkill -9 -f AstraMac 2>/dev/null; sleep 1
ASTRA_DATA_ROOT="$OUT/data" "$BIN" --selftest dock8 "$OUT" >"$OUT/log.txt" 2>&1
pkill -9 -f AstraMac 2>/dev/null

shot="$OUT/07-confirmation.png"
[ -f "$shot" ] || { echo "FAIL: 確認の面を撮れていない"; exit 1; }
w=$(sips -g pixelWidth "$shot" | awk '/pixelWidth/{print $2}')
h=$(sips -g pixelHeight "$shot" | awk '/pixelHeight/{print $2}')
txt="$("$LAB/ocr" "$shot" | cut -f2- | tr -d ' 　')"

fail=0
say() { printf "  %s %s\n" "$1" "$2"; }
need() {  # <文字> <説明>
  if echo "$txt" | grep -q "$1"; then say "✓" "$2"; else say "✗" "$2（「$1」が無い）"; fail=1; fi
}

echo "== CONFIRMATION_GATE =="
echo
say "·" "面の寸法 ${w}x${h}pt"
# 決断のための面が作業面ほど大きくならないこと。
if [ "$w" -le 620 ]; then say "✓" "幅 <= 620pt"; else say "✗" "幅 ${w}pt（620 超）"; fail=1; fi
if [ "$h" -le 360 ]; then say "✓" "高さ <= 360pt"; else say "✗" "高さ ${h}pt（360 超）"; fail=1; fi

# ① どこへ ② 何が起きるか ③ 決定的な値 ④ 下見 ⑤ 出所 ⑥ 取消/直す/実行
need "Slack"    "① どのアプリ / どこへ"
need "ますか"   "② 何が起きるか"
need "宛先"     "③ 決定的な値"
need "資料"     "④ 中身の下見"
need "出所"     "⑤ 出所"
need "Cancel"   "⑥ 取消"
need "Edit"     "⑥ 直す"
need "送る"     "⑥ 実行"

# 決断に要らないものを持ち込んでいないこと。
for ng in "文字起こし" "決まったこと" "最近の会議" "Library" "Plugins"; do
  if echo "$txt" | grep -q "$ng"; then say "✗" "決断に不要なものが入っている（$ng）"; fail=1; fi
done
say "✓" "決断に不要なもの（履歴・会議ノート・sidebar）が無い"

# ⑤ 主たる操作を、逃げ道より小さくしない。
# 「送る」は 2 文字、Cancel は 6 文字。padding だけで決めると、
# 字数で重さが決まってしまい、実測で Cancel 76pt > 送る 68pt になっていた。
# 宣言値でも「墨 + padding」の推定でもなく、**描かれた矩形**を測る。
if ! "$ROOT/scripts/ux-auto/primary.py" "$shot" > "$OUT/primary.txt" 2>&1; then
  say "✗" "$(head -1 "$OUT/primary.txt")"
  sed -n '2,$p' "$OUT/primary.txt" | sed 's/^/    /'
  fail=1
else
  say "✓" "$(head -1 "$OUT/primary.txt")"
fi

# ③ 行の揃い。**穴が空いていないか。**
# 面の高さを推定式で出していたころ、中身より 40pt 高い面ができ、
# 余りが Spacer に吸われて段の間に穴として出ていた。式と view がずれても
# 文字は全部出るので、上の OCR だけでは通ってしまう。
if python3 "$ROOT/scripts/ux-auto/alignment.py" "$shot" > "$OUT/align.txt" 2>&1; then
  say "✓" "$(grep -m1 '中身の間の中央値' "$OUT/align.txt" | sed 's/^ *//')"
else
  say "✗" "段の間に穴がある"
  sed -n '/穴が/,$p' "$OUT/align.txt" | sed 's/^/    /'
  fail=1
fi

# 窓を増やしていないこと。
wins=$(grep -c "窓" "$OUT/log.txt" 2>/dev/null || true)
if grep -q "窓は常に1枚" "$OUT/log.txt"; then say "✓" "窓を増やしていない（同じ面が morph）"; else
  say "·" "窓の数は dock8 の出力で確認"; fi

# 撮った絵では分からないもの（窓・焦点・高さが中身で決まるか・取り消し）は
# 実際に動かして見る。宣言してあるが効いていない、を避ける。
echo
out="$("$BIN" --selftest confirmflow 2>&1 | tail -1)"
pkill -9 -f AstraMac 2>/dev/null
if echo "$out" | grep -q SELFTEST_OK; then say "✓" "${out#SELFTEST_OK confirmflow: }"
else say "✗" "$out"; fail=1; fi

echo
if [ "$fail" = "0" ]; then echo "CONFIRMATION_GATE=PASS"; else echo "CONFIRMATION_GATE=FAIL"; exit 1; fi
