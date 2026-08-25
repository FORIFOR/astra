/**
 * @astra/telemetry
 *
 * 構造化ログ / トレース / 監査イベント。実装仕様 §13。
 */
export {
  createLogger,
  withCorrelation,
  REDACTED_KEYS,
  type Logger,
  type LoggerOptions,
  type Correlation,
} from './logger.js';
export { withSpan, tracer, currentTraceId } from './tracing.js';
export {
  appendAuditEvent,
  readAuditChain,
  verifyAuditChain,
  computeAuditHash,
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditEventInput,
  type AuditHashInput,
  type AuditChainProblem,
} from './audit.js';
