#!/usr/bin/env python3
"""⑤ 主たる操作を、逃げ道より小さくしない。

「送る」は 2 文字、Cancel は 6 文字。padding だけで大きさを決めると、
**字数で重さが決まる**。実測で Cancel 76pt > 送る 68pt になっていた。

宣言値でも「墨 + padding」の推定でもなく、描かれた矩形を測る
（`tools/ux-lab/rect`）。逃げ道のほうは塗りが無いので墨から出すが、
**ラベル名では拾わない**。最初はそうしていて、OCR が Cancel を
Cancell と読んだ回に awk の完全一致が外れ、より狭い Edit と比べて
通ってしまった。壊しても落ちないゲートだった。

いまは**塗りと同じ高さの帯に居る文字**を全部、逃げ道として数える。

    primary.py <png>
"""
import subprocess, sys, pathlib, struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
LAB = ROOT / ".build/uxlab"
SEC_PAD = 14   # 逃げ道の左右の余白（VoiceHUDView）

def main() -> int:
    png = pathlib.Path(sys.argv[1])
    W, H = struct.unpack(">II", png.open("rb").read(33)[16:24])

    out = subprocess.run([str(LAB / "rect"), str(png), str(int(H * 0.7))],
                         capture_output=True, text=True).stdout
    fill = [l.split()[1:] for l in out.splitlines() if l.startswith("FILL")]
    if not fill or fill[0][0] == "none":
        print("主たる操作の塗りが見つからない")
        return 1
    fx, fy, fw, fh = (int(v) for v in fill[0])

    ocr = subprocess.run([str(LAB / "ocr"), str(png)], capture_output=True, text=True).stdout
    others = []
    for line in ocr.splitlines():
        if "\t" not in line:
            continue
        nums, text = line.split("\t", 1)
        x, y, bw, bh = (float(v) for v in nums.split())
        top, bot = (1 - y - bh) * H, (1 - y) * H
        mid = (top + bot) / 2
        if not (fy <= mid <= fy + fh):        # 操作の帯の外
            continue
        left, right = x * W, (x + bw) * W
        if left >= fx and right <= fx + fw:   # 主たる操作のラベル自身
            continue
        others.append((text.strip(), right - left + 2 * SEC_PAD))

    if not others:
        print(f"逃げ道が見つからない（主 {fw}x{fh}pt のみ）")
        return 1
    name, widest = max(others, key=lambda t: t[1])
    if fw >= widest:
        print(f"主たる操作 {fw}x{fh}pt が逃げ道 {widest:.0f}pt（{name}）以上")
        return 0
    print(f"主たる操作 {fw}pt が逃げ道 {widest:.0f}pt（{name}）より小さい")
    for n, w in sorted(others, key=lambda t: -t[1]):
        print(f"  {n} {w:.0f}pt")
    return 1

if __name__ == "__main__":
    sys.exit(main())
