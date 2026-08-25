/**
 * トレース。実装仕様 §13.1。
 *
 * ここでは `@opentelemetry/api` だけに依存する。SDK の初期化は各サービスの起動側で行う
 * （SDK を持ち込むと、まだ配線していない Phase 0 のパッケージにも重い依存が伝播するため）。
 * SDK 未設定なら API 側が no-op になり、呼び出し側のコードは変えなくてよい。
 */
import { SpanStatusCode, context, trace, type Attributes, type Span } from '@opentelemetry/api';

const TRACER_NAME = 'astra';

export function tracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * span を張って関数を実行する。例外は span に記録してから再スロー。
 * 握りつぶさない（正本 §24「勝手に成功扱いしない」）。
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes: attributes ?? {} }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/** 現在の trace id。ログの相関 ID に載せる。 */
export function currentTraceId(): string | undefined {
  const span = trace.getSpan(context.active());
  const id = span?.spanContext().traceId;
  // 全ゼロは「有効な span が無い」の意味なので undefined に倒す
  return id && /[^0]/.test(id) ? id : undefined;
}
