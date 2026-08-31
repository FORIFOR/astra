#!/usr/bin/env bash
# Astra macOS を**配布できる形**にする。
#
# `package-macos-app.sh` との違い:
#   あちらは Apple Development 署名で、実機の TCC を出すための開発用。
#   自分の Mac でしか動かない（他人の Mac では Gatekeeper に止められる）。
#   こちらは Developer ID + hardened runtime + notarization で、配る用。
#
# 版番号は package.json 1 か所から取る。plist に直に書くと、必ずどこかとずれる。
#
# Sparkle の公開鍵は既定でこの Mac の keychain にある鍵のもの。**公開鍵なので
# 秘密ではない**（アプリに埋めて配るもの）。対の秘密鍵は keychain にあり、
# 失うと以後の更新に署名できない —— 別の鍵に変えると、古い版のアプリは
# 新しい更新を検証できなくなる。
#
# 必要なもの:
#   - "Developer ID Application" の証明書（security find-identity -v -p codesigning）
#   - notarization の資格情報。あらかじめ keychain profile にしておく:
#       xcrun notarytool store-credentials "astra-notary" \
#         --apple-id <Apple ID> --team-id <TeamID> --password <app 用パスワード>
#     プロファイル名は ASTRA_NOTARY_PROFILE で変えられる（既定 astra-notary）。
#
# 資格情報が無いときは **notarization の手前で止まる**。署名だけ済んだ .app を
# 「配布できる」と言わない（他人の Mac では開けないので）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
APP="$OUT/Astra.app"
NOTARY_PROFILE="${ASTRA_NOTARY_PROFILE:-astra-notary}"

VERSION="$(node -p "require('$ROOT/package.json').version")"
[[ -n "$VERSION" ]] || { echo "FAIL: package.json から版番号を取れない" >&2; exit 1; }

# 署名 identity。Developer ID が無ければここで止める（開発署名で配らない）。
IDENTITY="${ASTRA_SIGN_IDENTITY:-}"
if [[ -z "$IDENTITY" ]]; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
    | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)"/\1/')"
fi
if [[ -z "$IDENTITY" ]]; then
  echo "FAIL: Developer ID Application の証明書が無い。開発署名では配布できない。" >&2
  exit 1
fi

echo "== build (release) =="
# Rust も release で作る。ここを忘れると、配布物に debug の Rust が入る。
# panic の位置文字列にはビルドした人の絶対パスがそのまま入る（実測 175 箇所）。
# 不特定多数へ配るものに開発者のユーザー名を載せない。開発ビルドはそのままにして、
# 配布ビルドだけ畳む。
( cd "$ROOT/core/astra-core" \
  && RUSTFLAGS="--remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$ROOT=/astra ${RUSTFLAGS:-}" \
     cargo build --release --quiet )
export ASTRA_CORE_LIB_DIR="$ROOT/core/astra-core/target/release"
[[ -f "$ASTRA_CORE_LIB_DIR/libastra_core.a" ]] || {
  echo "FAIL: release の libastra_core.a が無い" >&2; exit 1; }
bash "$ROOT/scripts/fetch-sparkle.sh"
( cd "$ROOT/apps/astra-macos" && swift build -c release )

# 実行時に外の dylib を掴んでいないこと。掴んでいたら、その絶対パスが無い
# 他人の Mac では起動しない（一度そうなっていた）。
BIN="$ROOT/apps/astra-macos/.build/release/AstraMac"
if otool -L "$BIN" | grep -q "astra_core.*dylib"; then
  echo "FAIL: astra_core を dylib で掴んでいる（静的リンクになっていない）" >&2
  otool -L "$BIN" | grep astra_core >&2
  exit 1
fi

echo "== bundle =="
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/apps/astra-macos/.build/release/AstraMac" "$APP/Contents/MacOS/AstraMac"

