#!/usr/bin/env bash
# UI Atlas の**独立 pixel review を人手なしで**行う（VISUAL_IDEAL_GATE の判定器）。
#
# 61 面（required）の light 画像を乱数 ID に改名して箱に入れ、3 つの vision judge
# （opus / sonnet / haiku）に **観察を先に**、次に KEEP / FIX / NOT_ENOUGH_EVIDENCE を
# 出させる。judge はリポジトリも manifest も見ない（画像だけ）。
#
# 判定の規則（docs/ux-benchmark/auto/JUDGE_PROMPT.md と同じ流儀）:
#   - visible_text を OCR と照合し、画面に無い文字を根拠にした judge のその面は無効
#   - 有効な judge が 2 未満の面は NOT_ENOUGH_EVIDENCE
#   - 有効な judge **全員**が FIX と言った面だけ FIX_CANDIDATE（deterministic evidence と
#     突き合わせて初めて FIX。主観だけでは直さない）
#   - それ以外は KEEP
#   VISUAL_IDEAL_GATE=PASS ⇔ FIX_CANDIDATE 0 かつ NOT_ENOUGH_EVIDENCE 0
#
#   bash scripts/ui-atlas/review-blind.sh [out-dir]   （既定 docs/ui-atlas/review/<rc.sha>）
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ATLAS="$ROOT/docs/ui-atlas"
MODELS="${ASTRA_JUDGE_MODELS:-opus sonnet haiku}"
BATCH="${ASTRA_JUDGE_BATCH:-6}"
RC="$(python3 -c "import json;print(json.load(open('$ATLAS/manifest.json'))['rc']['sha'])")"
OUT="${1:-$ATLAS/review/$RC}"
WORK="$(mktemp -d)"
OCR="$ROOT/.build/uxlab/ocr"
[[ -x "$OCR" ]] || bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null
mkdir -p "$OUT"
# judge は箱（別ディレクトリ）の中で走るので、出力先は絶対パスに。相対のままだと judge が黙って落ちた（実測）。
OUT="$(cd "$OUT" && pwd)"

# 1. 箱を作る（乱数 ID、鍵は箱の外）。
python3 - "$ATLAS" "$WORK" "$OUT" "$BATCH" <<'PY'
import json, os, secrets, shutil, sys
atlas, work, out, batch = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
m = json.load(open(os.path.join(atlas, "manifest.json"), encoding="utf-8"))
req = [s for s in m["screens"] if s.get("required") and (s.get("image") or {}).get("light")]
key, ids = {}, set()
for s in req:
    while True:
        i = secrets.token_hex(2).upper()
        if i not in ids: ids.add(i); break
    key[i] = s["id"]
    shutil.copyfile(os.path.join(atlas, s["image"]["light"]), os.path.join(work, "img", i + ".png")) if os.path.isdir(os.path.join(work, "img")) else None
os.makedirs(os.path.join(work, "img"), exist_ok=True)
for i, sid in key.items():
    s = next(x for x in req if x["id"] == sid)
    shutil.copyfile(os.path.join(atlas, s["image"]["light"]), os.path.join(work, "img", i + ".png"))
