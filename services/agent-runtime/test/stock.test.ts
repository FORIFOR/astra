/**
 * Stock Research。正本 §15.7。
 *
 * いちばん危ない形は「数量が未入力のまま確認だけ取る」。
 * **読み上げの中身が欠けないこと**を確かめる。
 */
import { describe, expect, it } from 'vitest';
import {
  concentration,
  containsRecommendation,
  orderProblems,
  orderReadback,
  type OrderDraft,
  type Position,
} from '../src/stock.js';

const draft = (over: Partial<OrderDraft> = {}): OrderDraft => ({
  symbol: '7203',
  side: 'BUY',
  quantity: 100,
  orderType: 'LIMIT',
  limitPrice: 2_500,
  ...over,
});

describe('an order draft', () => {
  it('is not a draft while anything is missing', () => {
    expect(orderProblems(draft({ quantity: null }))).toContain('数量が入っていません');
    expect(orderProblems(draft({ side: null }))).toContain('売りか買いかが入っていません');
    expect(orderProblems(draft({ orderType: null }))).toContain('注文の種別が入っていません');
    expect(orderProblems(draft({ symbol: null }))).toContain('銘柄が入っていません');
  });

  it('refuses a limit order with no price', () => {
    // 価格の無い指値は、成行と区別が付かない
    expect(orderProblems(draft({ limitPrice: null }))).toContain('指値なのに価格が入っていません');
  });

  it('refuses a market order that carries a price', () => {
    expect(orderProblems(draft({ orderType: 'MARKET' }))).toContain('成行なのに価格が入っています');
  });

  it('refuses a quantity of zero', () => {
    expect(orderProblems(draft({ quantity: 0 }))).toContain('数量が 0 以下です');
  });

  it('accepts one that is complete', () => {
    expect(orderProblems(draft())).toEqual([]);
    expect(orderProblems(draft({ orderType: 'MARKET', limitPrice: null }))).toEqual([]);
  });
});

describe('the readback (§15.7)', () => {
  it('says the amount, the price and the order type', () => {
    const spoken = orderReadback(draft());
    expect(spoken).toContain('7203');
    expect(spoken).toContain('100 株');
    expect(spoken).toContain('2500');
    expect(spoken).toContain('指値');
    expect(spoken).toContain('買い');
  });

  it('says the price is not fixed for a market order', () => {
    const spoken = orderReadback(draft({ orderType: 'MARKET', limitPrice: null }));
    expect(spoken).toContain('約定時に決まります');
  });

  it('refuses to speak an incomplete order', () => {
    // 読み上げたのに中身が無い、がいちばん悪い
    expect(() => orderReadback(draft({ quantity: null }))).toThrow(/読み上げできません/);
  });
});

describe('concentration', () => {
  const position = (symbol: string, quantity: number, averagePrice: number | null): Position => ({
    symbol,
    quantity,
    averagePrice,
  });

  it('shows the biggest holding first', () => {
    const rows = concentration([position('A', 10, 100), position('B', 10, 500)]);
    expect(rows.map((r) => r.symbol)).toEqual(['B', 'A']);
    expect(rows[0]!.share).toBeCloseTo(5 / 6);
  });

  it('gives no share at all when one holding has no price', () => {
    // 分母が欠けたまま割合を出すと、実際より小さく見える
    const rows = concentration([position('A', 10, 100), position('B', 10, null)]);
    for (const row of rows) expect(row.share).toBeNull();
  });

  it('puts the unpriced holding where it will be noticed', () => {
    const rows = concentration([position('A', 10, 100), position('B', 10, null)]);
    expect(rows[0]!.symbol).toBe('B');
  });
});

describe('what the analyst must not say', () => {
  it('spots a recommendation', () => {
    expect(containsRecommendation('いまが買い時です')).toBe(true);
    expect(containsRecommendation('割安と判断されます')).toBe(true);
    expect(containsRecommendation('おすすめです')).toBe(true);
  });

  it('lets plain figures through', () => {
    expect(containsRecommendation('前期比 12% の増収。出典: 決算短信')).toBe(false);
  });
});
