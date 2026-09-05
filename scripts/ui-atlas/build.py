#!/usr/bin/env python3
"""UI Atlas を組む。

    python3 scripts/ui-atlas/build.py <capture-dir>

<capture-dir> は scripts/ui-atlas/capture-rc.sh の出力（署名済み RC .app が描いた png と
rc-fingerprint.json）。ここから docs/ui-atlas/ に

    manifest.json       正本（画面の説明は人が書く。image / sha256 / size / rc はここで埋める）
    screens/<id>.<light|dark>.png
    strips/<id>.png     60fps の frame から T0 / +50 / +100 / +200 / final の 5 枚
    contact-sheet.png   全画面の一覧
    index.html          1 画面 1 ページ
    Astra-UI-Atlas.pdf  index.html を Chrome headless で印刷
    README.md

を書く。画像は RC の描画だけ。manifest で capture が null の画面はそのまま残す（gate が落ちる）。
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
ATLAS = ROOT / "docs" / "ui-atlas"
MANIFEST = ATLAS / "manifest.json"

CAPTURE_DIR = {  # selftest 名 → capture 側のディレクトリ（light, dark）
    "shots": ("shots-light", "shots-dark"),
    "dock8": ("dock-light", "dock-dark"),
    "sessionshots": ("session-light", "session-dark"),
    "sections": ("sections-light", "sections-dark"),
    "states": ("states-light", "states-dark"),
    "sysshots": ("sys-light", "sys-dark"),
}
STRIP_TARGETS_MS = [0, 50, 100, 200, None]  # None = final
DESCRIPTION_FIELDS = ["trigger", "meaning", "primary", "secondary", "states", "keys", "privacy", "window", "invariant"]


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def font(size: int):
    for name in ["/System/Library/Fonts/ヒラギノ角ゴシック W4.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc",
                 "/System/Library/Fonts/Helvetica.ttc"]:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def place_screens(m: dict, cap: Path, fp: dict) -> None:
    out = ATLAS / "screens"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for s in m["screens"]:
        c = s.get("capture")
        s.pop("image", None)
        if not c:
            s["status"] = s.get("status") or "NO_CAPTURE_PATH"
            s["source"] = None
            continue
        image: dict = {"sha256": {}, "size": {}}
        missing = []
        for appearance in c.get("appearances", ["light"]):
            if c["selftest"] == "journey":
                src = cap / f"journey-{c['journey']}" / c["file"]
            else:
                d = CAPTURE_DIR[c["selftest"]][0 if appearance == "light" else 1]
                name = c.get("dark_file") if appearance == "dark" and c.get("dark_file") else c["file"]
                src = cap / d / name
                if not src.exists() and appearance == "dark":
                    src = cap / d / c["file"]
            if not src.exists():
                missing.append(appearance)
                continue
            dst = out / f"{s['id']}.{appearance}.png"
            shutil.copyfile(src, dst)
            with Image.open(dst) as im:
                image["size"][appearance] = {"w": im.width, "h": im.height}
            image["sha256"][appearance] = sha256(dst)
            image[appearance] = f"screens/{dst.name}"
        s["image"] = image
        s["source"] = "RC"
        s["captured"] = {"exe_sha256": fp["exe_sha256"], "selftest": c["selftest"], "at": fp["captured_at"]}
        s["status"] = "CAPTURE_MISSING:" + ",".join(missing) if missing else "CAPTURED"


def build_strips(m: dict, cap: Path, fp: dict) -> None:
    out = ATLAS / "strips"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    result_path = cap / "motion" / "result.json"
    result = json.loads(result_path.read_text()) if result_path.exists() else {"transitions": []}
    by_name = {t["name"]: t for t in result.get("transitions", [])}
    f = font(14)
    for st in m["strips"]:
        c = st.get("capture")
        st.pop("image", None)
        st.pop("measured", None)
        if not c:
            st["status"] = st.get("status") or "NO_CAPTURE_PATH"
            continue
        frames = sorted((cap / "motion" / c["dir"]).glob("f*.png"))
        t = by_name.get(c["result_key"])
        if not frames or not t:
            st["status"] = "CAPTURE_MISSING"
            continue
        samples = t["samples"]
        n = min(len(frames), len(samples))
        picks = []
        for target in STRIP_TARGETS_MS:
            if target is None:
                idx = n - 1
            else:
                idx = min(range(n), key=lambda i: abs(samples[i]["ms"] - target))
            if idx not in picks:
                picks.append(idx)
        # 1 枚あたりの幅を揃える。高さは中身で違うので、上辺を揃えて並べる（上辺 Y 固定を目で確かめられる）。
        cell_w = 420
        scaled = []
        for i in picks:
            with Image.open(frames[i]) as im:
                r = cell_w / im.width
                scaled.append((im.resize((cell_w, max(1, round(im.height * r))), Image.Resampling.LANCZOS), samples[i]))
        cell_h = max(im.height for im, _ in scaled)
        pad, label_h, foot_h = 12, 26, 48
        W = pad + len(scaled) * (cell_w + pad)
        H = pad + label_h + cell_h + foot_h
        sheet = Image.new("RGB", (W, H), (245, 245, 247))
        d = ImageDraw.Draw(sheet)
        x = pad
        for im, smp in scaled:
            d.text((x, pad), f"T+{smp['ms']:.0f} ms  dock {smp['dockW']}×{smp['dockH']}  windows {smp['windows']}", fill=(40, 40, 40), font=f)
            sheet.paste(im, (x, pad + label_h))
            x += cell_w + pad
        top_drift = max(s_["dockTop"] for s_ in samples[:n]) - min(s_["dockTop"] for s_ in samples[:n])
        extra_windows = max(s_["windows"] for s_ in samples[:n]) - t["expectedWindows"]
        measured = {
            "top_edge_drift_pt": top_drift,
            "center_drift_pt": t.get("centerDriftPt"),
            "window_creation": extra_windows,
            "focus_theft": t.get("focusTheft"),
            "effective_fps": round(t.get("effectiveFps", 0), 1),
            "frames": t.get("frames"),
            "max_gap_ms": round(t.get("maxGapMs", 0), 1),
            "same_dock_id_pct": t.get("sameDockIdPct"),
            "missing_surface_frames": t.get("missingSurfaceFrames"),
            "expected_windows": t["expectedWindows"],
        }
        foot = (f"top edge drift = {top_drift}   center drift = {measured['center_drift_pt']}   "
                f"window creation = {extra_windows}   focus theft = {measured['focus_theft']}   "
                f"{measured['effective_fps']} fps / {measured['frames']} frames / max gap {measured['max_gap_ms']} ms")
        d.text((pad, H - foot_h + 10), foot, fill=(40, 40, 40), font=f)
        dst = out / f"{st['id']}.png"
        sheet.save(dst)
        st["image"] = f"strips/{dst.name}"
        st["frames_ms"] = [round(samples[i]["ms"]) for i in picks]
        st["measured"] = measured
        st["sha256"] = sha256(dst)
        st["source"] = "RC"
        st["captured"] = {"exe_sha256": fp["exe_sha256"], "selftest": "surfacemotion", "at": fp["captured_at"]}
        st["status"] = "CAPTURED"


def contact_sheet(m: dict) -> None:
    cols, cell_w, cell_h, pad, label_h = 4, 300, 200, 16, 34
    items = m["screens"]
    rows = (len(items) + cols - 1) // cols
    W = pad + cols * (cell_w + pad)
    H = pad + rows * (cell_h + label_h + pad)
    sheet = Image.new("RGB", (W, H), (245, 245, 247))
    d = ImageDraw.Draw(sheet)
    f, fs = font(13), font(11)
    for k, s in enumerate(items):
        x = pad + (k % cols) * (cell_w + pad)
        y = pad + (k // cols) * (cell_h + label_h + pad)
        img = (s.get("image") or {}).get("light")
        if img:
            with Image.open(ATLAS / img) as im:
                r = min(cell_w / im.width, cell_h / im.height)
                th = im.resize((max(1, round(im.width * r)), max(1, round(im.height * r))), Image.Resampling.LANCZOS)
            d.rectangle([x, y, x + cell_w, y + cell_h], fill=(255, 255, 255), outline=(215, 215, 220))
            sheet.paste(th, (x + (cell_w - th.width) // 2, y + (cell_h - th.height) // 2))
        else:
            d.rectangle([x, y, x + cell_w, y + cell_h], fill=(232, 232, 236), outline=(200, 60, 60))
            d.text((x + 12, y + cell_h // 2 - 8), "NO CAPTURE PATH", fill=(200, 60, 60), font=f)
        d.text((x, y + cell_h + 6), s["id"], fill=(30, 30, 30), font=f)
        d.text((x, y + cell_h + 22), s["title"][:48], fill=(110, 110, 115), font=fs)
    sheet.save(ATLAS / "contact-sheet.png")


def esc(s) -> str:
    return (str(s) if s is not None else "—").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def write_html(m: dict, summary: dict) -> None:
    rc = m["rc"]
    groups = {g["id"]: g for g in m["groups"]}
    parts = [f"""<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>Astra UI Atlas — RC {esc(rc['sha'])}</title>
