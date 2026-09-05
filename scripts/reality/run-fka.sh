#!/usr/bin/env bash
# FKA_GATE — Full Keyboard Access（キーボードナビゲーション）を実 OS で ON にして、
# 署名済み RC .app に Tab を**本当に**送り、AX が公開する focus の移動を証拠に判定する。人手 0。
#
# 以前は「システム設定で ON にして、本人が TSV を読む」だった（docs/ux-benchmark/a11y/RUNBOOK.md §1）。
# ここでは OS の設定を機械が切り替え（AppleKeyboardUIMode）、終わったら元に戻す。
#
#   bash scripts/reality/run-fka.sh [Astra.app] [out.tsv]
#
# 判定（全部満たして FKA_GATE=PASS）:
#   fullKeyboardAccess=true            OS 側で ON になった実行だけを数える
#   nameless controls               = 0   名前の無い操作部品が無い（VoiceOver も FKA もこれを読む）
#   focus moved but not visible     = 0   動いたのに描かれていない focus（見えない鍵盤操作）
#   NOT_MEASURED surfaces           = 0   窓が出なかった面が無い
#   moved steps per surface         >= 1  main-home / workspace / settings で Tab が実際に動く
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="${1:-$ROOT/apps/astra-macos/.build/Astra.app}"
OUT="${2:-/tmp/astra-fka/a11ynames-fka-on.tsv}"
mkdir -p "$(dirname "$OUT")"
[[ -x "$APP/Contents/MacOS/AstraMac" ]] || { echo "AUTOMATION_MISSING: 署名済み .app が無い（scripts/package-macos-app.sh）"; exit 2; }
if pgrep -x AstraMac >/dev/null; then echo "FAIL: AstraMac が既に動いている"; exit 1; fi

# OS の設定を切り替える。0/1 = off、2 = 全コントロール（FKA ON）。元の値は必ず戻す。
prev="$(defaults read -g AppleKeyboardUIMode 2>/dev/null || echo 0)"
restore() { if [[ "$prev" == "0" ]]; then defaults delete -g AppleKeyboardUIMode >/dev/null 2>&1 || true; else defaults write -g AppleKeyboardUIMode -int "$prev"; fi; }
trap restore EXIT
defaults write -g AppleKeyboardUIMode -int 2

# a11ynames は TSV を書く（open --args では stdout が読めない）。TCC の主体はバンドルなので open で起動する。
rm -f "$OUT"
data="$(mktemp -d)"
open -W --env "ASTRA_DATA_ROOT=$data" "$APP" --args --selftest a11ynames "$OUT"
[[ -f "$OUT" ]] || { echo "FAIL: a11ynames が TSV を書かなかった（$OUT）"; exit 1; }

python3 - "$OUT" <<'PY'
import sys, collections
rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1], encoding="utf-8")]
env = next((r for r in rows if r and r[0] == "A11Y_ENV"), None)
fka = env is not None and any(x == "fullKeyboardAccess=true" for x in env)
nameless = sum(int(x.split("=")[1]) for r in rows if r and r[0] == "A11Y_SURFACE" for x in r if x.startswith("nameless="))
tabs = [r for r in rows if r and r[0] == "A11Y_TAB"]
not_measured = [r[1] for r in tabs if len(r) > 2 and r[2] == "NOT_MEASURED"]
moved = collections.Counter(); invisible = []
for r in tabs:
    kv = dict(x.split("=", 1) for x in r[2:] if "=" in x)
    if kv.get("moved") == "true":
        moved[r[1]] += 1
        if kv.get("visible", "").startswith("no"): invisible.append((r[1], kv.get("step"), kv.get("role"), kv.get("name")))
need = ["main-home", "workspace", "settings"]
missing_moves = [s for s in need if moved.get(s, 0) < 1]
ok = fka and nameless == 0 and not invisible and not not_measured and not missing_moves
print(f"  fullKeyboardAccess           {fka}")
print(f"  nameless controls            {nameless}")
print(f"  moved steps                  {dict(moved)}")
print(f"  moved but not visible        {len(invisible)} {invisible[:3]}")
print(f"  NOT_MEASURED surfaces        {not_measured}")
print(f"  surfaces without a move      {missing_moves}")
print(f"FKA_GATE={'PASS' if ok else 'FAIL'}")
sys.exit(0 if ok else 1)
PY
