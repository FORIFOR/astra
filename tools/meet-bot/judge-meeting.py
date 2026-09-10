#!/usr/bin/env python3
"""REAL_MEETING の判定器。Astra が書いた result.json を fixture と突き合わせ、人を介さず PASS / FAIL を出す。

  python3 tools/meet-bot/judge-meeting.py tools/meet-bot/fixture.json <astra-out-dir>

result.json（--selftest realmeeting が書く）:
  {"liveId": "...", "transcript": [{"speaker","text","at"}], "decisions": [{"text","at","speaker"}],
   "actions": [...], "pauseLeak": 0, "libraryStatus": "ready", "persisted": {"transcript": n, "decisions": n, "actions": n},
   "timings": {...}, "mode": "audio|simulate", "detected": "Google Meet|forced"}
"""
import difflib, json, os, sys, unicodedata, re

fx = json.load(open(sys.argv[1], encoding="utf-8"))
out = sys.argv[2]
res = json.load(open(os.path.join(out, "result.json"), encoding="utf-8"))
exp = fx["expected"]

def norm(s): return re.sub(r"[\s　、。,.!！?？]+", "", unicodedata.normalize("NFKC", s)).lower()

rows = []
def row(name, ok, detail): rows.append((name, ok, detail))

# transcript similarity（台本全文 vs 認識全文）
want = norm("".join(l["text"] for l in fx["lines"]))
got = norm("".join(t["text"] for t in res.get("transcript", [])))
sim = difflib.SequenceMatcher(None, want, got).ratio() if got else 0.0
row("transcript similarity", sim >= exp["transcript_similarity_min"], f"{sim:.2f} (min {exp['transcript_similarity_min']})")

# recall: 抽出できたか（Astra が決定/行動を拾ったか）を見る。文字起こしの綴りは見ない。
#   - keyword は候補の list でよい（"macOS"→"MC OS" のような綴れの揺れを吸収）。
#   - 英語だけの keyword（例 "Windows"）は best-effort（optional）。ja-JP のオンデバイス STT は
#     日本語音声に混ざった英語の固有名詞を丸ごと落とすことがある（TTS 音声で実測: "Windows 版は"→欠落）。
#     判定は「その決定を、区別できる日本語の内容で拾えたか」。英語名の聞き取りは別の話。
#   - よって必須は「日本語を含む keyword」だけ。英語のみの keyword は在れば加点、無くても落とさない。
def has_jp(x):
    xs = x if isinstance(x, list) else [x]
    return any(any(ord(c) > 0x2E7F for c in a) for a in xs)  # かな/漢字/全角
def kw_hit(k, it):
    return any(norm(a) in it for a in (k if isinstance(k, list) else [k]))
def recall(kind):
    items = [norm(d.get("text", "")) for d in res.get(kind, [])]
    hits = 0; miss = []
    for e in exp[kind]:
        alternatives = e.get("must_any")
        if alternatives:
            matched = any(
                all(kw_hit(k, it) for k in alt)
                for alt in alternatives
                for it in items
            )
            if matched:
                hits += 1
            else:
                miss.append(e["label"])
            continue
        # 必須は must（無ければ後方互換で keywords の日本語のみ、それも無ければ全部）。
        required = e.get("must") or [k for k in e.get("keywords", []) if has_jp(k)] or e.get("keywords", [])
        if any(all(kw_hit(k, it) for k in required) for it in items): hits += 1
        else: miss.append(e["label"])
    return hits, len(exp[kind]), miss
h, n, miss = recall("decisions"); row("decision recall", h == n, f"{h}/{n}" + (f" missing {miss}" if miss else ""))
h, n, miss = recall("actions");   row("action recall",   h == n, f"{h}/{n}" + (f" missing {miss}" if miss else ""))

# 漏れ: 止まっている間に増えた行数と、止まっている間に流した声（paused_line）が transcript に無いこと。
paused = (fx.get("paused_line") or {}).get("text")
leaked_text = False
if paused:
    p = norm(paused)
    leaked_text = any(difflib.SequenceMatcher(None, p, norm(t.get("text", ""))).ratio() >= 0.5
                      for t in res.get("transcript", []))
row("pause leakage", res.get("pauseLeak", 99) <= exp["pause_leakage_max"] and not leaked_text,
    f"{res.get('pauseLeak')} rows arrived while paused; paused line in transcript={leaked_text}")
# 再開: audio では再開後の 2 発話が行になること（0 でも通る判定は何も見ていない）。
need = exp.get("resume_rows_min_audio", 1) if res.get("mode") == "audio" else 0
row("resume works", res.get("resumeRows", 0) >= need and res.get("resumed") is True,
    f"resumed={res.get('resumed')} rows after resume={res.get('resumeRows')} (min {need})")
row("Library persisted", res.get("libraryStatus") == "ready" and (res.get("persisted") or {}).get("transcript", 0) > 0,
    f"status={res.get('libraryStatus')} persisted={res.get('persisted')}")
tol = exp["source_jump_tolerance_s"]
ts = [t.get("at", -1) for t in res.get("transcript", [])]
bad = [d for d in res.get("decisions", []) if d.get("at") is None or not any(abs(d["at"] - a) <= tol for a in ts)]
row("Source jump timestamp", not bad, f"{len(bad)} decisions without a transcript row within {tol}s")
row("meeting detected", res.get("detected") not in (None, "", "none"), f"{res.get('detected')}")
row("speaker separation", len({t.get("speaker") for t in res.get("transcript", [])}) >= 1, f"speakers={sorted({t.get('speaker') for t in res.get('transcript', [])})}")

for name, ok, d in rows:
    print(f"  {'PASS' if ok else 'FAIL':<5} {name:<28} {d}")
mode = res.get("mode", "?")
allok = all(ok for _, ok, _ in rows)
print(f"REAL_MEETING_JUDGE={'PASS' if allok else 'FAIL'} mode={mode}")
sys.exit(0 if allok else 1)
