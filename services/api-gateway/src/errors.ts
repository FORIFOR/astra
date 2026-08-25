/**
 * エラー応答。実装仕様 §3.7。
 *
 * 原則:
 *   - 未知の例外の内部メッセージをクライアントへ返さない
 *   - ユーザー向け表示文はサーバに持たせない。クライアントが `code` から引く
 *   - 越境アクセスは 403 ではなく 404（逸脱 D-11）
 */
import { ZodError } from 'zod';
import { AstraError, type ApiError, type ErrorCode } from '@astra/contracts';
import { currentRequestId } from './request-context.js';
import type { App } from './fastify.js';

export function toApiError(error: unknown, requestId: string): { status: number; body: ApiError } {
  if (error instanceof AstraError) {
    return { status: error.httpStatus, body: error.toApiError(requestId) };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'common.validation_failed',
          message: 'request payload failed validation',
          // どのフィールドが悪いかは返す。値そのものは返さない（PII が混ざり得るため）
          details: error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
          request_id: requestId,
        },
      },
    };
  }

  // Fastify が付ける statusCode（400 系のパース失敗など）は尊重する
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const code: ErrorCode = status === 404 ? 'common.not_found' : 'common.validation_failed';
    return {
      status,
      body: { error: { code, message: 'request rejected', request_id: requestId } },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: 'common.internal',
        // 内部例外の文面は外へ出さない。詳細はログと trace に残す。
        message: 'internal error',
        request_id: requestId,
      },
    },
  };
}

export function installErrorHandlers(app: App): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = currentRequestId();
    const { status, body } = toApiError(error, requestId);

    if (status >= 500) {
      request.log.error({ err: error, code: body.error.code }, 'request failed');
    } else {
      request.log.warn({ code: body.error.code, status }, 'request rejected');
    }
    void reply.status(status).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: {
        code: 'common.not_found',
        message: `no route for ${request.method} ${request.url}`,
        request_id: currentRequestId(),
      },
    } satisfies ApiError);
  });
}
