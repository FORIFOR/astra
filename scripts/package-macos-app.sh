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
# Sparkle を同梱する。**入れないと起動できない**（実行体が @rpath/Sparkle.framework を要求し、
# dyld が "Library not loaded" で落とす）。Sparkle を入れた後もこの台本は更新されておらず、
# ここで作った .app は起動即クラッシュしていた —— TCC を要る検証が全部できない状態だった。
SPARKLE_FW="$(find "$ROOT/apps/astra-macos/Vendor/Sparkle/Sparkle.xcframework" \
  -type d -name "Sparkle.framework" -path "*macos*" 2>/dev/null | head -1)"
if [[ -n "$SPARKLE_FW" ]]; then
  mkdir -p "$APP/Contents/Frameworks"
  rm -rf "$APP/Contents/Frameworks/Sparkle.framework"
  cp -R "$SPARKLE_FW" "$APP/Contents/Frameworks/Sparkle.framework"
  install_name_tool -add_rpath "@executable_path/../Frameworks" \
    "$APP/Contents/MacOS/AstraMac" 2>/dev/null || true
else
  echo "FAIL: Sparkle.framework が見つからない（scripts/fetch-sparkle.sh を先に）" >&2; exit 1
fi

# 内側から署名する（入れ子を後から署名すると外側が壊れる）。release-macos.sh と同じ順。
while IFS= read -r nested; do
  codesign --force --sign "$IDENTITY" "$nested"
done < <(find "$APP/Contents/Frameworks/Sparkle.framework" \
  \( -name "*.xpc" -o -name "Autoupdate" -o -name "Updater.app" \) 2>/dev/null)
codesign --force --sign "$IDENTITY" "$APP/Contents/Frameworks/Sparkle.framework"
codesign --force --sign "$IDENTITY" --identifier com.astra.desktop "$APP"
codesign --verify --strict --verbose=2 "$APP"
codesign -dv --verbose=2 "$APP" 2>&1 | grep -iE "Identifier=|TeamIdentifier=|Authority=Apple Dev" | head -3
# 起動できることをここで確かめる。落ちる .app を渡すと、TCC の検証が全部そこで止まる。
"$APP/Contents/MacOS/AstraMac" --selftest facts >/dev/null 2>&1 \
  && echo "launch: OK（実行体は起動する）" \
  || { echo "FAIL: パッケージした .app が起動しない" >&2; exit 1; }
echo "packaged: $APP"
echo "実 Calendar 検証: open \"$APP\" --args --selftest calendarlive  → プロンプトで許可 → 結果は /tmp/astra-calendarlive.txt"
