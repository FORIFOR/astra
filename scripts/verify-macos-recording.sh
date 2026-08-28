#!/usr/bin/env bash
# macOS の録音 E2E（Swift → astra-core → 実ディスク断片）。ライブ mic ではなく合成音源で
# 断片が実際に書かれ、回復候補に出ることを確かめる（headless で再現可能）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/astra-macos"
swift build >/dev/null
BIN="$(swift build --show-bin-path)/AstraMac"
OUT="$("$BIN" --selftest record)"
echo "$OUT"
[[ "$OUT" == SELFTEST_OK* ]] || { echo "FAIL: macOS recording E2E" >&2; exit 1; }
OUT2="$("$BIN" --selftest lifecycle)"
echo "$OUT2"
[[ "$OUT2" == SELFTEST_OK* ]] || { echo "FAIL: macOS lifecycle E2E" >&2; exit 1; }
OUT3="$("$BIN" --selftest shortcut)"
echo "$OUT3"
[[ "$OUT3" == SELFTEST_OK* ]] || { echo "FAIL: macOS global shortcut register" >&2; exit 1; }
OUT4="$("$BIN" --selftest sysaudio)"
echo "$OUT4"
[[ "$OUT4" == SELFTEST_OK* ]] || { echo "FAIL: macOS system-audio config" >&2; exit 1; }
OUT5="$("$BIN" --selftest calendar)"
echo "$OUT5"
[[ "$OUT5" == SELFTEST_OK* ]] || { echo "FAIL: macOS calendar status" >&2; exit 1; }
OUT6="$("$BIN" --selftest screen)"
echo "$OUT6"
[[ "$OUT6" == SELFTEST_OK* ]] || { echo "FAIL: macOS screen-context config" >&2; exit 1; }
OUT7="$("$BIN" --selftest rag)"
echo "$OUT7"
[[ "$OUT7" == SELFTEST_OK* ]] || { echo "FAIL: macOS RAG rank_context via core" >&2; exit 1; }
OUT8="$("$BIN" --selftest keychain)"
echo "$OUT8"
[[ "$OUT8" == SELFTEST_OK* ]] || { echo "FAIL: macOS keychain round-trip" >&2; exit 1; }
OUT9="$("$BIN" --selftest files)"
echo "$OUT9"
[[ "$OUT9" == SELFTEST_OK* ]] || { echo "FAIL: macOS file context via core rank" >&2; exit 1; }
OUT10="$("$BIN" --selftest ax)"
echo "$OUT10"
[[ "$OUT10" == SELFTEST_OK* ]] || { echo "FAIL: macOS accessibility context" >&2; exit 1; }
OUT11="$("$BIN" --selftest speech)"
echo "$OUT11"
[[ "$OUT11" == SELFTEST_OK* ]] || { echo "FAIL: macOS on-device STT (Apple Speech)" >&2; exit 1; }
OUT12="$("$BIN" --selftest connector)"
echo "$OUT12"
[[ "$OUT12" == SELFTEST_OK* ]] || { echo "FAIL: macOS connector contract via core" >&2; exit 1; }

