#!/bin/bash
# Finder entrypoint. The supervisor owns all setup and shutdown behavior.
set -u
cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/opt/homebrew/opt/node@22/bin:/usr/local/bin:/usr/local/opt/node@22/bin"
if ! command -v node >/dev/null 2>&1; then
  echo "Node 22以降が必要です。https://nodejs.org/ から導入して、もう一度このファイルを開いてください。"
  read -r -p "Returnで閉じます…"
  exit 1
fi
node scripts/start-local-preview.mjs "$@"
result=$?
if [[ $result -ne 0 ]]; then
  echo "問題を解消したあと、このファイルをもう一度開いて再開できます。"
  read -r -p "Returnで閉じます…"
fi
exit "$result"
