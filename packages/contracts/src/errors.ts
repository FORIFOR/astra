/**
 * エラー契約。実装仕様 §3.7。
 *
 * ユーザー向け表示文はサーバに持たせない。クライアントが `code` から引く。
 * サーバの `message` は開発者向け英語。
 */
import { z } from 'zod';

export const ERROR_CODES = [
  // 認証・認可
  'auth.missing_token',
  'auth.invalid_token',
  'auth.expired_token',
  'auth.refresh_reuse_detected',
  'auth.forbidden',
  'auth.device_revoked',
  // 汎用
  'common.validation_failed',
  'common.not_found',
  'common.conflict',
  'common.rate_limited',
  'common.internal',
  'common.unavailable',
  // task
  'task.not_found',
  'task.unknown_kind',
  'task.invalid_state',
  'task.idempotency_conflict',
  'task.approval_timeout',
  // approval
  'approval.not_found',
  'approval.expired',
  'approval.already_decided',
  'approval.rejected',
  // artifact
  'artifact.not_found',
  'artifact.too_large',
  'artifact.checksum_mismatch',
  'artifact.unsupported_type',
  // plugin
  'plugin.not_found',
  'plugin.manifest_invalid',
  'plugin.incompatible',
  'plugin.unsigned',
  'plugin.not_removable',
  'plugin.permission_denied',
  // local host bridge
  'host.not_connected',
  'host.capability_denied',
  'host.timeout',
  // stream
  'stream.invalid_cursor',
  'stream.too_many_connections',
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
    request_id: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

const STATUS: Partial<Record<ErrorCode, number>> = {
  'auth.missing_token': 401,
  'auth.invalid_token': 401,
  'auth.expired_token': 401,
  'auth.refresh_reuse_detected': 401,
  'auth.device_revoked': 401,
  'auth.forbidden': 403,
  'common.validation_failed': 400,
  'common.not_found': 404,
  'common.conflict': 409,
  'common.rate_limited': 429,
  'common.internal': 500,
  'common.unavailable': 503,
  'task.not_found': 404,
  'task.unknown_kind': 400,
  'task.invalid_state': 409,
  'task.idempotency_conflict': 409,
  'task.approval_timeout': 409,
  'approval.not_found': 404,
  'approval.expired': 409,
  'approval.already_decided': 409,
  'approval.rejected': 409,
  'artifact.not_found': 404,
  'artifact.too_large': 413,
  'artifact.checksum_mismatch': 422,
  'artifact.unsupported_type': 415,
  'plugin.not_found': 404,
  'plugin.manifest_invalid': 400,
  'plugin.incompatible': 409,
  'plugin.unsigned': 403,
  'plugin.not_removable': 403,
  'plugin.permission_denied': 403,
  'host.not_connected': 409,
  'host.capability_denied': 403,
  'host.timeout': 504,
  'stream.invalid_cursor': 400,
  'stream.too_many_connections': 429,
};

/**
 * 実装仕様 逸脱 D-11: 越境アクセスは 403 ではなく 404 を返す（資源の存在を漏らさない）。
 * したがって「他テナントの task」は `task.not_found` を使う。`auth.forbidden` を使わない。
 */
export function httpStatusFor(code: ErrorCode): number {
  return STATUS[code] ?? 500;
}

export class AstraError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, opts?: { details?: unknown; retryable?: boolean }) {
    super(message);
    this.name = 'AstraError';
    this.code = code;
    this.details = opts?.details;
    // Temporal の nonRetryableErrorTypes と対応させる（実装仕様 §6.5）
    this.retryable = opts?.retryable ?? false;
  }

  get httpStatus(): number {
    return httpStatusFor(this.code);
  }

  toApiError(requestId: string): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
        request_id: requestId,
      },
    };
  }
}
