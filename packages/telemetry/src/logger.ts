/**
 * 構造化ログ。実装仕様 §13.1。
 *
 * 規約:
 *   - PII とプロンプト本文をログに出さない。出すのは ID・種別・件数だけ。
 *   - 相関 ID は request_id / task_id / trace_id の 3 本を全ログに載せる。
 */
import { pino, type DestinationStream, type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

/**
 * 値を伏せるキー。実装仕様 §13.1「PII とプロンプト本文を出さない」。
 * 部分一致ではなくキー名の一致で判定するので、新しい機密フィールドを足したら
 * ここにも足すこと。
 */
export const REDACTED_KEYS = [
  'email',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'device_token',
  'authorization',
  'api_key',
  'secret',
  'private_key',
  'refresh_token_hash',
  'prompt',
  'transcript',
  'content',
  'text',
  'selected_text',
  'clipboard',
] as const;

const redactPaths = REDACTED_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]);

export interface LoggerOptions {
  readonly level?: string;
  readonly service: string;
  readonly version?: string;
  /** 開発時だけ人間可読にする。本番は必ず JSON。 */
  readonly pretty?: boolean;
}

/**
 * @param destination 出力先。省略すると stdout。
 *   テストや、サービス側で独自の transport を挿すときに使う。
 */
export function createLogger(options: LoggerOptions, destination?: DestinationStream): Logger {
  const config = {
    level: options.level ?? process.env['ASTRA_LOG_LEVEL'] ?? 'info',
    base: {
      service: options.service,
      ...(options.version === undefined ? {} : { version: options.version }),
    },
    redact: { paths: redactPaths, censor: '[redacted]' },
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(options.pretty ? { transport: { target: 'pino-pretty' } } : {}),
  } as const;

  try {
    return destination ? pino(config, destination) : pino(config);
  } catch (error) {
    // ログの整形でアプリを落とさない。pino-pretty が無い環境（本番の slim image 等）でも
    // 起動できる方が正しい。実際、依存の入れ忘れで起動不能になったことがある。
    if (!options.pretty) throw error;
    const { transport: _transport, ...plain } = config as Record<string, unknown>;
    process.stderr.write('pino-pretty is unavailable; falling back to JSON logs\n');
    return destination ? pino(plain as never, destination) : pino(plain as never);
  }
}

/** 相関 ID。全ログ行に載せる（実装仕様 §13.1）。 */
export interface Correlation {
  readonly request_id?: string;
  readonly task_id?: string;
  readonly tenant_id?: string;
  readonly trace_id?: string;
}

export function withCorrelation(logger: Logger, correlation: Correlation): Logger {
  return logger.child(correlation);
}
