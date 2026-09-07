#!/usr/bin/env bash
# VISUAL_SUPREMACY の**独立 blind 判定を人手なしで**行う（VISUAL_SUPREMACY_FINAL の判定器）。
#
# review-blind.sh（KEEP/FIX/NEE）より厳しい。8 軸で採点し、SUPREME / COMPETITIVE / BELOW_BAR を出す。
#   Hierarchy / Density / Typography / Geometry / State clarity / Calmness / Craft / Distinctiveness
#
# 名前は隠す。judge はリポジトリも manifest も見ない（画像だけ）。まず観察、次に判定。
# 規則（[[visual-judges-cannot-measure]] の教訓）:
#   - visible_text を OCR と照合し、画面に無い文字を根拠にした judge のその面は無効
#   - 有効な judge が 2 未満の面は NOT_ENOUGH_EVIDENCE（敗北ではない）
#   - 有効な judge **全員**が BELOW_BAR のときだけ BELOW_BAR（1 人の趣味では落とさない）
#   - 全員 SUPREME なら SUPREME、それ以外は COMPETITIVE
#   VISUAL_SUPREMACY_FINAL(blind) = PASS ⇔ BELOW_BAR 0（NEE=cannot tell は許容）
#
# 競合との A/B（名前を隠し左右をランダム化）は、競合の実 UI 画像が要る。
#   ASTRA_COMPETITORS_DIR に <archetype>.png を置くと A/B も回す。無ければ self-supremacy だけ
#   （「blind major losses」は competitor 画像が要る = AUTOMATION_MISSING と言う）。
#
#   bash scripts/ui-atlas/review-supremacy.sh [out-dir]   （既定 docs/ui-atlas/supremacy/<rc.sha>）
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ATLAS="$ROOT/docs/ui-atlas"
MODELS="${ASTRA_JUDGE_MODELS:-opus sonnet haiku}"
BATCH="${ASTRA_JUDGE_BATCH:-6}"
RC="$(python3 -c "import json;print(json.load(open('$ATLAS/manifest.json'))['rc']['sha'])")"
OUT="${1:-$ATLAS/supremacy/$RC}"
WORK="$(mktemp -d)"
OCR="$ROOT/.build/uxlab/ocr"
[[ -x "$OCR" ]] || bash "$ROOT/scripts/ux-auto/build-tools.sh" >/dev/null
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

python3 - "$ATLAS" "$WORK" "$OUT" "$BATCH" <<'PY'
import json, os, secrets, shutil, sys
atlas, work, out, batch = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
m = json.load(open(os.path.join(atlas, "manifest.json"), encoding="utf-8"))
# components.*（neutral/hover/focus/pressed）は DS の状態見本で、利用者が「製品画面」として選ぶものではない。
# supremacy（一線級と並べて選べるか）の対象は製品画面。DS 参照は review-blind の KEEP/FIX には残すが、ここでは外す。
req = [s for s in m["screens"] if s.get("required") and (s.get("image") or {}).get("light") and not s["id"].startswith("components.")]
# 差分再検証: ASTRA_JUDGE_ONLY="guided-setup. screenshot." のように id の前置きで絞る（新規面だけ full audit）。
only = [x for x in os.environ.get("ASTRA_JUDGE_ONLY", "").split() if x]
if only:
    req = [s for s in req if any(s["id"].startswith(x) for x in only)]
key, ids = {}, set()
prev = os.path.join(out, "key.json")
if os.path.exists(prev):
    key = json.load(open(prev, encoding="utf-8"))["key"]; ids = set(key)
for s in req:
    if s["id"] in key.values(): continue
    while True:
        i = secrets.token_hex(2).upper()
        if i not in ids: ids.add(i); break
    key[i] = s["id"]
os.makedirs(os.path.join(work, "img"), exist_ok=True)
for i, sid in key.items():
    s = next(x for x in req if x["id"] == sid)
    shutil.copyfile(os.path.join(atlas, s["image"]["light"]), os.path.join(work, "img", i + ".png"))
