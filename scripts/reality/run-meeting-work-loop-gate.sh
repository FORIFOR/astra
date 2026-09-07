#!/usr/bin/env bash
# MEETING_WORK_LOOP_GATE — 会議 → 決定 / やること → Work Graph → 次の brief / Home。人はクリックも判定もしない。
#
#   pnpm dev:infra && ./scripts/reality/run-meeting-work-loop-gate.sh
#
#   world-model meeting-loop.test.ts   安定 id、話者 / 時刻 / 文字起こし / 音源の出所、再 finalize で同じ id、brief と Home に効く
#   world-model work.db.test.ts        upsert（再 finalize でも件数が増えない、修正は同じ id の revision）
#   meeting service.db.test.ts         実 bundle（meeting.bundle）→ sink → 2 回で同じ id
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT="${ASTRA_ML_OUT:-/tmp/astra-meeting-loop-gate}"; mkdir -p "$OUT"
declare -a ROWS=(); fail=0
row() { ROWS+=("$1|$2|$3"); }
run() { local name="$1"; shift; "$@" >"$OUT/$name.log" 2>&1; echo $?; }
ok() { [ "$1" = 0 ] && echo PASS || { fail=1; echo FAIL; }; }
zero() { [ "$1" = 0 ] && echo 0 || { fail=1; echo FAIL; }; }
pure=$(run world-model pnpm --filter @astra/service-world-model exec vitest run test/meeting-loop.test.ts)
db=$(run world-db ./infra/db/with-test-db.sh pnpm --filter @astra/service-world-model exec vitest run test/work.db.test.ts)
mt=$(run meeting ./infra/db/with-test-db.sh pnpm --filter @astra/service-meeting exec vitest run test/service.db.test.ts)
row "real meeting bundle finalized" "$(ok "$mt")" "meeting.bundle が実 DB の segment から bundle を作り sink へ渡す"
row "decision → localArtifacts" "$(ok "$pure")" "meeting:<id>:decision:<segment> の artifact（kind decision）"
row "action → localArtifacts" "$(ok "$pure")" "meeting:<id>:action:<segment> の artifact（kind action_item、due / owner）"
row "stable id / duplicate" "$(zero "$db")" "同じ bundle を 2 度 ingest しても件数は増えない（upsert）"
row "recovery duplicate" "$(zero "$mt")" "meeting.bundle を 2 度走らせても同じ id"
row "speaker/timestamp provenance" "$([ "$pure" = 0 ] && echo 100% || { fail=1; echo FAIL; })" "origin.speaker / start_ms、provenance.excerpt に話者と発言"
row "audio/transcript source" "$([ "$pure" = 0 ] && echo 100% || { fail=1; echo FAIL; })" "origin.audio_artifact_id / transcript_artifact_id"
row "Live Notes edit = revision" "$(ok "$db")" "修正した文は同じ id で更新される（confirmed、confidence 1）"
row "Work Graph updated" "$(ok "$pure")" "buildWorkContext に会議由来の出所が載る"
row "next meeting brief sees decision" "$(ok "$pure")" "brief.previous に「決定: …」"
row "next meeting brief sees open action" "$(ok "$pure")" "brief.previous に「やること: …」+ 質問"
row "Home priority reflects action" "$(ok "$pure")" "やることの期限が priority の due_at に"
{
  echo "MEETING_WORK_LOOP_GATE $(date +%Y-%m-%dT%H:%M:%S%z) $(git rev-parse --short HEAD)"
  printf '%-36s %-8s %s\n' row result evidence
  for x in "${ROWS[@]}"; do IFS='|' read -r a b c <<<"$x"; printf '%-36s %-8s %s\n' "$a" "$b" "$c"; done
  echo "HUMAN_INTERVENTION=0"
  echo "MEETING_WORK_LOOP_GATE=$([ "$fail" = 0 ] && echo PASS || echo FAIL)"
} | tee "$OUT/report.txt"
exit "$fail"
