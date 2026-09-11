#!/usr/bin/env bash
# PRIVACY_EGRESS_GATE — 端末から出る道が、既定で閉じているか（docs/privacy-egress.md）。
#
# 「録音した音声・文字起こし・鍵はこの Mac の中だけで扱われ、あなたが確認して実行したものだけが
# 外に出ます」（ガイドの footer）を、機械で守る。2026-09-04 に 2 つの例外が見つかった:
#   - ja-JP のオンデバイス資産が無い Mac では Apple のサーバ認識に黙って落ちていた
#   - gateway が到達可能なだけで会議を作り、停止時に音声全体を送っていた
# ここは**静的**に道を数える。実行体での確認は `--selftest egress`（既定 OFF・資産無しロケールで throw）。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apps/astra-macos/Sources/AstraMac"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
fail=0
row() { printf "  %-40s %s\n" "$1" "$2"; }
bad() { row "$1" "$2"; shift 2; printf "    %s\n" "$@" >&2; fail=1; }

# 本番の Swift（selftest を除く）
prod() { grep -rn "$@" "$SRC" --include='*.swift' | grep -v "App/SelfTest.swift" | grep -vE '^[^:]+:[0-9]+:\s*//'; }

echo "== PRIVACY_EGRESS_GATE =="

# 1. 録音の upload は、明示的な Google STT 同意の外では 0。
#    - 音声を送る関数は RecordingRuntime だけが呼ぶ
#    - cloudTranscriptionAllowed が true のときだけ会議作成・送信・回復を行う
up=$(prod "uploadMeetingAudio(" | grep -v "RecordingWorkspace/RecordingRuntime.swift\|RecordingWorkspace/AstraCoreBridge.swift" || true)
flag=$(awk '/static var devAutoUploadEnabled/,/^    }/' "$SRC/RecordingWorkspace/RecordingRuntime.swift")
flag_ok=1
grep -q "#if DEBUG" <<<"$flag" || flag_ok=0
grep -A2 "#else" <<<"$flag" | grep -q "return false" || flag_ok=0
cloud_gate=$(python3 - "$SRC" <<'CHECK'
import pathlib, sys, re
src=pathlib.Path(sys.argv[1])
r=(src/'RecordingWorkspace/RecordingRuntime.swift').read_text()
c=(src/'RecordingWorkspace/CloudMeetingTranscription.swift').read_text()
l=(src/'Audio/GoogleLiveTranscriber.swift').read_text()
m=(src/'Main/MainWindowView.swift').read_text()
checks = [
 'stored as? Bool ?? developmentUpload' in r,
 'cloudConsentValue(UserDefaults.standard.object(forKey: cloudTranscriptionDefaultsKey),' in r,
 'developmentUpload: devAutoUploadEnabled)' in r,
 'cloudRequestedForRecording = Self.cloudTranscriptionAllowed' in r,
 'if transcribe, cloudRequestedForRecording { startGoogleLive() }' in r,
 'guard RecordingRuntime.cloudTranscriptionAllowed else' in l,
 'try await ws.send(.data(Data(bytes)))' in l,
 'CloudMeetingTranscription.finalize' not in r[r.index('    func end('):r.index('    func retryCloudTranscription')],
 'guard RecordingRuntime.cloudTranscriptionAllowed else' in c,
 bool(re.search(r'try consent\(\)\s+try await socket.send\(\.data', c)),
 'if RecordingRuntime.devAutoUploadEnabled {' in m,
 'if RecordingRuntime.cloudTranscriptionAllowed {\n                        let recovered' not in m,
]
if all(checks): print('guarded')
CHECK
)
if [ -z "$up" ] && [ -n "$cloud_gate" ] && [ $flag_ok -eq 1 ]; then
  row "recording upload requires explicit cloud consent" "PASS"
else
  bad "recording upload requires explicit cloud consent" "FAIL" \
    "${up:+upload を RecordingRuntime の外で呼んでいる: $up}" \
    "$([ -n "$cloud_gate" ] || echo 'cloudTranscriptionAllowed の gate が無い')" \
    "$([ $flag_ok -eq 1 ] || echo 'devAutoUploadEnabled が #if DEBUG / #else false になっていない')"
fi

