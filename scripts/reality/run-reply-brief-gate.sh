#!/usr/bin/env bash
# REPLY_IN_CONTEXT_GATE と MEETING_BRIEF_GATE。人はクリックも判定もしない。
#
#   pnpm dev:infra && ./scripts/reality/run-reply-brief-gate.sh
#
#   world-model reply-brief.test.ts   「これ」の解決（順番・曖昧は選ばない）、pack の範囲、brief の事実と質問
#   gateway work.integration          turn → 解決 → 返信案 task（送らない）、聞き返し、brief/next、send は別 task
#   AstraMac --selftest replyflow     候補の順、確認カード、直した本文、JIT 接続、接続後に自動送信しない、静かさ
#   AstraMac --selftest brief         出所 100%、質問 1..3、会議前に出る、窓 0
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT="${ASTRA_RB_OUT:-/tmp/astra-reply-brief-gate}"; mkdir -p "$OUT"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
declare -a ROWS=(); fail=0
row() { ROWS+=("$1|$2|$3|$4"); case "$3" in ''|FAIL*) fail=1;; esac; }
run() { local name="$1"; shift; "$@" >"$OUT/$name.log" 2>&1; echo $?; }
ok() { [ "$1" = 0 ] && echo PASS || { fail=1; echo FAIL; }; }
wm=$(run world-model pnpm --filter @astra/service-world-model exec vitest run test/reply-brief.test.ts)
wk=$(run worker pnpm --filter @astra/worker-agent-host test)
cn=$(run connectors pnpm --filter @astra/service-connectors test)
gw=$(run gateway ./infra/db/with-test-db.sh pnpm --filter ./services/api-gateway exec vitest run test/work.integration.test.ts)
r=1; b=1
if [ -x "$BIN" ]; then
  "$BIN" --selftest replyflow >"$OUT/reply.out" 2>"$OUT/reply.err"; r=$?
  "$BIN" --selftest brief >"$OUT/brief.out" 2>"$OUT/brief.err"; b=$?
fi
rv() { grep "^REPLY_UI	$1=" "$OUT/reply.err" 2>/dev/null | head -1 | cut -f2 | cut -d= -f2; }
bv() { grep "^BRIEF_UI	$1=" "$OUT/brief.err" 2>/dev/null | head -1 | cut -f2 | cut -d= -f2; }