order = sorted(key)  # 表示順は ID 順（manifest の順を漏らさない）
json.dump({"key": key, "order": order, "batch": batch}, open(os.path.join(out, "key.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
batches = [order[i:i + batch] for i in range(0, len(order), batch)]
prompt_head = """あなたは、デスクトップの AI アシスタント製品を初めて見る利用者です。この箱（カレントディレクトリ）にある画像だけを Read ツールで開いて答えてください。画像以外のファイルを開いてはいけません。開いた時点でこの採点は無効です。画像は ID（4 桁の英数字）で呼んでください。どの画像がどの製品のどの画面かは知らされていません。

## 手順（順番を守る）

1. **観察を先に書く。** 画像ごとに、読めた文字をそのまま 5〜12 個（visible_text）、いま何が起きているか、最も重要な情報、次にできること、説明のつかない空きや欠けているもの、を書く。画面に無い文字を書いた採点は無効になる。
2. 寸法は決めない（何 px かは書かない）。「揃っていない」「重なっている」「切れている」は絵から言ってよい。
3. そのあとで判定する。**"cannot tell" と NOT_ENOUGH_EVIDENCE は、推測より望ましい正解**。

## 判定（画像ごとに 1 つ）

- KEEP: この画面はそのまま出せる（世界の一線級のデスクトップ製品と並べて見劣りしない）
- FIX: 直すべき具体的な欠陥が**絵から**言える（何が・どこが・なぜ）。主観の好みだけなら FIX と言わない
- NOT_ENOUGH_EVIDENCE: 1 枚の静止画では判断できない（動き・音・前後の画面が要る）

評価軸: hierarchy / density / alignment / typography / contrast / state legibility / primary-action clarity / screen occupation / consistency / trust-provenance / error-recovery clarity。FIX のときは axis を必ず 1 つ以上書く。

## 出力（JSON だけ。前後に文を付けない）

{"pages": {"ID": {"visible_text": ["..."], "observation": {"happening": "...", "most_important": "...", "next_action": "...", "anomalies": ["..."]}, "verdict": "KEEP|FIX|NOT_ENOUGH_EVIDENCE", "concerns": [{"axis": "...", "what": "...", "where": "..."}], "confidence": "high|medium|low"}, ...}}

画像（この順で全部開く）:
"""
for n, b in enumerate(batches, 1):
    with open(os.path.join(work, f"prompt-{n:02d}.md"), "w", encoding="utf-8") as f:
        f.write(prompt_head + "\n".join(f"./{i}.png" for i in b) + "\n")
print(f"REVIEW_SANDBOX {len(order)} images, {len(batches)} batches of {batch}")
PY

# 2. judge を回す（箱は img/ だけ。prompt は箱の外から stdin で渡す）。
n=0; running=0
for p in "$WORK"/prompt-*.md; do
  n=$((n+1)); tag="$(printf '%02d' "$n")"
  # 試運転用: ASTRA_JUDGE_LIMIT_BATCHES=1 で最初の 1 組だけ回す（gate ではない）。
  if [[ -n "${ASTRA_JUDGE_LIMIT_BATCHES:-}" && $n -gt ${ASTRA_JUDGE_LIMIT_BATCHES} ]]; then break; fi
  # 3 model は互いに独立なので同時に回す（直列だと 33 回で 3 時間かかった）。
  # 組（batch）も ASTRA_JUDGE_PARALLEL 組まで同時に。judge は網の待ちが主で CPU をほぼ使わない。
  for model in $MODELS; do
    bash "$ROOT/scripts/ux-auto/judge.sh" "$model" "$WORK/img" "$p" "$OUT/judge-$tag-$model.json" &
  done
  running=$((running+1))
  if [[ $running -ge ${ASTRA_JUDGE_PARALLEL:-3} ]]; then wait; running=0; fi
done
wait

# 3. OCR で照合し、集計する。
python3 - "$ATLAS" "$OUT" "$WORK/img" "$OCR" "$RC" <<'PY'
import json, os, re, subprocess, sys, unicodedata, glob
atlas, out, imgdir, ocr_bin, rc = sys.argv[1:6]
key = json.load(open(os.path.join(out, "key.json"), encoding="utf-8"))["key"]
def norm(s): return re.sub(r"[\s　:：・…\.\-‐―]+", "", unicodedata.normalize("NFKC", s).lower())
ocr, ocr_tokens = {}, {}
from PIL import Image
import tempfile
for i in key:
    try:
        src = os.path.join(imgdir, i + ".png")
        # Dock の小さな面（高さ < 200px）は等倍だと OCR が「メモ」「字幕」を落とす（実測）。3 倍に拡大して読む。
        im = Image.open(src)
        if im.height < 200:
            tmp = os.path.join(tempfile.gettempdir(), f"atlas-ocr-{i}.png")
            im.resize((im.width * 3, im.height * 3), Image.LANCZOS).save(tmp); src = tmp
        txt = subprocess.run([ocr_bin, src], capture_output=True, text=True, timeout=60).stdout
        toks = [l.split("\t", 1)[1] for l in txt.splitlines() if "\t" in l]
        ocr[i] = norm("".join(toks)); ocr_tokens[i] = len(toks)
    except Exception:
        ocr[i] = ""; ocr_tokens[i] = 0
MIN_MATCH = 0.6
pages = {i: [] for i in key}       # id -> [(model, verdict, concerns, confidence, valid, why)]
for f in sorted(glob.glob(os.path.join(out, "judge-*.json"))):
    model = os.path.basename(f).split("-")[-1][:-5]
    j = json.load(open(f, encoding="utf-8"))
    for i, page in (j.get("pages") or {}).items():
        i = i.upper().replace(".PNG", "")
        if i not in pages: continue
        vt = [t for t in page.get("visible_text", []) if norm(t)]
        hit = sum(1 for t in vt if norm(t) in ocr.get(i, ""))
        ratio = hit / len(vt) if vt else 0
        # 画面の文字が 3 つも無い面（Idle の Dock 等）では、読めた分が全部合っていれば有効。
        need = min(3, max(1, ocr_tokens.get(i, 0)))
        valid = len(vt) >= need and ratio >= MIN_MATCH
        why = "" if valid else f"照合 {hit}/{len(vt)}（画面に無い文字）"
        pages[i].append((model, page.get("verdict", ""), page.get("concerns", []), page.get("confidence", ""), valid, why))
rows, fix, nee, keep = [], [], [], []
for i in sorted(key):
    sid = key[i]
    valid = [p for p in pages[i] if p[4]]
    verdicts = [p[1] for p in valid]
    if len(valid) < 2:
        v = "NOT_ENOUGH_EVIDENCE"; nee.append(sid)
    elif verdicts and all(x == "FIX" for x in verdicts):
        v = "FIX_CANDIDATE"; fix.append(sid)
    elif verdicts and all(x == "NOT_ENOUGH_EVIDENCE" for x in verdicts):
        v = "NOT_ENOUGH_EVIDENCE"; nee.append(sid)
    else:
        v = "KEEP"; keep.append(sid)
    rows.append({"id": sid, "blind_id": i, "verdict": v,
                 "judges": [{"model": m, "verdict": vv, "valid": ok, "why": why, "confidence": c, "concerns": cs}
                            for (m, vv, cs, c, ok, why) in pages[i]]})
result = {"rc": rc, "pages": rows, "summary": {"keep": len(keep), "fix_candidate": len(fix), "not_enough_evidence": len(nee),
          "models": sorted({p[0] for ps in pages.values() for p in ps})},
          "gate": "PASS" if not fix and not nee else "FAIL"}
json.dump(result, open(os.path.join(out, "review.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
lines = [f"# Blind pixel review — RC {rc}（judge: {', '.join(result['summary']['models'])}、人手 0）", "",
         f"KEEP {len(keep)} / FIX_CANDIDATE {len(fix)} / NOT_ENOUGH_EVIDENCE {len(nee)} → VISUAL_IDEAL_GATE={result['gate']}", "",
         "FIX_CANDIDATE は「有効な judge 全員が FIX」。deterministic evidence（寸法・AX・state truth）と突き合わせて初めて FIX にする。", "",
         "| id | verdict | judges（model:verdict、無効は ×） | concerns |", "|---|---|---|---|"]
for r in rows:
    js = " ".join(f"{j['model']}:{j['verdict'] or '-'}{'' if j['valid'] else '×'}" for j in r["judges"])
    cs = "; ".join(f"{c.get('axis','')}: {c.get('what','')}" for j in r["judges"] if j["valid"] for c in (j["concerns"] or [])[:2])[:300]
    lines.append(f"| `{r['id']}` | {r['verdict']} | {js} | {cs} |")
open(os.path.join(out, "review.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"VISUAL_IDEAL_GATE={result['gate']}  KEEP {len(keep)} FIX_CANDIDATE {len(fix)} NOT_ENOUGH_EVIDENCE {len(nee)} → {os.path.relpath(out)}")
PY
rm -f "$OUT"/*.raw.json "$OUT"/*.stderr
rm -rf "$WORK"