# 2. Apple STT のサーバ fallback は 0。
#    requiresOnDeviceRecognition は SpeechTranscriber.swift の中で、必ず `= true`。
#    認識 request を組むのも SpeechTranscriber.swift だけ。
stt="$SRC/Audio/SpeechTranscriber.swift"
req_elsewhere=$(prod "requiresOnDeviceRecognition\|SFSpeech.*RecognitionRequest(" | grep -v "Audio/SpeechTranscriber.swift" || true)
req_not_true=$(grep -n "requiresOnDeviceRecognition *=" "$stt" | grep -vE '^[0-9]+:\s*//' | grep -v "requiresOnDeviceRecognition = true" || true)
if [ -z "$req_elsewhere" ] && [ -z "$req_not_true" ] && grep -q "requiresOnDeviceRecognition = true" "$stt"; then
  row "silent Apple STT fallback" "0"
else
  bad "silent Apple STT fallback" "FAIL" \
    "${req_elsewhere:+SpeechTranscriber の外で認識 request を組んでいる: $req_elsewhere}" \
    "${req_not_true:+requiresOnDeviceRecognition が true 以外: $req_not_true}"
fi

# 3. マイクだけの録音では画面収録を求めず、「画面の音」の選択と同じ条件で求める。
pc="$SRC/Settings/PermissionCenter.swift"
workspace="$SRC/RecordingWorkspace/RecordingWorkspaceState.swift"
if grep -q 'case .meeting: return \[.microphone, .speechRecognition\]$' "$pc" \
  && grep -q 'case .meetingAudio: return \[.screenRecording\]$' "$pc" \
  && grep -q 'if screenAudio && requestPermissions { PermissionCenter.request(.meetingAudio) }' "$workspace" \
  && grep -q 'captureSystemAudio: screenAudio' "$workspace" \
  && grep -q 'object(forKey: "astra.recording.systemAudio") as? Bool ?? true' "$workspace"; then
  row "screen audio permission follows selection" "PASS"
else
  bad "screen audio permission follows selection" "FAIL" \
    "マイク権限と画面音の権限・保存された選択の接続を確認してください"
fi

# 4. connector（OAuth）は人が押した行からしか始まらない。
conn=$(prod "\.connect(" | grep -v "Context/ConnectorState.swift" || true)
conn_bad=$(grep -v "Button" <<<"$conn" | grep . || true)
if [ -n "$conn" ] && [ -z "$conn_bad" ]; then
  row "connector egress requires user action" "PASS"
else
  bad "connector egress requires user action" "FAIL" "${conn_bad:-connect の呼び手が見つからない}"
fi

# 5. 外へ届く実行は確認の面を通る（CONFIRMATION_GATE は verify-confirmation.sh が画素で持つ。
#    ここでは、送る/捨てる系の入口が Confirm.ask を経ることを静的に数える）。
conf=$(prod "Confirm.ask(" | wc -l | tr -d ' ')
if [ "$conf" -ge 3 ]; then
  row "external action confirmation" "PASS (Confirm.ask ×$conf; 面は CONFIRMATION_GATE)"
else
  bad "external action confirmation" "FAIL" "Confirm.ask の入口が $conf 箇所しかない"
fi

# 6. ガイドが、オンデバイスと Google STT の選択を正しく説明する。
guide="$ROOT/docs/guide/build.py"
claim_ok=1
grep -q "Google STT" "$guide" || claim_ok=0
grep -q "相手の声のために" "$guide" && claim_ok=0     # 取り込んでいない音のために許可を説明しない
grep -q "transcription.onDeviceUnavailable" "$guide" || claim_ok=0   # 落とさない代わりに、出ない理由を教える
usage=$(grep -rn "NSSpeechRecognitionUsageDescription" "$ROOT/scripts/build-macos-app.sh" "$ROOT/apps/astra-macos/Info.plist" "$ROOT/apps/astra-macos/Sources" 2>/dev/null | head -1)
if [ $claim_ok -eq 1 ]; then
  row "transcription egress guide" "consistent"
else
  bad "transcription egress guide" "FAIL" "docs/guide/build.py: Google STT の説明が無い / 「相手の声のために」が残っている / 出ない理由の行が無い"
fi

# 実行体（ある時だけ）: 既定 OFF と、資産の無いロケールで throw。
if [ -x "$BIN" ]; then
  out=$(env -u ASTRA_DEV_AUTO_UPLOAD "$BIN" --selftest egress 2>/dev/null | tail -1)
  case "$out" in
    SELFTEST_OK*)   row "runtime (--selftest egress)" "${out#SELFTEST_OK egress: }";;
    SELFTEST_SKIP*) row "runtime (--selftest egress)" "SKIP";;
    *) bad "runtime (--selftest egress)" "FAIL" "$out";;
  esac
fi

echo
if [ $fail -eq 0 ]; then echo "PRIVACY_EGRESS_GATE=PASS"; else echo "PRIVACY_EGRESS_GATE=FAIL" >&2; exit 1; fi
