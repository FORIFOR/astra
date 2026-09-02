#!/usr/bin/env python3
"""面積は目で測らない。

craft3（字面の階層）で、3 人の審査員が揃って「C は背が高い」と証言した。
実寸は 3 枚とも 560x286 で同じだった。彼らは版面を見て高さを**推論**しており、
測ってはいない。以後 screen_occupation の順位はここが出す。審査員の
screen_occupation は Evidence D（根拠なし）として捨てる。

    python3 scripts/ux-auto/occupation.py <画像ディレクトリ>
"""
import struct, sys, pathlib

def size(p: pathlib.Path):
    d = p.open("rb").read(33)
    if d[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"PNG ではない: {p}")
    return struct.unpack(">II", d[16:24])

def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    d = pathlib.Path(sys.argv[1])
    imgs = sorted(d.glob("*.png"))
    if not imgs:
        raise SystemExit(f"png が無い: {d}")
    rows = [(p.stem, *size(p)) for p in imgs]
    rows.sort(key=lambda r: r[1] * r[2])
    print("== screen_occupation（実測・Evidence A）==")
    for name, w, h in rows:
        print(f"  {name}  {w}x{h}px = {w//2}x{h//2}pt  面積 {w*h//4}pt2")
    areas = {r[1] * r[2] for r in rows}
    if len(areas) == 1:
        print("\n  差が無い。screen_occupation では優劣を付けない。")
    else:
        print("\n  少ない順: " + " > ".join(r[0] for r in rows))
    return 0

if __name__ == "__main__":
    sys.exit(main())
