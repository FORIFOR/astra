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

# recall（keywords が 1 つの拾った文に全部入っていれば hit）
def recall(kind):
    items = [norm(d.get("text", "")) for d in res.get(kind, [])]
    hits = 0; miss = []
    for e in exp[kind]:
        if any(all(norm(k) in it for k in e["keywords"]) for it in items): hits += 1
        else: miss.append(e["label"])
    return hits, len(exp[kind]), miss
h, n, miss = recall("decisions"); row("decision recall", h == n, f"{h}/{n}" + (f" missing {miss}" if miss else ""))
h, n, miss = recall("actions");   row("action recall",   h == n, f"{h}/{n}" + (f" missing {miss}" if miss else ""))

row("pause leakage", res.get("pauseLeak", 99) <= exp["pause_leakage_max"], f"{res.get('pauseLeak')} rows arrived while paused")
row("resume works", res.get("resumeRows", 0) >= 0 and res.get("resumed") is True, f"resumed={res.get('resumed')} rows after resume={res.get('resumeRows')}")
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
