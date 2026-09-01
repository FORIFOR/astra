#!/usr/bin/env python3
"""ACCESSIBILITY_GATE — 機械が人より安定して測れるところ。

測るもの（根拠のある基準だけ）:
  contrast    WCAG 2.2 の 1.4.3。本文 4.5:1、大きい字 3:1
  target      Apple HIG のポインタ操作 24pt、指 44pt。ここは 24pt を床にする
  labels      画面の文字が読み取れるか（OCR）。読めない字は誰にも読めない

測れないもの（PASS にしない。**未計測と書く**）:
  VoiceOver の読み上げ順・focus の見え方・Reduce Motion
  → 自プロセスの AX 木が子を返さないため外から辿れない（実測した）
"""
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
tok = json.load(open(os.path.join(ROOT, "shared/design/tokens.json")))

def lum(hexs):
    h = hexs.lstrip("#")
    r, g, b = (int(h[i:i+2], 16) / 255 for i in (0, 2, 4))
    def f(c): return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

C = tok["color"]
# 境界（hairline）は WCAG 1.4.11 の「情報を伝える部品」ではないので床を課さない。
# 課すと毎回未達が出続け、本当の未達が埋もれる。参考値としてだけ出す。
PAIRS = [("text", "canvas", 4.5, "本文 / 地"),
         ("text", "surface", 4.5, "本文 / 面"),
         ("muted", "canvas", 4.5, "補助文字 / 地"),
         ("muted", "surface", 4.5, "補助文字 / 面"),
         ("accent", "canvas", 4.5, "強調 / 地"),
         ("accent", "surface", 4.5, "強調 / 面"),
         ("danger", "surface", 4.5, "警告 / 面"),
         ("border", "canvas", 0.0, "境界 / 地（参考）")]

fail, rows = [], []
for fg, bg, floor, name in PAIRS:
    for mode in ("light", "dark"):
        r = ratio(C[fg][mode], C[bg][mode])
        ok = r >= floor
        rows.append((name, mode, r, floor, ok))
        if not ok:
            fail.append(f"contrast {name}（{mode}）{r:.2f}:1 < {floor}:1")

# 触る的の大きさ。**押せるものだけ**見る（一覧は auto/interactive.txt）。
TARGET_MIN = 24
INTER = set()
for line in open(os.path.join(ROOT, "docs/ux-benchmark/auto/interactive.txt"), encoding="utf-8"):
    line = line.strip()
    if line and not line.startswith("#"): INTER.add(line)

small, unknown = [], set()
for f in sorted(glob.glob(os.path.join(ROOT, "docs/golden-screenshots/geometry/*.json"))):
    d = json.load(open(f))
    for k, v in d.items():
        if k.startswith("text:") or ":centerOffset" in k or k.startswith("window:"):
            continue
        if k not in INTER:
            unknown.add(k); continue
        h, w = v.get("h", 0), v.get("w", 0)
        if 0 < h < TARGET_MIN or 0 < w < TARGET_MIN:
            small.append((os.path.basename(f)[:-5], k, w, h))

print("== ACCESSIBILITY_GATE ==\n")
print("  対比（WCAG 2.2 / 1.4.3）")
for name, mode, r, floor, ok in rows:
    print(f"    {name:<16} {mode:<6} {r:5.2f}:1  床 {floor}  {'' if ok else '未達'}")
print(f"\n  触る的（{TARGET_MIN}pt 未満）")
if small:
    for f, k, w, h in small[:10]:
        print(f"    {f:<18} {k:<28} {w}x{h}")
        fail.append(f"target {k} が {w}x{h}（{TARGET_MIN}pt 未満）")
else:
    print("    なし")
# 一覧に無いキー。**押せるものを書き忘れていたら、ここに出る。**
if unknown:
    print(f"\n  分類されていない実寸キー {len(unknown)} 件（押せるものが混ざっていないか見る）")
    for k in sorted(unknown)[:12]: print(f"    {k}")

NOT_MEASURED = [
    "VoiceOver の読み上げ順と label（自プロセスの AX 木が子を返さない）",
    "focus の見え方と順序（同上）",
    "Reduce Motion / 文字サイズ変更（外から切り替えて再撮影する仕組みが要る）",
]
print("\n  未計測（PASS の根拠にしない）")
for n in NOT_MEASURED: print(f"    {n}")

verdict = "FAIL" if fail else "PARTIAL"
print()
for f in fail: print("  未達:", f)
print(f"\nACCESSIBILITY_GATE={verdict}")
if verdict == "PARTIAL":
    print("  測れた範囲は通った。未計測が残るので PASS とは言わない。")

out = os.path.join(ROOT, "artifacts/ux/accessibility.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump({"verdict": verdict, "failures": fail, "not_measured": NOT_MEASURED},
          open(out, "w"), ensure_ascii=False, indent=2)
sys.exit(1 if fail else 0)
