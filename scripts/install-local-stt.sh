#!/usr/bin/env bash
#
# 手元の文字起こしを入れる。正本 §11・§23。
#
# 要るものは 2 つで、どちらもリポジトリには入れない（150MB と 680MB）:
#   1. sherpa-onnx の C API（dylib）… 実行時に libloading で読む
#   2. 日本語の模型（ReazonSpeech zipformer）
#
# 置き場所は Rust 側の探索順に合わせてある（stt/library.rs, stt/model.rs）:
#   ~/Library/Application Support/Astra/lib/libsherpa-onnx-c-api.dylib
#   ~/Library/Application Support/Astra/models/sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01/
#
#   ./scripts/install-local-stt.sh
#
set -euo pipefail

ROOT="${HOME}/Library/Application Support/Astra"
LIB_DIR="${ROOT}/lib"
MODEL_DIR="${ROOT}/models"
MODEL="sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01"
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
todo() { printf '  \033[33m→\033[0m %s\n' "$1"; }
say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

say "1. sherpa-onnx の C API"
mkdir -p "$LIB_DIR"
if [ -f "$LIB_DIR/libsherpa-onnx-c-api.dylib" ]; then
  ok "入っています: ${LIB_DIR}/libsherpa-onnx-c-api.dylib"
else
  # **版は固定。**Rust の FFI（stt/ffi.rs）が struct の並びをこの版に
  # 合わせてある。別の版を入れると SIGBUS で落ちる（実際に落ちた）。
  # 上げるときは ffi.rs / library.rs の SHERPA_VERSION と一緒に上げる。
  TAG="v1.13.6"
  VER="${TAG#v}"
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64) ASSET="sherpa-onnx-${TAG}-osx-arm64-shared.tar.bz2" ;;
    x86_64) ASSET="sherpa-onnx-${TAG}-osx-x86_64-shared.tar.bz2" ;;
    *) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
  esac
  todo "取得: $ASSET"
  TMP="$(mktemp -d)"
  curl -fL --retry 3 -o "$TMP/lib.tar.bz2" "https://github.com/k2-fsa/sherpa-onnx/releases/download/${TAG}/${ASSET}"
  tar xjf "$TMP/lib.tar.bz2" -C "$TMP"
  # 中の dylib だけ取り出す。**bin や header は要らない。**
  FOUND="$(find "$TMP" -name 'libsherpa-onnx-c-api.dylib' | head -1)"
  [ -n "$FOUND" ] || { echo "dylib が見つかりません（${ASSET} の中身が変わった？）" >&2; find "$TMP" -maxdepth 3 | head; exit 1; }
  cp "$FOUND" "$LIB_DIR/"
  # 同じ場所にある依存（onnxruntime）も一緒に置く。無いと dylib が読めない。
  find "$(dirname "$FOUND")" -name '*.dylib' -exec cp {} "$LIB_DIR/" \;
  rm -rf "$TMP"
  ok "置きました: ${LIB_DIR}（${VER}）"
fi

say "2. 日本語の模型"
mkdir -p "$MODEL_DIR"
if [ -d "$MODEL_DIR/$MODEL" ]; then
  ok "入っています: ${MODEL_DIR}/${MODEL}"
else
  todo "取得: ${MODEL}（約 680MB）"
  curl -fL --retry 3 -o "$MODEL_DIR/model.tar.bz2" \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL}.tar.bz2"
  tar xjf "$MODEL_DIR/model.tar.bz2" -C "$MODEL_DIR"
  rm "$MODEL_DIR/model.tar.bz2"
  ok "置きました: ${MODEL_DIR}/${MODEL}"
fi

say "3. 確認"
ls "$LIB_DIR" | sed 's/^/  /'
ls "$MODEL_DIR/$MODEL" | head -5 | sed 's/^/  /'
echo
echo "  アプリを起動し直すと、Dock の mic が手元の文字起こしを使います。"
