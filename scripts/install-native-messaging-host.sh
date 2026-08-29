#!/usr/bin/env bash
# §9 Chrome の Native Messaging host を登録する。
#
# ブラウザの設定を書き換えるので、**利用者が自分で実行する**。Astra は自動で入れない。
#   scripts/install-native-messaging-host.sh <拡張ID>
set -euo pipefail
EXT_ID="${1:-}"
[[ -n "$EXT_ID" ]] || { echo "使い方: $0 <拡張ID>（chrome://extensions で確認）" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${ASTRA_APP:-$ROOT/apps/astra-macos/.build/Astra.app}"
BIN="$APP/Contents/MacOS/AstraMac"
[[ -x "$BIN" ]] || { echo "Astra.app が見つからない: $BIN（先に scripts/package-macos-app.sh）" >&2; exit 1; }

# Chrome は「実行ファイルを直接」呼ぶので、引数を渡す小さなラッパを置く。
WRAPPER="$APP/Contents/MacOS/astra-native-host"
cat > "$WRAPPER" <<WRAP
#!/bin/sh
exec "$BIN" --native-messaging
WRAP
chmod +x "$WRAPPER"

DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$DIR"
cat > "$DIR/com.astra.desktop.context.json" <<JSON
{
  "name": "com.astra.desktop.context",
  "description": "Astra Context Bridge",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON
echo "登録しました: $DIR/com.astra.desktop.context.json"
echo "Chrome を再起動してください。"