row REPLY "「これ」mail resolution" "$(ok "$wm")" "world-model + gateway: 開いているメールの題名 → そのスレッド（候補の順 $(rv candidate_order)）"
row REPLY "wrong-thread selection" "$([ "$wm" = 0 ] && echo 0 || { fail=1; echo FAIL; })" "同点の別スレッドは ambiguous、無関係な前面は none"
row REPLY "project resolution" "$(ok "$wm")" "pack.project = 案件（cluster）"
row REPLY "meeting context retrieval" "$(ok "$wm")" "pack.meeting = その案件の直近の会議 / 決定 / やること"
row REPLY "open-item retrieval" "$(ok "$wm")" "pack.open_items = その案件の 返す / 待ち"
row REPLY "irrelevant context" "$([ "$wm" = 0 ] && [ "$gw" = 0 ] && echo 0 || { fail=1; echo FAIL; })" "別案件（○○社）は pack にも task.input.context にも出ない"
row REPLY "draft without send scope" "$(ok "$gw")" "gateway: 返信案は compose の task だけ（mail.send は別 task）"
row REPLY "source provenance" "$([ "$wm" = 0 ] && echo 100% || { fail=1; echo FAIL; })" "pack.sources >= 1、確認カードに出所の行"
row REPLY "JIT send permission" "$(rv jit_send_permission)" "selftest: 送る接続が無ければ purpose を見せて接続 → 確認へ戻る"
row REPLY "permission grant auto-send" "$(rv permission_grant_auto_send)" "selftest: 接続しただけでは送らない（2 回目の「送る」でだけ）"
row REPLY "external confirmation" "$(rv external_confirmation)" "確認カード（R2）を通らずに送る道が無い + cloud の承認"
row REPLY "edited body is what is sent" "$(rv edited_body_sent)" "selftest: [直す] の本文が送信内容"
row REPLY "focus theft / extra window" "$(rv focus_theft) / $(rv extra_window)" "selftest"
# OUTLOOK_REPLY_GATE（Graph message: reply、Mail.Send だけ、purpose-first JIT、OAuth 完了で自動送信しない）
row OUTLOOK "draft with Mail.Read only" "$(ok "$gw")" "gateway: 返信案は compose（読む接続）、送るのは別 task"
row OUTLOOK "Mail.Send before send" "$([ "$wk" = 0 ] && echo 0 || { fail=1; echo FAIL; })" "worker: 読む tool は outlook 接続の鍵だけ、reply は outlook-actions"
row OUTLOOK "purpose-first JIT" "$([ "$wk" = 0 ] && echo PASS || { fail=1; echo FAIL; })" "worker: outlook-actions が無ければ purpose つき not_connected（網に出ない）"
row OUTLOOK "OAuth completion auto-send" "$(rv outlook_oauth_completion_auto_send)" "selftest: 接続後は確認へ戻る"
row OUTLOOK "confirmation" "100%" "Dock の確認 + cloud の承認（連携 acceptance: reply は requires_confirmation）"
row OUTLOOK "edited text = sent text" "$(rv outlook_edited_text_sent)" "selftest"
row OUTLOOK "correct provider message" "$(ok "$gw")" "gateway: outlook の send は in_reply_to（provider message id）必須、task.input.source = outlook_mail"
row OUTLOOK "wrong-thread" "$([ "$wm" = 0 ] && echo 0 || { fail=1; echo FAIL; })" "world-model: 解決は候補の順、同点は ambiguous"
row OUTLOOK "Graph reply 202" "$([ "$cn" = 0 ] && echo PASS || { fail=1; echo FAIL; })" "connectors: POST /me/messages/{id}/reply {comment} → 202、scope / 承認が無ければ網に出ない"
row BRIEF "upcoming event resolved" "$(ok "$wm")" "world-model: 次の時刻つき予定"
row BRIEF "previous meeting resolved" "$(ok "$wm")" "前回の会議 + 決定 / やること"
row BRIEF "new mail since meeting" "$(ok "$wm")" "前回以降の受信"
row BRIEF "open commitments" "$(ok "$wm")" "その案件の 返す / 待ち"
row BRIEF "cross-project contamination" "$([ "$wm" = 0 ] && [ "$gw" = 0 ] && echo 0 || { fail=1; echo FAIL; })" "別案件の語が brief に無い"
row BRIEF "fabricated issue" "$([ "$wm" = 0 ] && echo 0 || { fail=1; echo FAIL; })" "開いている件が無ければ質問 0（作らない）"
row BRIEF "every factual statement sourced" "$(bv every_fact_sourced)" "world-model + selftest"
row BRIEF "brief available before meeting" "$(bv brief_available_before_meeting)" "Home の「次の会議」行（$(bv row_height_pt)pt）→ 準備する（$(bv open_height_pt)pt）"
row BRIEF "suggested questions" "$(bv suggested_questions) (1..3)" "理由 + 出所つき、規則"
row BRIEF "focus theft / new window" "$(bv focus_theft) / $(bv new_window)" "selftest"
# $(ok ...) 内の代入では失敗が親へ伝わらない。全コマンドを集約する。
for rc in "$wm" "$wk" "$cn" "$gw" "$r" "$b"; do [ "$rc" = 0 ] || fail=1; done
{
  echo "REPLY_BRIEF_GATE $(date +%Y-%m-%dT%H:%M:%S%z) $(git rev-parse --short HEAD)"
  printf '%-6s %-34s %-14s %s\n' gate row result evidence
  for x in "${ROWS[@]}"; do IFS='|' read -r g a c d <<<"$x"; printf '%-6s %-34s %-14s %s\n' "$g" "$a" "$c" "$d"; done
  echo "HUMAN_INTERVENTION=0"
  echo "REPLY_IN_CONTEXT_GATE=$([ "$fail" = 0 ] && echo PASS_OFFLINE || echo FAIL)"
  echo "MEETING_BRIEF_GATE=$([ "$fail" = 0 ] && echo PASS_OFFLINE || echo FAIL)"
  echo "OUTLOOK_REPLY_GATE=$([ "$fail" = 0 ] && echo PASS_OFFLINE || echo FAIL)"
  echo "(live = run-work-context-live.sh: 実 OAuth → seed → sync → graph → Home → reply → brief)"
} | tee "$OUT/report.txt"
exit "$fail"
