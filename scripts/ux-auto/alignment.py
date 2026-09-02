#!/usr/bin/env python3
"""③ 行の揃い — 目ではなく、描かれた絵から測る。

`tools/ux-lab/ocr` は Vision の枠（正規化）も出す。これを pt に直し、
段ごとの**左端**と**行間**を並べる。揃っていないものは数で出る。

測っているのは字の**墨の左端**であって、SwiftUI の frame ではない。
和文と欧文で左の余白が違うので ±1pt は動く。2pt を超える段差だけを見る。
（frame そのものは自プロセスの AX が子を返さないため取れない。UIProbe は
 押す経路だけで枠を持たない。）

    python3 scripts/ux-auto/alignment.py <png> [許容pt]
"""
import subprocess, sys, pathlib, collections

OCR = pathlib.Path(__file__).resolve().parents[2] / ".build/uxlab/ocr"

def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    png = pathlib.Path(sys.argv[1])
    tol = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
    ocr = OCR if OCR.exists() else pathlib.Path(".build/uxlab/ocr")
    if not ocr.exists():
        raise SystemExit(f"ocr が無い: {ocr}（bash scripts/ux-auto/build-tools.sh）")

    import struct
    hdr = png.open("rb").read(33)
    W, H = struct.unpack(">II", hdr[16:24])
    w_pt, h_pt = float(W), float(H)

    out = subprocess.run([str(ocr), str(png)], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines():
        if "\t" not in line:
            continue
        nums, text = line.split("\t", 1)
        x, y, bw, bh = (float(v) for v in nums.split())
        rows.append({
            "text": text,
            "left": x * w_pt,
            "right": (x + bw) * w_pt,
            "top": (1 - y - bh) * h_pt,   # Vision は左下原点
            "bottom": (1 - y) * h_pt,
        })
    rows.sort(key=lambda r: r["top"])

    print(f"== 行の揃い  {png.name}  {w_pt:.0f}x{h_pt:.0f}pt  許容 {tol}pt ==\n")
    print("  左端    上     高さ  文字")
    for r in rows:
        print(f"  {r['left']:6.1f} {r['top']:6.1f} {r['bottom']-r['top']:5.1f}  {r['text'][:40]}")

    # 左端の塊。いちばん人数の多い塊を基準線とする。
    buckets = collections.Counter(round(r["left"] / tol) for r in rows)
    base_key, _ = buckets.most_common(1)[0]
    base = base_key * tol
    print(f"\n  基準線 = {base:.1f}pt（{buckets[base_key]}/{len(rows)} 段がここに乗る）")

    off = [r for r in rows if abs(r["left"] - base) > tol]
    if not off:
        print(f"  ✓ ずれている段は無い（±{tol}pt）")
    else:
        print(f"  ✗ 基準線から外れた段が {len(off)}:")
        for r in off:
            print(f"      {r['left']-base:+6.1f}pt  {r['text'][:36]}")

    # 右端。右へ寄せるものが混在していないか。
    print(f"\n  右端の最大 = {max(r['right'] for r in rows):.1f}pt / 面 {w_pt:.0f}pt")

    # 段の間。**穴を探す。**
    #
    # ここが本命。craft3 の確認の面は、下見が `ScrollView` に 66pt を取られ、
    # かつ面の高さが別に 2 行ぶん予約していたため、本文と出所の間に 40pt、
    # 直したあとは出所とボタンの間に 40pt の穴が空いていた。
    # 左端のずれ（±2pt）は墨の食い込みでも出るが、**穴は出ない**。
    #
    # 操作の行の手前だけは離して良い。中身と操作は別のものなので、
    # そこは間隔ではなく区切りとして働く。最後の間だけ除いて数える。
    gaps = []
    for a, b in zip(rows, rows[1:]):
        g = b["top"] - a["bottom"]
        gaps.append((g, a["text"][:16], b["text"][:16]))
    print("\n  段の間（前の段の下端 → 次の段の上端）:")
    for g, x, y in gaps:
        print(f"      {g:6.1f}pt   {x} → {y}")

    # 同じ行に並ぶもの（重なる＝負）は間ではない。
    pos = [g for g in gaps if g[0] > 0]
    holes = []
    if len(pos) >= 3:
        # 最後の正の間＝操作との区切り。これは除く。
        body_gaps = pos[:-1]
        vals = sorted(g[0] for g in body_gaps)
        med = vals[len(vals) // 2]
        print(f"\n  中身の間の中央値 = {med:.1f}pt（操作の手前 {pos[-1][0]:.1f}pt は区切りとして除外）")
        holes = [g for g in body_gaps if g[0] > med * 2]
        if holes:
            print(f"  ✗ 穴が {len(holes)}（中央値の 2 倍を超える間）:")
            for g, x, y in holes:
                print(f"      {g:6.1f}pt   {x} → {y}")
        else:
            print("  ✓ 穴は無い")
    return 1 if holes else 0

if __name__ == "__main__":
    sys.exit(main())
