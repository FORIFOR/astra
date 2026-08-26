/** サーバのエラー契約（実装仕様 §3.7）をクライアント側の例外へ写す。 */
import { ApiError, AstraError, type ErrorCode } from '@astra/contracts';

/**
 * レスポンスから例外を組み立てる。
 *
 * 契約どおりの本文でなければ、**中身を推測しない**。
 * 502 の HTML や proxy のエラーページを code として扱うと、
 * クライアント側の分岐が嘘の code で動き出す。
 */
export async function errorFrom(response: Response): Promise<AstraError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const parsed = ApiError.safeParse(body);
  if (parsed.success) {
    return new AstraError(parsed.data.error.code, parsed.data.error.message, {
      details: parsed.data.error.details,
      retryable: isRetryable(parsed.data.error.code, response.status),
    });
  }

  const code: ErrorCode = response.status >= 500 ? 'common.unavailable' : 'common.internal';
  return new AstraError(code, `unexpected response (${response.status})`, {
    retryable: response.status >= 500,
  });
}

/** 再試行してよいか。UI/UX §21 の next action を決める材料になる。 */
function isRetryable(code: ErrorCode, status: number): boolean {
  if (code === 'common.rate_limited') return true;
  if (code === 'common.unavailable') return true;
  return status >= 500;
}
