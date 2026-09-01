#!/usr/bin/env bash
# 動きを 60fps で測る。**印象ではなく形で見る。**
#
# 0.25 秒ごとの連写では 180〜220ms の morph が 0〜1 枚しか写らず、
# Judge は「一気に飛ぶ」と読んだ。あれは取り方の限界であって動きの質ではない。
# 60fps なら 180ms ≈ 11 枚。変化の**長さと形**が出る。
#
#   motion.sh <名前> <起こす操作>   例: motion.sh dock-morph opt-space
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="$ROOT/.build/uxlab"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
NAME="${1:?usage: motion.sh <名前> <opt-space|esc>}"
KEY="${2:-opt-space}"
OUT="$ROOT/artifacts/ux/motion/$NAME"
bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null
rm -rf "$OUT"; mkdir -p "$OUT"

pkill -9 -f AstraMac 2>/dev/null; sleep 1
"$BIN" --selftest idle-hold 25 >/dev/null 2>&1 &
sleep 3
( "$LAB/motion" "$OUT/frames" 3 > "$OUT/capture.log" 2>&1 ) &
sleep 1.0
"$LAB/uxin" key $([ "$KEY" = esc ] && echo 53 || echo 49) $([ "$KEY" = esc ] || echo opt)
sleep 3.5
pkill -9 -f AstraMac 2>/dev/null

"$LAB/framediff" "$OUT/frames" > "$OUT/diff.tsv" 2>/dev/null
python3 - "$OUT" <<'PY'
import sys, os, json
d = sys.argv[1]
rows = [l.split() for l in open(os.path.join(d, "diff.tsv")) if l.strip()]
vals = [(int(a), float(b)) for a, b in rows]
moving = [(i, v) for i, v in vals if v > 0.01]
out = {"frames": len(vals) + 1, "fps": 60}
print("== 動きの形（60fps）==")
if not moving:
    print("  変化なし（動いていない）")
    out["verdict"] = "NO_MOTION"
else:
    # 連続した区間に切る
    runs, cur = [], [moving[0]]
    for prev, nxt in zip(moving, moving[1:]):
        if nxt[0] - prev[0] <= 2: cur.append(nxt)
        else: runs.append(cur); cur = [nxt]
    runs.append(cur)
    out["runs"] = []
    for r in runs:
        ms = (r[-1][0] - r[0][0] + 1) * 1000 // 60
        peak = max(v for _, v in r)
        # 減衰していれば ease-out、1 枚だけなら飛んでいる
        shape = ("一枚だけ（飛んでいる）" if len(r) <= 1
                 else "減衰（ease-out）" if r[0][1] >= r[-1][1] else "立ち上がり")
        print(f"  frame {r[0][0]}〜{r[-1][0]}  {len(r)} 枚 ≈ {ms}ms  最大 {peak:.3f}  {shape}")
        out["runs"].append({"frames": len(r), "ms": ms, "peak": round(peak, 4), "shape": shape})
    longest = max(out["runs"], key=lambda x: x["frames"])
    out["verdict"] = ("INSTANT_JUMP" if longest["frames"] <= 1
                      else "GRADUAL" if longest["frames"] >= 6 else "SHORT")
    print(f"\n  判定: {out['verdict']}（最長 {longest['frames']} 枚 ≈ {longest['ms']}ms）")
out["evidence_level"] = "A"
out["note"] = "画像の中身の変化量。印象ではなく形で見る"
json.dump(out, open(os.path.join(d, "motion.json"), "w"), ensure_ascii=False, indent=2)
PY
