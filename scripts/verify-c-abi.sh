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

    /* connector: PKCE (RFC 7636 test vector) + authorize URL */
    char* chal = astra_core_pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    if (strcmp(chal, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM") != 0) { printf("CABI_FAIL pkce=%s\n", chal); return 20; }
    char* url = astra_core_authorize_url("google", "cid-1", "http://127.0.0.1:8123/cb", "openid email", "st-1", chal);
    if (!url || strstr(url, "code_challenge_method=S256") == NULL || strstr(url, "state=st-1") == NULL) { printf("CABI_FAIL authorize_url=%s\n", url ? url : "NULL"); return 21; }
    char* bad = astra_core_authorize_url("google", "cid", "https://evil.example/cb", "", "s", "c");
    if (bad != NULL) { printf("CABI_FAIL non-loopback accepted\n"); return 22; }
    printf("CABI_OK connector: pkce=S256 authorizeUrl ok nonLoopbackRejected\n");
    astra_core_string_free(chal);
    astra_core_string_free(url);

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
