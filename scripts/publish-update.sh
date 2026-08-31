#!/usr/bin/env bash
# 更新を 1 つ出す。**appcast を作るところまで**をやる。
#
#   1. 配布物（署名・公証済み）が dist にあることを確かめる
#   2. zip に EdDSA 署名を付ける（Sparkle の鍵。Developer ID とは別物）
#   3. appcast.xml を作る／更新する
#
# 置きに行くのは**やらない**。どこへ置くかは人が決めることで、
# 間違った場所へ上げると取り消せないため。出来上がりを dist に置いて終わる。
#
# 必要なもの:
#   - `scripts/release-macos.sh` が RELEASE_READINESS=NOTARIZED まで通っていること
#     （公証していないものを配ると、受け取った側で Gatekeeper に止められる）
#   - Sparkle の署名鍵。一度だけ作る:
#       ./apps/astra-macos/Vendor/Sparkle/bin/generate_keys
#     出てきた公開鍵を ASTRA_UPDATE_PUBKEY に入れて release-macos.sh を回すと
#     Info.plist に入る。秘密鍵は keychain に残る（**リポジトリに置かない**）。
#   - 配布先の URL。appcast と zip を置く場所:
#       ASTRA_UPDATE_BASE=https://…/astra
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
SPARKLE_BIN="$ROOT/apps/astra-macos/Vendor/Sparkle/bin"
VERSION="$(node -p "require('$ROOT/package.json').version")"
ZIP="$OUT/Astra-${VERSION}.zip"
BASE="${ASTRA_UPDATE_BASE:-}"

[[ -f "$ZIP" ]] || { echo "FAIL: $ZIP が無い。先に scripts/release-macos.sh" >&2; exit 1; }
[[ -x "$SPARKLE_BIN/generate_appcast" ]] || {
  echo "FAIL: Sparkle の道具が無い。先に scripts/fetch-sparkle.sh" >&2; exit 1; }
[[ -n "$BASE" ]] || {
  echo "FAIL: ASTRA_UPDATE_BASE が未設定（appcast と zip を置く URL）" >&2
  echo "  例: ASTRA_UPDATE_BASE=https://example.com/astra bash scripts/publish-update.sh" >&2
  exit 1; }

# 公証されていないものを更新として出さない。受け取った側で開けない。
APP="$OUT/Astra.app"
if [[ -d "$APP" ]] && ! xcrun stapler validate "$APP" >/dev/null 2>&1; then
  echo "FAIL: 公証（staple）されていない。更新として出すと相手の Mac で開けない。" >&2
  echo "  scripts/release-macos.sh を RELEASE_READINESS=NOTARIZED まで通すこと。" >&2
  exit 1
fi

# generate_appcast は「zip が入った 1 つのフォルダ」を見て appcast を作る。
FEEDDIR="$OUT/feed"
mkdir -p "$FEEDDIR"
cp -f "$ZIP" "$FEEDDIR/"

echo "== appcast を作る =="
# 秘密鍵は keychain から取る（引数に鍵を渡さない＝履歴にもログにも残らない）。
"$SPARKLE_BIN/generate_appcast" --download-url-prefix "${BASE%/}/" "$FEEDDIR"

APPCAST="$FEEDDIR/appcast.xml"
[[ -f "$APPCAST" ]] || { echo "FAIL: appcast.xml ができていない" >&2; exit 1; }

# 署名が入ったか。無署名の appcast を配ると、更新が検証されない。
grep -q 'edSignature=' "$APPCAST" || {
  echo "FAIL: appcast に署名が無い（generate_keys で鍵を作ったか確認）" >&2; exit 1; }

echo
echo "PUBLISH_READY"
echo "  版:      $VERSION"
echo "  appcast: $APPCAST"
echo "  zip:     $FEEDDIR/$(basename "$ZIP")"
echo
echo "この 2 つを ${BASE%/}/ の下に置くと更新が届く。"
echo "置き場所は人が決める（このスクリプトは上げない）。"
echo "アプリ側の SUFeedURL は ${BASE%/}/appcast.xml を指していること。"