<style>
 body{{font-family:-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif;color:#1d1d1f;margin:0;background:#fff}}
 .page{{page-break-after:always;padding:28px 36px;min-height:96vh;box-sizing:border-box}}
 h1{{font-size:26px;margin:0 0 6px}} h2{{font-size:20px;margin:0 0 2px}} .sub{{color:#6e6e73;font-size:13px;margin-bottom:14px}}
 .shots{{display:flex;gap:16px;align-items:flex-start;margin:12px 0 16px}}
 .shots figure{{margin:0;flex:1;min-width:0}} .shots img{{max-width:100%;border:1px solid #d2d2d7;border-radius:6px;background:#f5f5f7}}
 .shots figcaption{{font-size:11px;color:#6e6e73;margin-top:4px}}
 table{{border-collapse:collapse;width:100%;font-size:12.5px}} td,th{{border-top:1px solid #e5e5ea;padding:5px 8px;vertical-align:top;text-align:left}}
 th{{width:170px;color:#6e6e73;font-weight:500}}
 .miss{{border:2px solid #d0342c;border-radius:8px;padding:14px;background:#fff5f4;color:#8a1f18;font-size:13px}}
 .kv{{font-size:12px;color:#6e6e73;margin-top:10px}} code{{font-family:ui-monospace,Menlo,monospace;font-size:11.5px}}
 .cover td{{font-size:14px}} .ok{{color:#1b7f3b}} .ng{{color:#d0342c}}
</style></head><body>"""]
    # 表紙
    parts.append(f"""<div class="page"><h1>Astra UI Atlas — Visual Release Book</h1>
<div class="sub">RC {esc(rc['sha'])} / exe sha256 <code>{esc(rc.get('exe_sha256','')[:16])}…</code> / built {esc(rc.get('built'))} / captured {esc(rc.get('captured_at'))} / {esc(rc.get('codesign_identifier'))} ({esc(rc.get('team'))})</div>
<p>取扱説明書ではなく、<b>UI 設計の完成検査資料</b>。画像は全部、署名済み RC .app が描いたもの（モック・Figma 不可）。
1 画面 1 ページ。各ページを KEEP / FIX / NOT_ENOUGH_EVIDENCE で採点し、全部 KEEP で VISUAL_IDEAL_GATE = PASS。</p>
<table class="cover">
<tr><th>required screens</th><td>{summary['required']}</td></tr>
<tr><th>required with RC image</th><td class="{'ok' if summary['required_missing']==0 else 'ng'}">{summary['required_captured']} / {summary['required']}</td></tr>
<tr><th>NO_CAPTURE_PATH (required)</th><td class="{'ok' if summary['required_missing']==0 else 'ng'}">{summary['required_missing']}</td></tr>
<tr><th>strips (60fps)</th><td class="{'ok' if summary['strips_missing']==0 else 'ng'}">{summary['strips_captured']} / {summary['strips_required']}</td></tr>
<tr><th>reality gates</th><td>{', '.join(f"{r['gate']} = {r['status']}" for r in m['reality'])}</td></tr>
</table>
<h2 style="margin-top:22px">Appearance-invariant screens（light と dark の sha256 が同じ）</h2>
<p class="kv">{esc(", ".join(summary["appearance_invariant"]) or "なし")}<br>Dock / HUD は <code>appearance_policy: fixed</code>（OS の外観に関わらず同じ ambient surface。同じなのは仕様）。Main / Workspace は <code>adaptive</code>（違うのが仕様）。両方向の違反: <b class="{'ok' if not summary['appearance_policy']['violations'] else 'ng'}">{esc(", ".join(summary["appearance_policy"]["violations"]) or "0")}</b></p></div>
<div class="page"><h2>Contact sheet</h2><img src="contact-sheet.png" style="max-width:100%;border:1px solid #d2d2d7"></div>""")
    # 画面
    for s in m["screens"]:
        g = groups.get(s["group"], {})
        parts.append(f'<div class="page"><h2>{esc(s["title"])}</h2><div class="sub">{esc(g.get("title"))} · <code>{esc(s["id"])}</code> · required={str(s.get("required", False)).lower()} · status={esc(s.get("status"))}</div>')
        img = s.get("image")
        if img and (img.get("light") or img.get("dark")):
            parts.append('<div class="shots">')
            for ap in ("light", "dark"):
                if img.get(ap):
                    sz = img["size"][ap]
                    parts.append(f'<figure><img src="{img[ap]}"><figcaption>{ap} · {sz["w"]}×{sz["h"]} px (1x) · sha256 <code>{img["sha256"][ap][:16]}…</code></figcaption></figure>')
            parts.append('</div>')
        else:
            parts.append(f'<div class="miss"><b>NO IMAGE — {esc(s.get("status"))}</b><br>{esc(s.get("note"))}</div>')
        rows = [("Trigger / どこから開くか", s.get("trigger")), ("Meaning / 何をする画面か", s.get("meaning")),
                ("Primary action", s.get("primary")), ("Secondary action", s.get("secondary")),
                ("表示される状態", s.get("states")), ("Esc / keyboard", s.get("keys")),
                ("Privacy / external side effect", s.get("privacy")),
                ("前の画面", ", ".join(s.get("prev") or []) or "—"), ("次の画面", ", ".join(s.get("next") or []) or "—"),
                ("Window / One Surface", s.get("window")), ("Truth invariant", s.get("invariant")),
                ("Appearance policy", s.get("appearance_policy", "adaptive")),
                ("Note", s.get("note") or "—"),
                ("Source", s.get("source") or "—"), ("RC SHA", rc["sha"])]
        parts.append("<table>" + "".join(f"<tr><th>{esc(k)}</th><td>{esc(v)}</td></tr>" for k, v in rows) + "</table>")
        parts.append('<div class="kv">評価軸: Hierarchy · Density · Alignment · Typography · Contrast · State legibility · Primary-action clarity · Screen occupation · Surface continuity · Calmness · Consistency · Trust/provenance · Error recovery clarity · Competitive polish &nbsp;&nbsp;→&nbsp; <b>KEEP / FIX / NOT_ENOUGH_EVIDENCE</b></div></div>')
    # strips
    for st in m["strips"]:
        parts.append(f'<div class="page"><h2>Strip — {esc(st["title"])}</h2><div class="sub"><code>{esc(st["id"])}</code> · status={esc(st.get("status"))}</div>')
        if st.get("image"):
            mm = st["measured"]
            parts.append(f'<img src="{st["image"]}" style="max-width:100%;border:1px solid #d2d2d7"><table style="margin-top:12px">'
                         + "".join(f"<tr><th>{esc(k)}</th><td>{esc(v)}</td></tr>" for k, v in mm.items())
                         + f'<tr><th>frames (ms)</th><td>{esc(st.get("frames_ms"))}</td></tr></table>')
        else:
            parts.append(f'<div class="miss"><b>NO STRIP — {esc(st.get("status"))}</b><br>{esc(st.get("note"))}</div>')
        parts.append('</div>')
    # reality
    parts.append('<div class="page"><h2>Reality gates（静止画では証明できない 3 つ + hands-on）</h2><table>')
    for r in m["reality"]:
        parts.append(f'<tr><th>{esc(r["gate"])}</th><td><b>{esc(r["status"])}</b><br>{esc(", ".join(r["rows"]))}<br><code>{esc(r["where"])}</code></td></tr>')
    parts.append('</table><p class="kv">実行後に結果をここへ追記して、Atlas を Visual + Reality Release Certificate にする。</p></div>')
    parts.append("</body></html>")
    (ATLAS / "index.html").write_text("\n".join(parts), encoding="utf-8")


def write_pdf() -> bool:
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if not os.path.exists(chrome):
        print("PDF: Chrome が無いので書かない", file=sys.stderr)
        return False
    pdf = ATLAS / "Astra-UI-Atlas.pdf"
    pdf.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        # headless Chrome は印刷後に居座ることがある（実際に起きた）。PDF が書けたら止める。
        proc = subprocess.Popen([chrome, "--headless=new", "--disable-gpu", f"--user-data-dir={tmp}", "--no-pdf-header-footer",
                                 "--run-all-compositor-stages-before-draw", "--virtual-time-budget=10000",
                                 f"--print-to-pdf={pdf}", (ATLAS / "index.html").as_uri()],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        import time
        stable, last = 0, -1
        for _ in range(180):
            if proc.poll() is not None:
                break
            time.sleep(1)
            size = pdf.stat().st_size if pdf.exists() else -1
            stable = stable + 1 if size == last and size > 0 else 0
            last = size
            if stable >= 3:  # 3 秒サイズが変わらなければ書き終わっている
                break
        if proc.poll() is None:
            proc.kill()
            proc.wait()
    ok = pdf.exists() and pdf.stat().st_size > 10_000
    if not ok:
        print("PDF: Chrome が書かなかった", file=sys.stderr)
    return ok


def write_readme(m: dict, summary: dict) -> None:
    rc = m["rc"]
    lines = [f"# Astra UI Atlas — Visual Release Book (RC {rc['sha']})", "",
             "取扱説明書ではない。**全 UI を RC .app の実画像で 1 画面 1 ページに固定し、ページ単位で KEEP / FIX / NOT_ENOUGH_EVIDENCE を出す**ための資料。",
             "画像は署名済み RC .app が `--selftest` で描いたものだけ。モック・Figma・別ビルドは入れない。", "",
             "```",
             f"RC SHA            {rc['sha']}",
             f"RC exe sha256     {rc.get('exe_sha256')}",
             f"RC built          {rc.get('built')}   captured {rc.get('captured_at')}",
             f"codesign          {rc.get('codesign_identifier')} / {rc.get('team')}",
             f"required screens  {summary['required']}   with RC image {summary['required_captured']}   NO_CAPTURE_PATH {summary['required_missing']}",
             f"strips            {summary['strips_captured']} / {summary['strips_required']}",
             f"light == dark     {len(summary['appearance_invariant'])} 面（{', '.join(summary['appearance_invariant']) or 'なし'}）",
             f"appearance_policy fixed {len(summary['appearance_policy']['fixed'])} 面 / 違反 {len(summary['appearance_policy']['violations'])}（{', '.join(summary['appearance_policy']['violations']) or 'なし'}）",
             "```", "",
             "| ファイル | 中身 |", "|---|---|",
             "| `Astra-UI-Atlas.pdf` | 1 画面 1 ページ。表紙に集計、末尾に strip と reality gate |",
             "| `index.html` | PDF の元。ブラウザで開くと同じもの |",
             "| `contact-sheet.png` | 全画面の一覧（light）。赤枠は撮る経路が無い画面 |",
             "| `manifest.json` | 正本。説明は人が書き、image / sha256 / size / rc は build が埋める |",
             "| `screens/<id>.<light,dark>.png` | 個別 PNG |",
             "| `strips/<id>.png` | 60fps frame から T0 / +50 / +100 / +200 / final |", "",
             "## 画面一覧", "", "| id | title | status | light | dark |", "|---|---|---|---|---|"]
    for s in m["screens"]:
        img = s.get("image") or {}
        l = f"[png]({img['light']})" if img.get("light") else "—"
        d = f"[png]({img['dark']})" if img.get("dark") else "—"
        lines.append(f"| `{s['id']}` | {s['title']} | {s.get('status')} | {l} | {d} |")
    lines += ["", "## Strips", "", "| id | title | status | top edge drift | center drift | window creation | focus theft |", "|---|---|---|---|---|---|---|"]
    for st in m["strips"]:
        mm = st.get("measured") or {}
        lines.append(f"| `{st['id']}` | {st['title']} | {st.get('status')} | {mm.get('top_edge_drift_pt', '—')} | {mm.get('center_drift_pt', '—')} | {mm.get('window_creation', '—')} | {mm.get('focus_theft', '—')} |")
    lines += ["", "## Reality gates", "", "| gate | status | where |", "|---|---|---|"]
    for r in m["reality"]:
        lines.append(f"| {r['gate']} | {r['status']} | `{r['where']}` |")
    lines += ["", "## 作り直し方", "",
              "```bash",
              "bash scripts/ui-atlas/capture-rc.sh apps/astra-macos/.build/Astra.app /tmp/astra-atlas   # RC .app だけが描く",
              "python3 scripts/ui-atlas/build.py /tmp/astra-atlas                                      # docs/ui-atlas/ を組む",
              "bash scripts/verify-ui-atlas.sh                                                          # UI_ATLAS_GATE",
              "```", "",
              "`NO_CAPTURE_PATH` の画面は、その面を RC に描かせる selftest が無い。**製品コードではなく test code** を足して、次の RC で撮る。", "",
              "## リリース経路での位置（2026-09-05、本人の指示）", "",
              "```",
              "1. RC から全 UI Atlas 生成  →  2. GitHub 公開  →  3. 全画像を目視評価  →  4. VISUAL_IDEAL_GATE",
              "   FAIL → そこだけ修正 / PASS → 5. 新しい最終 RC を凍結",
              "6. REAL_MEETING → 7. ACCESSIBILITY → 8. LIVE_TCC → 9. Reality 結果を Atlas へ追記 → 10. FINAL_IDEAL_RELEASE_GATE → GO",
              "```", "",
              "残りの実機 gate を旧 RC でやる無駄を防ぐため、Atlas を先に見る。UI FIX が 1 つでも出たら、新 RC で撮り直す。", "",
              "## 採点の仕方", "",
              "1 ページずつ、評価軸（Hierarchy / Density / Alignment / Typography / Contrast / State legibility / Primary-action clarity / Screen occupation / Surface continuity / Calmness / Consistency / Trust-provenance / Error recovery clarity / Competitive polish）で見て、",
              "`KEEP` / `FIX` / `NOT_ENOUGH_EVIDENCE` を id ごとに書く。全部 `KEEP` で `VISUAL_IDEAL_GATE = PASS`。",
              "「以前の測定で大丈夫だったから KEEP」はしない。最終 RC の実画像そのものを見る。", ""]
    (ATLAS / "README.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    cap = Path(sys.argv[1]).resolve()
    fp = json.loads((cap / "rc-fingerprint.json").read_text())
    m = json.loads(MANIFEST.read_text(encoding="utf-8"))
    m["rc"].update({k: fp[k] for k in ("exe_sha256", "built", "codesign_identifier", "team", "captured_at")})
    place_screens(m, cap, fp)
    build_strips(m, cap, fp)
    contact_sheet(m)
    req = [s for s in m["screens"] if s.get("required")]
    st_req = [s for s in m["strips"] if s.get("required")]
    summary = {
        "required": len(req),
        "required_captured": sum(1 for s in req if s.get("status") == "CAPTURED"),
        "required_missing": sum(1 for s in req if s.get("status") != "CAPTURED"),
        "strips_required": len(st_req),
        "strips_captured": sum(1 for s in st_req if s.get("status") == "CAPTURED"),
        "strips_missing": sum(1 for s in st_req if s.get("status") != "CAPTURED"),
    }
    summary["appearance_invariant"] = [
        s["id"] for s in m["screens"]
        if (s.get("image") or {}).get("light") and (s.get("image") or {}).get("dark")
        and s["image"]["sha256"]["light"] == s["image"]["sha256"]["dark"]]
    # appearance_policy: fixed（Dock / HUD。light == dark が仕様）と adaptive（Main / Workspace。light != dark が仕様）。
    # 「同じなのは欠陥か」を毎回議論しないために、manifest が意味を持ち、build が両方向の違反を数える。
    violations = []
    for s in m["screens"]:
        img = s.get("image") or {}
        if not (img.get("light") and img.get("dark")):
            continue
        same = img["sha256"]["light"] == img["sha256"]["dark"]
        pol = s.get("appearance_policy", "adaptive")
        if pol == "fixed" and not same:
            violations.append(f"{s['id']} (fixed なのに light != dark)")
        if pol == "adaptive" and same:
            violations.append(f"{s['id']} (adaptive なのに light == dark)")
    summary["appearance_policy"] = {
        "fixed": [s["id"] for s in m["screens"] if s.get("appearance_policy") == "fixed"],
        "violations": violations,
    }
    m["summary"] = summary
    MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_html(m, summary)
    pdf = write_pdf()
    write_readme(m, summary)
    print(f"ATLAS_BUILT screens {summary['required_captured']}/{summary['required']} required captured, "
          f"NO_CAPTURE_PATH {summary['required_missing']}, strips {summary['strips_captured']}/{summary['strips_required']}, pdf={'yes' if pdf else 'NO'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
