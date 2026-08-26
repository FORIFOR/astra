/**
 * Stock の step を task-service へ差し込む。正本 §15.7。
 *
 * **既定は research / draft order のみ。**証券会社への発注は、
 * 接続先が決まるまで置かない（tool そのものが無い）。
 */
import { AstraError } from '@astra/contracts';
import type { DomainService } from './domain.js';
import {
  concentration,
  containsRecommendation,
  orderProblems,
  orderReadback,
  toPosition,
  type OrderDraft,
  type OrderType,
  type Side,
} from './stock.js';

const STOCK_PLUGIN = 'com.astra.stock';

interface TaskLike {
  readonly taskId: string;
  readonly tenantId: string;
  readonly input: Record<string, unknown>;
}

interface StepLike {
  readonly toolId: string;
  readonly args: Record<string, unknown>;
}

export interface StockExecutorResult {
  result: unknown;
  detail?: string | null;
  artifact?: { title: string; markdown: string };
}

type Executor = { execute(input: TaskLike, step: StepLike): Promise<StockExecutorResult> };

function value(input: TaskLike, step: StepLike, key: string): unknown {
  return step.args[key] ?? input.input[key];
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function stockExecutors(domain: DomainService): Record<string, Executor> {
  return {
    'stock.watchlist': {
      async execute(input) {
        const items = await domain.list(input.tenantId, STOCK_PLUGIN, 'watch_item', 500);
        const lines = items.map((item) => {
          const reviewed = item.fields['last_reviewed_at'];
          return (
            `- ${String(item.fields['symbol'] ?? '不明')} ${String(item.fields['name'] ?? '')}` +
            // 最後に見た日が無いことを、最近見たことにしない
            (typeof reviewed === 'string' ? `（最終確認 ${reviewed}）` : '（未確認）')
          );
        });

        return {
          result: { items: items.length },
          detail: `${items.length} 銘柄`,
          artifact: {
            title: 'ウォッチリスト',
            markdown:
              items.length === 0
                ? 'ウォッチしている銘柄はありません。'
                : ['# ウォッチリスト', '', ...lines].join('\n'),
          },
        };
      },
    },

    'stock.position_risk': {
      async execute(input) {
        const positions = (await domain.list(input.tenantId, STOCK_PLUGIN, 'position', 500)).map(
          toPosition,
        );
        const rows = concentration(positions);
        const incomplete = rows.some((row) => row.share === null);

        const lines = rows.map((row) =>
          row.share === null
            ? `- ${row.symbol}: 取得単価が入っていないため、割合を出せません`
            : `- ${row.symbol}: ${(row.share * 100).toFixed(1)}%`,
        );

        return {
          result: { positions: rows.length, complete: !incomplete },
          detail: `${rows.length} 銘柄`,
          artifact: {
            title: '保有の偏り',
            markdown: [
              '# 保有の偏り',
              '',
              ...(rows.length === 0 ? ['保有はありません。'] : lines),
              '',
              // **推奨しない。**数字を出すところまで。
              '※ 数字を並べたものです。売買の判断は含みません。',
            ].join('\n'),
          },
        };
      },
    },

    'stock.draft_order': {
      async execute(input, step) {
        const side = asString(value(input, step, 'side'));
        const orderType = asString(value(input, step, 'order_type'));
        const draft: OrderDraft = {
          symbol: asString(value(input, step, 'symbol')),
          side: side === 'BUY' || side === 'SELL' ? (side as Side) : null,
          quantity: asNumber(value(input, step, 'quantity')),
          orderType:
            orderType === 'MARKET' || orderType === 'LIMIT' ? (orderType as OrderType) : null,
          limitPrice: asNumber(value(input, step, 'limit_price')),
        };

        const problems = orderProblems(draft);
        if (problems.length > 0) {
          /*
           * **欠けたまま確認だけ取らない。**
           * 読み上げに「未入力」が混ざったら、それは読み上げになっていない。
           */
          throw new AstraError('common.validation_failed', problems.join(' / '));
        }

        const note = asString(value(input, step, 'note'));
        if (note !== null && containsRecommendation(note)) {
          throw new AstraError(
            'common.validation_failed',
            'この下書きに売買の推奨が含まれています',
          );
        }

        const readback = orderReadback(draft);
        return {
          result: { readback, ...draft },
          // 承認カードに出る文はここで作る。§15.7 の readback。
          detail: readback,
          artifact: {
            title: '注文の下書き',
            markdown: [
              '# 注文の下書き',
              '',
              readback,
              '',
              '※ 下書きです。**発注はしていません。**証券会社へは繋がっていません。',
            ].join('\n'),
          },
        };
      },
    },
  };
}
