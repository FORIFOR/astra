/**
 * Stock Research。正本 §15.7。
 *
 * 仕様の Execution はこう言っている:
 *   - default = research / draft order only
 *   - broker order = FINANCIAL policy
 *   - explicit confirmation
 *   - **amount / price / order-type readback**
 *   - audit
 *
 * ここで守るのは、読み上げの中身が**欠けないこと**。
 * 「数量が未入力のまま確認だけ取る」が、いちばん危ない形。
 */
import type { DomainEntity } from '@astra/contracts';

export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';

export interface OrderDraft {
  readonly symbol: string | null;
  readonly side: Side | null;
  readonly quantity: number | null;
  readonly orderType: OrderType | null;
  /** 指値のときだけ要る。 */
  readonly limitPrice: number | null;
}

function text(entity: DomainEntity, field: string): string | null {
  const value = entity.fields[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(entity: DomainEntity, field: string): number | null {
  const value = entity.fields[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function toOrderDraft(entity: DomainEntity): OrderDraft {
  const side = text(entity, 'side');
  const orderType = text(entity, 'order_type');
  return {
    symbol: text(entity, 'symbol'),
    side: side === 'BUY' || side === 'SELL' ? side : null,
    quantity: num(entity, 'quantity'),
    orderType: orderType === 'MARKET' || orderType === 'LIMIT' ? orderType : null,
    limitPrice: num(entity, 'limit_price'),
  };
}

/**
 * 下書きとして成立しているか。
 *
 * **1 つでも欠けていたら下書きにしない。**
 * 欠けたまま確認だけ取ると、読み上げに「未入力」が混ざる。
 * それは読み上げになっていない。
 */
export function orderProblems(draft: OrderDraft): string[] {
  const problems: string[] = [];
  if (!draft.symbol) problems.push('銘柄が入っていません');
  if (!draft.side) problems.push('売りか買いかが入っていません');
  if (draft.quantity === null) problems.push('数量が入っていません');
  else if (draft.quantity <= 0) problems.push('数量が 0 以下です');
  if (!draft.orderType) problems.push('注文の種別が入っていません');
  // 指値なのに価格が無いのは、成行と区別が付かない
  if (draft.orderType === 'LIMIT' && draft.limitPrice === null) {
    problems.push('指値なのに価格が入っていません');
  }
  if (draft.orderType === 'MARKET' && draft.limitPrice !== null) {
    // 成行に価格が付いていると、どちらで出るのか読めない
    problems.push('成行なのに価格が入っています');
  }
  return problems;
}

const SIDE_LABEL: Record<Side, string> = { BUY: '買い', SELL: '売り' };
const TYPE_LABEL: Record<OrderType, string> = { MARKET: '成行', LIMIT: '指値' };

/**
 * 読み上げ文。正本 §15.7「amount/price/order-type readback」。
 *
 * **欠けている下書きからは作らない。**作れないものを作ると、
 * 読み上げたのに中身が無い、という最悪の形になる。
 */
export function orderReadback(draft: OrderDraft): string {
  const problems = orderProblems(draft);
  if (problems.length > 0) {
    throw new Error(`読み上げできません: ${problems.join(' / ')}`);
  }
  const price =
    draft.orderType === 'LIMIT' ? `${draft.limitPrice} で` : '成行（価格は約定時に決まります）で';
  return `${draft.symbol} を ${draft.quantity} 株、${price}${SIDE_LABEL[draft.side!]}ます（${TYPE_LABEL[draft.orderType!]}）。`;
}

export interface Position {
  readonly symbol: string;
  readonly quantity: number;
  readonly averagePrice: number | null;
}

export function toPosition(entity: DomainEntity): Position {
  return {
    symbol: text(entity, 'symbol') ?? '不明',
    quantity: num(entity, 'quantity') ?? 0,
    averagePrice: num(entity, 'average_price'),
  };
}

export interface Concentration {
  readonly symbol: string;
  readonly value: number | null;
  /** 全体に占める割合。取得単価の無い銘柄があると出せない。 */
  readonly share: number | null;
}

/**
 * 保有の偏り。
 *
 * **単価の無い銘柄が 1 つでもあれば、割合を出さない。**
 * 分母が欠けたまま割合を出すと、実際より小さく見える。
 */
export function concentration(positions: readonly Position[]): Concentration[] {
  const valued = positions.map((position) => ({
    symbol: position.symbol,
    value: position.averagePrice === null ? null : position.averagePrice * position.quantity,
  }));

  const complete = valued.every((v) => v.value !== null);
  const total = complete ? valued.reduce((sum, v) => sum + v.value!, 0) : 0;

  return (
    valued
      .map((v) => ({
        symbol: v.symbol,
        value: v.value,
        share: complete && total > 0 ? v.value! / total : null,
      }))
      // 大きいものから。単価不明は末尾ではなく先頭に置く（見落とすため）。
      .sort((a, b) => (b.value ?? Number.POSITIVE_INFINITY) - (a.value ?? Number.POSITIVE_INFINITY))
  );
}

/** 推奨の言葉。**下書きや所見に混ざっていないかを見る。** */
const RECOMMENDATION =
  /(買い時|売り時|割安|割高|狙い目|推奨|おすすめ|上がるでしょう|下がるでしょう)/;

export function containsRecommendation(text: string): boolean {
  return RECOMMENDATION.test(text);
}
