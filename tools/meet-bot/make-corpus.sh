#!/usr/bin/env bash
# fixture.json の台本を、毎回同じ声で WAV にする（人は喋らない）。
#   bash tools/meet-bot/make-corpus.sh <out-dir>
# 出力: <out>/NN-<speaker>.wav（16kHz mono）と lines.tsv（speaker \t text \t wav）
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?out dir}"
mkdir -p "$OUT"
python3 - "$HERE/fixture.json" "$OUT" <<'PY'
import json, subprocess, sys, os
fx, out = sys.argv[1], sys.argv[2]
lines = json.load(open(fx, encoding="utf-8"))["lines"]
tsv = []
for n, l in enumerate(lines, 1):
    aiff = os.path.join(out, f"{n:02d}-{l['speaker']}.aiff"); wav = aiff[:-5] + ".wav"
    subprocess.run(["say", "-v", l["voice"], "-o", aiff, l["text"]], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav], check=True)
    os.remove(aiff)
    tsv.append(f"{l['speaker']}\t{l['text']}\t{os.path.basename(wav)}")
open(os.path.join(out, "lines.tsv"), "w", encoding="utf-8").write("\n".join(tsv) + "\n")
print(f"CORPUS_OK {len(lines)} lines → {out}")
PY
