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

/* connector 契約層（RFC 6749/7636）。戻り値は astra_core_string_free で解放。失敗は NULL。 */
char *astra_core_pkce_challenge(const char *verifier);
char *astra_core_authorize_url(const char *provider, const char *client_id,
                               const char *redirect_uri, const char *scopes_space_joined,
                               const char *state, const char *code_challenge);

/* gateway API（実バックエンド）。JSON か生値を返す。失敗は NULL。要 astra_core_string_free。 */
int32_t astra_core_api_reachable(const char *base_url);
char *astra_core_api_dev_sign_in(const char *base_url, const char *email, const char *display_name);
char *astra_core_api_me(const char *base_url, const char *access_token);
char *astra_core_api_create_meeting(const char *base_url, const char *access_token, const char *title, const char *language);
char *astra_core_api_create_task(const char *base_url, const char *access_token, const char *kind, const char *input_json);
char *astra_core_api_wait_task(const char *base_url, const char *access_token, const char *task_id, uint64_t timeout_ms);
char *astra_core_api_artifact_content(const char *base_url, const char *access_token, const char *artifact_id);
char *astra_core_api_plugin_catalog(const char *base_url, const char *access_token);
char *astra_core_api_library(const char *base_url, const char *access_token);

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
