#!/usr/bin/env bash
# Astra の「この環境で検証できる全て」を 1 コマンドで通す最終アクセプタンス。
# 実行時前提が要るもの（署名 .app への TCC・Windows 実機・実 OAuth 提供者）は各スクリプトが
# SELFTEST_SKIP / SKIP で正直に飛ばす。ここが緑なら「実装＋この環境で検証可能な範囲」は健全。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail=0
run() { echo; echo "== $1 =="; shift; if "$@"; then :; else echo "  ^ FAILED"; fail=1; fi; }

# `cmd | grep ...` は grep の終了状態になるので、**テストが落ちても緑**になっていた。
# 実際に 1 件落ちたまま VERIFY_ALL_OK が出た。要約だけ見せつつ、状態は元のコマンドのものを返す。
# 落ちたときは要約だけでは追えない。**どのテストが落ちたか**を必ず残す。
run "astra-core tests"            bash -c "cd core/astra-core && out=\$(cargo test --quiet 2>&1); st=\$?; echo \"\$out\" | grep 'test result' | head -1; [ \$st -eq 0 ] || sed -n '/^failures:/,\$p' <<<\"\$out\" | head -40; exit \$st"
run "Tauri Rust regression"       bash -c "cd apps/desktop/src-tauri && out=\$(cargo test --quiet 2>&1); st=\$?; echo \"\$out\" | grep 'test result' | head -1; [ \$st -eq 0 ] || sed -n '/^failures:/,\$p' <<<\"\$out\" | head -40; exit \$st"
run "Tauri desktop JS regression" bash -c "out=\$(pnpm --filter @astra/desktop test 2>&1); st=\$?; echo \"\$out\" | grep -E 'Tests +[0-9]+ passed' | tail -1; [ \$st -eq 0 ] || grep -E '^ *(×|FAIL)' <<<\"\$out\" | head -40; exit \$st"
run "TCC usage descriptions"     bash scripts/verify-usage-descriptions.sh
run "release consistency"        bash scripts/verify-release-consistency.sh
run "design tokens fresh"         node scripts/gen-design-tokens.mjs --check
run "swift bindings fresh"        bash scripts/gen-swift-bindings.sh --check
run "workspace fixture fresh"     node scripts/gen-workspace-fixture.mjs --check
run "conventions"                 node scripts/check-conventions.mjs
run "C ABI contract (3-way)"      node scripts/check-cabi-csharp.mjs
run "native path Tauri-free"      node scripts/check-native-tauri-free.mjs
run "WinUI XAML well-formed"      bash scripts/check-xaml-wellformed.sh
run "C# bridge -> core + gateway" bash scripts/verify-csharp-bridge.sh
run "Windows C# logic type-check" bash scripts/verify-csharp-logic.sh
run "C ABI round-trip (C)"        bash scripts/verify-c-abi.sh
run "macOS recording + live E2E"  bash scripts/verify-macos-recording.sh
# 録音セッションの通し。**プロセスを跨いで** kill → 復元まで確かめる。
# CI が緑でもここが通らなければ未達、という位置づけのゲート。
run "recording experience E2E"    bash scripts/verify-recording-experience.sh
run "macOS swift unit tests"      bash -c "cd apps/astra-macos && swift test 2>&1 | grep -E 'Executed [0-9]+ tests' | head -1"

echo
if [[ $fail -eq 0 ]]; then echo "VERIFY_ALL_OK: この環境で検証できる全ゲートが緑"; else echo "VERIFY_ALL_FAIL"; exit 1; fi
