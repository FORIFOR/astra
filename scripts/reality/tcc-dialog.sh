#!/usr/bin/env bash
# OS の許可ダイアログ（TCC）を機械で押す。人がクリックしない（HUMAN_INTERVENTION=0）。
#   bash scripts/reality/tcc-dialog.sh allow|deny [seconds]
# seconds のあいだ、TCC のダイアログを出すプロセスの窓を探し、見つけたら押す。押したら 0、時間切れは 1。
# 呼び出し元に Accessibility の許可が要る（System Events）。
set -uo pipefail
WANT="${1:?allow|deny}"; SECS="${2:-20}"
case "$WANT" in
  allow) NAMES='{"OK", "許可", "Allow"}' ;;
  deny)  NAMES='{"許可しない", "Don'"'"'t Allow", "Deny"}' ;;
  *) echo "usage: tcc-dialog.sh allow|deny [seconds]" >&2; exit 2 ;;
esac
end=$(( $(date +%s) + SECS ))
while [[ $(date +%s) -lt $end ]]; do
  r="$(osascript - "$NAMES" <<'AS' 2>/dev/null
on run argv
  set wanted to run script (item 1 of argv)
  tell application "System Events"
    repeat with pn in {"UserNotificationCenter", "CoreServicesUIAgent", "SecurityAgent", "universalaccessd"}
      try
        tell process pn
          repeat with w in windows
            repeat with b in buttons of w
              set n to (name of b as text)
              repeat with wn in wanted
                -- 「許可しない」は「許可」を含む。完全一致を先に、部分一致は否定語を除いて。
                if n is (wn as text) or (n contains (wn as text) and n does not contain "しない" and n does not contain "Don" and n does not contain "Deny") then
                  click b
                  return "CLICKED " & n
                end if
              end repeat
            end repeat
          end repeat
        end tell
      end try
    end repeat
  end tell
  return "NONE"
end run
AS
)"
  if [[ "$r" == CLICKED* ]]; then echo "$r"; exit 0; fi
  sleep 0.5
done
echo "NO_DIALOG"; exit 1
