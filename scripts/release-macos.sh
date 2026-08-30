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
( cd "$ROOT/core/astra-core" && cargo build --release --quiet )
export ASTRA_CORE_LIB_DIR="$ROOT/core/astra-core/target/release"
[[ -f "$ASTRA_CORE_LIB_DIR/libastra_core.a" ]] || {
  echo "FAIL: release の libastra_core.a が無い" >&2; exit 1; }
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
  <key>NSCalendarsFullAccessUsageDescription</key><string>会議の予定を文脈として読むために、カレンダーを使います。読み取りは手元で行い、外部には送りません。</string>
  <key>NSMicrophoneUsageDescription</key><string>会議を録音し、手元で文字にするためにマイクを使います。音声は端末から出しません。</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>会議の音声を手元で文字起こしするために使います。音は端末から出しません。</string>
  <key>NSAppleEventsUsageDescription</key><string>前面アプリの文脈（開いている書類名など）を読むために使います。</string>
  <key>NSCameraUsageDescription</key><string>使いません。</string>
  <key>NSCalendarsUsageDescription</key><string>会議の予定を文脈として読むために、カレンダーを使います。</string>
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

echo "== sign (Developer ID + hardened runtime) =="
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