# 記号を落とす。**署名より前に**やること（後でやると署名が壊れる）。
# 依存の C ソース（ring 等）の絶対パスは rustc の --remap-path-prefix では
# 畳めない（cc が埋めるため）ので、ここで消す。配るものに開発者の
# ユーザー名を載せない。
strip -x "$APP/Contents/MacOS/AstraMac"
# 残った分は panic の位置文字列（__TEXT のリテラル）。記号ではないので strip では
# 消えず、依存の C ソース由来は rustc の --remap-path-prefix でも畳めない。
# **体裁の話で、機能でも安全性でもない**ので、ここでは止めずに数だけ報告する。
LEAK="$(strings "$APP/Contents/MacOS/AstraMac" 2>/dev/null | grep -c "$HOME" || true)"
if [[ "${LEAK:-0}" -eq 0 ]]; then
  echo "strip: 記号を落とした（個人パス 0 件）"
else
  echo "strip: 記号を落とした（panic の位置文字列に個人パスが $LEAK 件残る・体裁のみ）"
fi

# 同梱プラグインをバンドルへ。入れ忘れると、配った先では 1 件も読めない
# （以前は開発機の絶対パスで拾えていたので、手元でだけ動いていた）。
mkdir -p "$APP/Contents/Resources/plugins"
cp -R "$ROOT/plugins/builtin" "$APP/Contents/Resources/plugins/builtin"
PLUGIN_COUNT="$(find "$APP/Contents/Resources/plugins/builtin" -name plugin.yaml | wc -l | tr -d ' ')"
[[ "$PLUGIN_COUNT" -gt 0 ]] || { echo "FAIL: 同梱プラグインが 0 件" >&2; exit 1; }
echo "plugins: $PLUGIN_COUNT 件を同梱"

# アイコン。無いと Finder でも Dock でも「開く」ダイアログでも空白になる
# —— 不特定多数へ配るなら、名前より先に目に入るのはここ。
ICON_SRC="$ROOT/apps/desktop/src-tauri/icons/icon.icns"
[[ -f "$ICON_SRC" ]] || { echo "FAIL: アイコン ($ICON_SRC) が無い" >&2; exit 1; }
cp "$ICON_SRC" "$APP/Contents/Resources/AppIcon.icns"
echo "icon: 同梱した"

# 用途説明は package-macos-app.sh と同じものを使う。片方だけ直すとずれるので、
# verify-usage-descriptions.sh が両方を突き合わせている。
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>AstraMac</string>
  <key>CFBundleIdentifier</key><string>com.astra.desktop</string>
  <key>CFBundleName</key><string>Astra</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <!-- Dock アイコンは出さない（常駐の Task Dock が入口）。 -->
  <key>LSUIElement</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHumanReadableCopyright</key><string>© 2026 Shuhei Horio</string>
  <key>NSCalendarsFullAccessUsageDescription</key><string>会議の予定を文脈として読むために、カレンダーを使います。読み取りは手元で行い、外部には送りません。</string>
  <key>NSMicrophoneUsageDescription</key><string>会議を録音し、手元で文字にするためにマイクを使います。音声は端末から出しません。</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>会議の音声を手元で文字起こしするために使います。音は端末から出しません。</string>
  <key>NSAppleEventsUsageDescription</key><string>前面アプリの文脈（開いている書類名など）を読むために使います。</string>
  <key>NSCameraUsageDescription</key><string>使いません。</string>
  <key>NSCalendarsUsageDescription</key><string>会議の予定を文脈として読むために、カレンダーを使います。</string>
  <!-- 自動更新（Sparkle）。**どちらも空のままでは更新を確かめない。**
       配布先が決まったら appcast の URL を、`generate_keys` を回したら
       その公開鍵をここへ入れる。片方だけ入れても SoftwareUpdate は起動しない。 -->
  <key>SUFeedURL</key><string>${ASTRA_UPDATE_FEED:-}</string>
  <key>SUPublicEDKey</key><string>${ASTRA_UPDATE_PUBKEY:-b61dWnFNEdpzAWG/V5SMb4bZGrqgzJwMDAcuw/564cs=}</string>
  <key>SUEnableAutomaticChecks</key><true/>
  <!-- 黙って入れ替えない。落としてくるかは利用者が決める。 -->
  <key>SUAutomaticallyUpdate</key><false/>
