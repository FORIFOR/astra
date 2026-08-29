#!/usr/bin/env bash
# Astra macOS を署名済み .app にする（Calendar 等の TCC を実機で検証するため）。
# TCC プロンプトは署名 .app を LaunchServices(open) 経由で起動したときだけ出る。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IDENTITY="${ASTRA_SIGN_IDENTITY:-Apple Development}"   # security find-identity -v -p codesigning で確認
APP="$ROOT/apps/astra-macos/.build/Astra.app"
( cd "$ROOT/apps/astra-macos" && swift build -c release )
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS"
cp "$ROOT/apps/astra-macos/.build/release/AstraMac" "$APP/Contents/MacOS/AstraMac"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>AstraMac</string>
  <key>CFBundleIdentifier</key><string>com.astra.desktop</string>
  <key>CFBundleName</key><string>Astra</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSCalendarsFullAccessUsageDescription</key><string>会議の予定を文脈として読むために、カレンダーを使います。読み取りは手元で行い、外部には送りません。</string>
  <!-- 用途説明が無い権限を要求すると、OS がプロセスを**落とす**
       （TCC crashing due to privacy violation）。実際に録音開始でそうなった。
       要求しうるものは全部ここに書く。 -->
  <key>NSMicrophoneUsageDescription</key><string>会議を録音し、手元で文字にするためにマイクを使います。音声は端末から出しません。</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>会議の音声を手元で文字起こしするために使います。音は端末から出しません。</string>
  <key>NSAppleEventsUsageDescription</key><string>前面アプリの文脈（開いている書類名など）を読むために使います。</string>
  <key>NSCameraUsageDescription</key><string>使いません。</string>
  <key>NSCalendarsUsageDescription</key><string>会議の予定を文脈として読むために、カレンダーを使います。</string>
</dict></plist>
PLIST
codesign --force --sign "$IDENTITY" --identifier com.astra.desktop "$APP"
codesign -dv --verbose=2 "$APP" 2>&1 | grep -iE "Identifier=|TeamIdentifier=|Authority=Apple Dev" | head -3
echo "packaged: $APP"
echo "実 Calendar 検証: open \"$APP\" --args --selftest calendarlive  → プロンプトで許可 → 結果は /tmp/astra-calendarlive.txt"
