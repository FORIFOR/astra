/* Astra Core の安定 C ABI（Windows C#/P-Invoke 用）。手書き・stable。 */
#ifndef ASTRA_CORE_H
#define ASTRA_CORE_H
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif

char *astra_core_version(void);
char *astra_core_format_elapsed(uint64_t ms);
void  astra_core_string_free(char *p);

typedef struct CApiSession CApiSession;
CApiSession *astra_core_session_start(const char *root, const char *meeting_id);
uint32_t     astra_core_session_push(CApiSession *s, const float *samples, size_t len, uint32_t sample_rate);
uint64_t     astra_core_session_recorded_ms(CApiSession *s);
int32_t      astra_core_session_finish(CApiSession *s);
void         astra_core_session_free(CApiSession *s);

#ifdef __cplusplus
}
#endif
#endif
