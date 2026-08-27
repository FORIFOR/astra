#!/usr/bin/env bash
# astra-macos を配布可能な .app に包む。live mic/画面/グローバル操作の許可(TCC)は Info.plist の
# usage 文言が要る。ad-hoc 署名まで行う（正式配布は Developer ID 署名 + notarize が別途必要）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/apps/astra-macos"
APP="$PKG/build/Astra.app"

cd "$PKG"
swift build -c release >/dev/null
BIN="$(swift build -c release --show-bin-path)/AstraMac"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Astra"
# Rust 静的ライブラリは実行ファイルに static link 済み（dylib 同梱不要）。

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Astra</string>
  <key>CFBundleDisplayName</key><string>Astra</string>
  <key>CFBundleIdentifier</key><string>com.astra.mac</string>
  <key>CFBundleExecutable</key><string>Astra</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <!-- overlay として Dock に出さない -->
  <key>LSUIElement</key><true/>
  <!-- 許可の説明文言（無いと TCC プロンプトが出ない） -->
  <key>NSMicrophoneUsageDescription</key><string>会議を録音し、手元で文字にするためにマイクを使います。</string>
  <key>NSAppleEventsUsageDescription</key><string>他アプリの文脈を読むために使います。</string>
  <key>NSCalendarsUsageDescription</key><string>会議の予定を取り込むために使います。</string>
  <key>NSCalendarsFullAccessUsageDescription</key><string>会議の予定を取り込むために使います。</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>会議の音声を手元で文字起こしするために使います。音は端末から出しません。</string>
</dict>
</plist>
PLIST

# ad-hoc 署名（"-" は ad-hoc）。TCC はバンドル識別子で許可を覚える。
codesign --force --sign - --timestamp=none "$APP" >/dev/null 2>&1 || codesign --force --sign - "$APP"
echo "built $APP"
codesign -dv "$APP" 2>&1 | grep -E "Identifier|Signature" | head -2 || true
