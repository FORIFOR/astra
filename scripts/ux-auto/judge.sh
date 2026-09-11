#!/usr/bin/env bash
# 盲検の vision judge を**人手なしで**起こす（HUMAN_INTERVENTION=0）。
#
# 以前は「新規の subagent に prompt と画像を渡す」を人（セッション）がやっていた。
# ここは同じ規約を `claude -p` で機械的に回す: judge は画像だけの箱（sandbox）の中で
# Read ツールだけを許され、リポジトリのファイルは開けない（cwd が箱、許可は Read のみ）。
# 出力は JSON だけ。前後の ``` を剥がして保存する。
#
#   bash scripts/ux-auto/judge.sh <model> <sandbox-dir> <prompt-file> <out.json>
#   model: opus | sonnet | haiku（claude CLI の --model）
set -uo pipefail
MODEL="${1:?model}"; SANDBOX="${2:?sandbox dir}"; PROMPT="${3:?prompt file}"; OUT="${4:?out json}"
[[ -d "$SANDBOX" ]] || { echo "FAIL: sandbox が無い: $SANDBOX" >&2; exit 1; }
[[ -f "$PROMPT" ]] || { echo "FAIL: prompt が無い: $PROMPT" >&2; exit 1; }
command -v claude >/dev/null || { echo "AUTOMATION_MISSING: claude CLI が無い" >&2; exit 2; }
mkdir -p "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"   # 箱へ cd するので絶対パスに
PROMPT="$(cd "$(dirname "$PROMPT")" && pwd)/$(basename "$PROMPT")"
RAW="$OUT.raw.json"
# 箱の外を見せない。cwd を箱にし、許すのは Read だけ。prompt は stdin で渡す（引数長の上限を避ける）。
# JSON が壊れて返ることがある（実測: haiku が途中で切れた）。壊れていたら 1 回だけ呼び直す。
for attempt in 1 2; do
  ( cd "$SANDBOX" && claude -p --model "$MODEL" --allowedTools "Read" --output-format json \
      < "$PROMPT" > "$RAW" 2>"$OUT.stderr" ) || { echo "FAIL: judge($MODEL) が落ちた: $(tail -2 "$OUT.stderr" | tr '\n' ' ')" >&2; continue; }
  if python3 - "$RAW" "$OUT" "$MODEL" <<'PY'
import json, re, sys
raw, out, model = sys.argv[1:4]
d = json.load(open(raw, encoding="utf-8"))
text = d.get("result", "") if isinstance(d, dict) else str(d)
m = re.search(r"\{.*\}", text, re.S)
if not m:
    print(f"FAIL: judge({model}) が JSON を返さなかった: {text[:200]!r}"); sys.exit(1)
try:
    j = json.loads(m.group(0))
except Exception as e:
    print(f"FAIL: judge({model}) の JSON が壊れている: {e}"); sys.exit(1)
j["_judge"] = {"model": model, "cost_usd": d.get("total_cost_usd"), "turns": d.get("num_turns"),
               "duration_ms": d.get("duration_ms")}
json.dump(j, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"JUDGE_OK {model} → {out} (${d.get('total_cost_usd', 0):.3f}, {d.get('num_turns')} turns)")
PY
  then exit 0; fi
  echo "  retry judge($MODEL) attempt $attempt failed" >&2
done
exit 1