# ---- live 実機経路（この環境は mic/screen/ax/speech が許可済み）。CI 等で未許可なら SELFTEST_SKIP。----
echo "$("$BIN" --selftest permissions)"
OUTS="$("$BIN" --selftest shape)"; echo "$OUTS"
[[ "$OUTS" == SELFTEST_OK* ]] || { echo "FAIL: macOS workspace shape != shared fixture" >&2; exit 1; }
OUTH="$("$BIN" --selftest hudlifecycle)"; echo "$OUTH"
[[ "$OUTH" == SELFTEST_OK* ]] || { echo "FAIL: macOS HUD lifecycle" >&2; exit 1; }
OUTPB="$("$BIN" --selftest panel)"; echo "$OUTPB"
[[ "$OUTPB" == SELFTEST_OK* ]] || { echo "FAIL: macOS panel Spaces/fullscreen behavior" >&2; exit 1; }
OUTRN="$("$BIN" --selftest render)"; echo "$OUTRN"
[[ "$OUTRN" == SELFTEST_OK* ]] || { echo "FAIL: macOS SwiftUI offscreen render" >&2; exit 1; }
OUTP="$("$BIN" --selftest pause)"; echo "$OUTP"
[[ "$OUTP" == SELFTEST_OK* ]] || { echo "FAIL: macOS pause actually stops recording" >&2; exit 1; }
OUTTM="$("$BIN" --selftest timer)"; echo "$OUTTM"
[[ "$OUTTM" == SELFTEST_OK* ]] || { echo "FAIL: macOS elapsed timer" >&2; exit 1; }
OUTA="$("$BIN" --selftest aiaction http://127.0.0.1:3000)"; echo "$OUTA"
[[ "$OUTA" == SELFTEST_OK* || "$OUTA" == SELFTEST_SKIP* ]] || { echo "FAIL: macOS AI action via Agent" >&2; exit 1; }
OUTT="$("$BIN" --selftest translate http://127.0.0.1:3000)"; echo "$OUTT"
[[ "$OUTT" == SELFTEST_OK* || "$OUTT" == SELFTEST_SKIP* ]] || { echo "FAIL: macOS translate via Agent" >&2; exit 1; }
OUTR="$("$BIN" --selftest recovery http://127.0.0.1:3000)"; echo "$OUTR"
[[ "$OUTR" == SELFTEST_OK* || "$OUTR" == SELFTEST_SKIP* ]] || { echo "FAIL: macOS crash recovery" >&2; exit 1; }
OUTCF="$("$BIN" --selftest connectorflow)"; echo "$OUTCF"
[[ "$OUTCF" == SELFTEST_OK* ]] || { echo "FAIL: macOS OAuth loopback flow" >&2; exit 1; }
OUTCS="$("$BIN" --selftest connectorstate)"; echo "$OUTCS"
[[ "$OUTCS" == SELFTEST_OK* ]] || { echo "FAIL: macOS connector state" >&2; exit 1; }
OUTCE="$("$BIN" --selftest connectorexchange)"; echo "$OUTCE"
[[ "$OUTCE" == SELFTEST_OK* ]] || { echo "FAIL: macOS connector exchange (mock token endpoint)" >&2; exit 1; }
OUTVA="$("$BIN" --selftest voiceask http://127.0.0.1:3000)"; echo "$OUTVA"
[[ "$OUTVA" == SELFTEST_OK* || "$OUTVA" == SELFTEST_SKIP* ]] || { echo "FAIL: macOS voice ask via Agent" >&2; exit 1; }
OUTRO="$("$BIN" --selftest recoveryoffline http://127.0.0.1:3000)"; echo "$OUTRO"
[[ "$OUTRO" == SELFTEST_OK* || "$OUTRO" == SELFTEST_SKIP* ]] || { echo "FAIL: macOS offline recovery" >&2; exit 1; }
OUTFL="$("$BIN" --selftest fulllifecycle http://127.0.0.1:3000)"; echo "$OUTFL"
[[ "$OUTFL" == SELFTEST_OK* || "$OUTFL" == SELFTEST_SKIP* ]] || { echo "FAIL: macOS full Voice HUD->Recording->save->HUD lifecycle" >&2; exit 1; }
# UI/UX テスト仕様 v1.0 の E2E-001（Product Reality Gate）。窓を実提示したまま一本で通し、
# HUD と Recording Workspace が同時に画面へ残らないことまで実測する。
OUTE2E="$("$BIN" --selftest e2e001 http://127.0.0.1:3000)"; echo "$OUTE2E"
[[ "$OUTE2E" == SELFTEST_OK* || "$OUTE2E" == SELFTEST_SKIP* ]] || { echo "FAIL: E2E-001 Product Reality Gate" >&2; exit 1; }
# Visual Gate: 8 主要画面を実アプリで撮り、geometry まで検査する（窓が在るだけでは PASS にしない）。
OUTSHOTS="$("$BIN" --selftest shots "${ASTRA_SHOTS_DIR:-/tmp/astra-shots}")"; echo "$OUTSHOTS" | tail -1
[[ "$OUTSHOTS" == *SELFTEST_OK* || "$OUTSHOTS" == *SELFTEST_SKIP* ]] || { echo "FAIL: Visual Gate (8 screens)" >&2; exit 1; }

for t in screenshot waveform livemic livemeeting livescreen sttrecognize sttstream guishot axtree breakpoints dictation; do
  OUT="$("$BIN" --selftest "$t")"
  echo "$OUT"
  [[ "$OUT" == SELFTEST_OK* || "$OUT" == SELFTEST_SKIP* ]] || { echo "FAIL: macOS live $t" >&2; exit 1; }
done
