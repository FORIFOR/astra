#!/usr/bin/env bash
# 安定 C ABI を C から実際に叩き、断片ファイルが書かれることを確かめる。
# Windows(C#/P-Invoke) が使うのと同じ境界を、このホスト(clang)で実証する（build 未検証の Windows とは別）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$ROOT/core/astra-core"
cd "$CORE"; cargo build --quiet
LIBDIR="$CORE/target/debug"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/t.c" <<'C'
#include "astra_core.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <sys/stat.h>
int main(int argc, char** argv) {
    char* v = astra_core_version();
    if (strcmp(v, "0.1.0") != 0) { printf("CABI_FAIL version=%s\n", v); return 2; }
    astra_core_string_free(v);

    const char* root = argv[1];
    CApiSession* s = astra_core_session_start(root, "cabi");
    if (!s) { printf("CABI_FAIL start\n"); return 3; }
    float* frame = malloc(sizeof(float) * 16000);
    for (int i = 0; i < 16000; i++) frame[i] = 0.1f;
    unsigned closed = 0;
    for (int sec = 0; sec < 6; sec++) closed += astra_core_session_push(s, frame, 16000, 16000);
    free(frame);
    unsigned long long ms = astra_core_session_recorded_ms(s);
    if (astra_core_session_finish(s) != 0) { printf("CABI_FAIL finish\n"); return 4; }
    astra_core_session_free(s);

    char path[1024]; snprintf(path, sizeof(path), "%s/cabi/mic/000001.pcm", root);
    struct stat st;
    if (closed != 1 || ms != 5000 || stat(path, &st) != 0 || st.st_size <= 0) {
        printf("CABI_FAIL closed=%u ms=%llu size=%lld\n", closed, ms, (long long)(stat(path,&st)==0?st.st_size:-1));
        return 5;
    }
    printf("CABI_OK closed=%u ms=%llu fragmentBytes=%lld\n", closed, ms, (long long)st.st_size);
    return 0;
}
C
OUTDIR="$TMP/rec"; mkdir -p "$OUTDIR"
clang "$TMP/t.c" -I "$CORE/include" -L "$LIBDIR" -lastra_core -o "$TMP/t"
OUT="$("$TMP/t" "$OUTDIR")"
echo "$OUT"
[[ "$OUT" == CABI_OK* ]] || { echo "FAIL: C ABI round trip" >&2; exit 1; }