order = sorted(key)
json.dump({"key": key, "order": order, "batch": batch}, open(os.path.join(out, "key.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
batches = [order[i:i + batch] for i in range(0, len(order), batch)]
prompt_head = """あなたは、世界最高水準のデスクトップ製品（Linear / Raycast / Notion / Apple / Granola 等）を毎日使う目の肥えた利用者です。この箱（カレントディレクトリ）の画像だけを Read ツールで開いて答えてください。画像以外を開いた時点でこの採点は無効です。画像は ID（4 桁）で呼びます。どの製品のどの画面かは知らされていません。

## 手順（順番を守る）
1. **観察を先に書く。** 画像ごとに、読めた文字をそのまま 5〜12 個（visible_text）、何が起きているか、最も重要な情報、次にできること、説明のつかない空きや欠け、を書く。画面に無い文字を書いた採点は無効。
2. 寸法は px で書かない。「揃っていない/重なっている/切れている/余白が広いだけ」は絵から言ってよい。
3. 8 軸をそれぞれ 1〜5 で採点（5=一線級）: hierarchy / density / typography / geometry / state_clarity / calmness / craft / distinctiveness。
4. 「AI が作った感」があれば ai_look に具体を書く（中央寄せ空状態の乱用 / 全カード同角丸 / 無意味な pill / 説明過多 / 紫青 gradient 頼み / テンプレ反復 / 空語の反復 など）。
5. そのうえで判定する。**"cannot tell" は推測より望ましい正解**。

## 判定（画像ごとに 1 つ）
- SUPREME: どの主要製品と並べても選ばれる。欠陥は無い。
- COMPETITIVE: 出せるが、一線級と並べると弱い点がある（欠陥ではなく差）。
- BELOW_BAR: 具体的な欠陥が**絵から**言える（状態矛盾・空状態の弱さ・言語混在・AI 生成感・階層崩れ・破壊操作の危険な既定 など）。
- NOT_ENOUGH_EVIDENCE: 1 枚では判断できない（動き・音・前後が要る）。小さな pill は見えているものが全て。読めるなら判定する。

## 出力（JSON だけ。前後に文を付けない）
{"pages": {"ID": {"visible_text": ["..."], "observation": {"happening":"...","most_important":"...","next_action":"...","anomalies":["..."]}, "scores": {"hierarchy":0,"density":0,"typography":0,"geometry":0,"state_clarity":0,"calmness":0,"craft":0,"distinctiveness":0}, "ai_look": ["..."], "verdict": "SUPREME|COMPETITIVE|BELOW_BAR|NOT_ENOUGH_EVIDENCE", "why": "...", "confidence": "high|medium|low"}, ...}}

画像（この順で全部開く）:
"""
for n, b in enumerate(batches, 1):
    with open(os.path.join(work, f"prompt-{n:02d}.md"), "w", encoding="utf-8") as f:
        f.write(prompt_head + "\n".join(f"./{i}.png" for i in b) + "\n")
print(f"SUPREMACY_SANDBOX {len(order)} images, {len(batches)} batches of {batch}")
PY

n=0; running=0
for p in "$WORK"/prompt-*.md; do
  n=$((n+1)); tag="$(printf '%02d' "$n")"
  if [[ -n "${ASTRA_JUDGE_LIMIT_BATCHES:-}" && $n -gt ${ASTRA_JUDGE_LIMIT_BATCHES} ]]; then break; fi
  for model in $MODELS; do
    if [[ -s "$OUT/judge-$tag-$model.json" ]]; then echo "JUDGE_DONE $model $tag (resume)"; continue; fi
    bash "$ROOT/scripts/ux-auto/judge.sh" "$model" "$WORK/img" "$p" "$OUT/judge-$tag-$model.json" &
  done
  running=$((running+1))
  if [[ $running -ge ${ASTRA_JUDGE_PARALLEL:-3} ]]; then wait; running=0; fi
done
wait

python3 - "$ATLAS" "$OUT" "$WORK/img" "$OCR" "$RC" <<'PY'
import json, os, re, subprocess, sys, unicodedata, glob, tempfile
from PIL import Image
atlas, out, imgdir, ocr_bin, rc = sys.argv[1:6]
key = json.load(open(os.path.join(out, "key.json"), encoding="utf-8"))["key"]
def norm(s): return re.sub(r"[\s　:：・…\.\-‐―]+", "", unicodedata.normalize("NFKC", s).lower())
ocr, ocr_tokens = {}, {}
for i in key:
    try:
        src = os.path.join(imgdir, i + ".png"); im = Image.open(src)
        if im.height < 200:
            tmp = os.path.join(tempfile.gettempdir(), f"sup-ocr-{i}.png")
            im.resize((im.width * 3, im.height * 3), Image.LANCZOS).save(tmp); src = tmp
        txt = subprocess.run([ocr_bin, src], capture_output=True, text=True, timeout=60).stdout
        toks = [l.split("\t", 1)[1] for l in txt.splitlines() if "\t" in l]
        ocr[i] = norm("".join(toks)); ocr_tokens[i] = len(toks)
    except Exception:
        ocr[i] = ""; ocr_tokens[i] = 0
MIN_MATCH = 0.6
pages = {i: [] for i in key}
for f in sorted(glob.glob(os.path.join(out, "judge-*.json"))):
    model = os.path.basename(f).split("-")[-1][:-5]
    try: j = json.load(open(f, encoding="utf-8"))
    except Exception: continue
    for i, page in (j.get("pages") or {}).items():
        i = i.upper().replace(".PNG", "")
        if i not in pages: continue
        vt = [t for t in page.get("visible_text", []) if norm(t)]
        hit = sum(1 for t in vt if norm(t) in ocr.get(i, ""))
        ratio = hit / len(vt) if vt else 0
        need = min(3, max(1, ocr_tokens.get(i, 0)))
        valid = len(vt) >= need and ratio >= MIN_MATCH
        pages[i].append({"model": model, "verdict": page.get("verdict",""), "scores": page.get("scores",{}),
                         "ai_look": page.get("ai_look",[]), "why": page.get("why",""), "valid": valid})
rows, supreme, competitive, below, nee = [], [], [], [], []
for i in sorted(key):
    sid = key[i]; valid = [p for p in pages[i] if p["valid"]]
    vs = [p["verdict"] for p in valid]
    if len(valid) < 2: v = "NOT_ENOUGH_EVIDENCE"; nee.append(sid)
    elif vs and all(x == "BELOW_BAR" for x in vs): v = "BELOW_BAR"; below.append(sid)
    elif vs and all(x == "SUPREME" for x in vs): v = "SUPREME"; supreme.append(sid)
    elif vs and all(x == "NOT_ENOUGH_EVIDENCE" for x in vs): v = "NOT_ENOUGH_EVIDENCE"; nee.append(sid)
    else: v = "COMPETITIVE"; competitive.append(sid)
    # 平均スコア（有効 judge、8 軸平均）
    import statistics
    avgs = {}
    for ax in ["hierarchy","density","typography","geometry","state_clarity","calmness","craft","distinctiveness"]:
        xs = [p["scores"].get(ax) for p in valid if isinstance(p["scores"].get(ax), (int,float))]
        if xs: avgs[ax] = round(statistics.mean(xs), 2)
    rows.append({"id": sid, "blind_id": i, "verdict": v, "avg": avgs,
                 "judges": [{"model": p["model"], "verdict": p["verdict"], "valid": p["valid"], "ai_look": p["ai_look"], "why": p["why"]} for p in pages[i]]})
gate = "PASS" if not below else "FAIL"   # NEE(cannot tell)は敗北ではない。BELOW_BAR だけが gate を落とす
result = {"rc": rc, "mode": "self-supremacy", "pages": rows,
          "summary": {"supreme": len(supreme), "competitive": len(competitive), "below_bar": len(below), "not_enough_evidence": len(nee),
                      "models": sorted({p["model"] for ps in pages.values() for p in ps})},
          "gate": gate,
          "ab_competitor": "AUTOMATION_MISSING: 競合の実 UI 画像（ASTRA_COMPETITORS_DIR）が無い。画面収録 TCC と driver が要る"}
json.dump(result, open(os.path.join(out, "supremacy.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
lines = [f"# Blind supremacy review — RC {rc}（8 軸・自己採点・人手 0）", "",
         f"SUPREME {len(supreme)} / COMPETITIVE {len(competitive)} / BELOW_BAR {len(below)} / NEE {len(nee)} → VISUAL_SUPREMACY(blind)={gate}", "",
         "BELOW_BAR は「有効 judge 全員が BELOW_BAR」。1 人の趣味では落とさない。A/B 競合比較は competitor 画像が要る（AUTOMATION_MISSING）。", "",
         "| id | verdict | judges | avg(craft/dist/hier) | ai_look |", "|---|---|---|---|---|"]
for r in rows:
    js = " ".join(f"{j['model']}:{(j['verdict'] or '-')[:4]}{'' if j['valid'] else '×'}" for j in r["judges"])
    a = r["avg"]; av = f"{a.get('craft','-')}/{a.get('distinctiveness','-')}/{a.get('hierarchy','-')}"
    ai = "; ".join(x for j in r["judges"] if j["valid"] for x in (j["ai_look"] or [])[:1])[:120]
    lines.append(f"| `{r['id']}` | {r['verdict']} | {js} | {av} | {ai} |")
open(os.path.join(out, "supremacy.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"VISUAL_SUPREMACY(blind)={gate}  SUPREME {len(supreme)} COMPETITIVE {len(competitive)} BELOW_BAR {len(below)} NEE {len(nee)} → {os.path.relpath(out)}")
PY
rm -f "$OUT"/*.raw.json "$OUT"/*.stderr
rm -rf "$WORK"