</dict></plist>
PLIST

# hardened runtime で要る権利だけ。付けすぎると審査で不利になるうえ、
# 「何ができるアプリか」の説明にもならない。
cat > "$OUT/astra.entitlements" <<'ENT'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.device.audio-input</key><true/>
  <key>com.apple.security.automation.apple-events</key><true/>
</dict></plist>
ENT

# Sparkle を同梱する。framework が入っていないと、更新の口だけ在って動かない。
SPARKLE_FW="$(find "$ROOT/apps/astra-macos/Vendor/Sparkle/Sparkle.xcframework" \
  -type d -name "Sparkle.framework" -path "*macos*" 2>/dev/null | head -1)"
if [[ -n "$SPARKLE_FW" ]]; then
  mkdir -p "$APP/Contents/Frameworks"
  rm -rf "$APP/Contents/Frameworks/Sparkle.framework"
  cp -R "$SPARKLE_FW" "$APP/Contents/Frameworks/Sparkle.framework"
  # 実行体が @rpath で framework を見つけられるように。
  install_name_tool -add_rpath "@executable_path/../Frameworks" \
    "$APP/Contents/MacOS/AstraMac" 2>/dev/null || true
  echo "sparkle: 同梱した"
else
  echo "FAIL: Sparkle.framework が見つからない（scripts/fetch-sparkle.sh を先に）" >&2; exit 1
fi

echo "== sign (Developer ID + hardened runtime) =="
# **内側から署名する。** 入れ子の framework を後から署名すると、外側の署名が壊れる。
# Sparkle は中に XPC サービスと Autoupdate を持つので、それぞれ署名が要る。
while IFS= read -r nested; do
  codesign --force --timestamp --options runtime --sign "$IDENTITY" "$nested"
done < <(find "$APP/Contents/Frameworks/Sparkle.framework" \
  \( -name "*.xpc" -o -name "Autoupdate" -o -name "Updater.app" \) 2>/dev/null)
codesign --force --timestamp --options runtime --sign "$IDENTITY" \
  "$APP/Contents/Frameworks/Sparkle.framework"

codesign --force --timestamp --options runtime \
  --entitlements "$OUT/astra.entitlements" \
  --sign "$IDENTITY" --identifier com.astra.desktop "$APP"
codesign --verify --strict --deep --verbose=2 "$APP"
echo "signed: $(codesign -dv --verbose=2 "$APP" 2>&1 | grep -m1 Authority=)"

ZIP="$OUT/Astra-${VERSION}.zip"
rm -f "$ZIP"
/usr/bin/ditto -c -k --keepParent "$APP" "$ZIP"
echo "zip: $ZIP ($(du -h "$ZIP" | cut -f1))"

# ここから先は資格情報が要る。無いなら**配布できるとは言わない**。
if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  cat >&2 <<EOF

BLOCKED: notarization の資格情報が無い（keychain profile "$NOTARY_PROFILE"）。
署名済みの .app と zip はできているが、**他人の Mac では Gatekeeper に止められる**。
資格情報を入れてから、このスクリプトをもう一度実行すること:

  xcrun notarytool store-credentials "$NOTARY_PROFILE" \\
    --apple-id <Apple ID> --team-id <TeamID> --password <app 用パスワード>

RELEASE_READINESS=SIGNED_NOT_NOTARIZED
EOF
  exit 3
fi

echo "== notarize =="
xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"

# 配った先で本当に開けるか。ここを通らないものは配らない。
spctl --assess --type execute --verbose=4 "$APP"

rm -f "$ZIP"
/usr/bin/ditto -c -k --keepParent "$APP" "$ZIP"
echo "RELEASE_READINESS=NOTARIZED"
echo "artifact: $ZIP"
