import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_COMPONENTS,
  DashboardSchema,
  DataSourceDecl,
  ResolvedValue,
} from '../src/dashboard.js';

const schema = (items: unknown[]) => ({
  id: 'pipeline',
  title: 'パイプライン',
  items,
});

describe('DashboardSchema', () => {
  it('only accepts the components the core knows how to draw', () => {
    // plugin に任意の HTML/JS を持たせない（正本 §14.1、D-32）
    expect(DashboardSchema.safeParse(schema([{ type: 'iframe', bind: 'a.b' }])).success).toBe(
      false,
    );
    expect(DASHBOARD_COMPONENTS).toContain('metric');
    expect(DASHBOARD_COMPONENTS).not.toContain('html');
  });

  it('makes a data component say what it binds to', () => {
    expect(DashboardSchema.safeParse(schema([{ type: 'metric' }])).success).toBe(false);
    expect(
      DashboardSchema.safeParse(schema([{ type: 'metric', bind: 'pipeline.total' }])).success,
    ).toBe(true);
  });

  it('lets text and buttons exist without data, but not without content', () => {
    expect(DashboardSchema.safeParse(schema([{ type: 'text' }])).success).toBe(false);
    expect(DashboardSchema.safeParse(schema([{ type: 'text', body: '説明' }])).success).toBe(true);
    expect(DashboardSchema.safeParse(schema([{ type: 'action-button' }])).success).toBe(false);
    expect(
      DashboardSchema.safeParse(schema([{ type: 'action-button', tool: 'crm.sync' }])).success,
    ).toBe(true);
  });

  it('refuses a bind that is not namespaced', () => {
    for (const bad of ['total', 'Pipeline.Total', 'pipeline.', '.total', 'pipeline..total']) {
      expect(DashboardSchema.safeParse(schema([{ type: 'metric', bind: bad }])).success, bad).toBe(
        false,
      );
    }
  });

  it('refuses an empty dashboard and caps how big one can get', () => {
    expect(DashboardSchema.safeParse(schema([])).success).toBe(false);
    const many = Array.from({ length: 25 }, () => ({ type: 'metric', bind: 'a.b' }));
    expect(DashboardSchema.safeParse(schema(many)).success).toBe(false);
  });

  it('defaults to a grid', () => {
    const parsed = DashboardSchema.parse(schema([{ type: 'metric', bind: 'a.b' }]));
    expect(parsed.layout).toBe('grid');
  });
});

describe('DataSourceDecl', () => {
  it('takes a named query, never raw SQL', () => {
    // SQL を渡させると、テーブル所有権も RLS も意味を失う（D-33）
    expect(
      DataSourceDecl.safeParse({ id: 'pipeline.total', kind: 'count', query: 'opportunities' })
        .success,
    ).toBe(true);
    // 長さでは防げない。`select * from x` は短く書ける。
    for (const bad of ['select * from opportunities', 'drop table x', 'a; b', 'Opportunities']) {
      expect(
        DataSourceDecl.safeParse({ id: 'pipeline.total', kind: 'count', query: bad }).success,
        bad,
      ).toBe(false);
    }
  });
});

describe('ResolvedValue', () => {
  it('has a shape for "could not resolve" that is not zero', () => {
    // 0 で描くと「無い」と「壊れている」が区別できなくなる（D-34）
    expect(
      ResolvedValue.safeParse({ kind: 'unavailable', reason: 'no such data source' }).success,
    ).toBe(true);
    expect(ResolvedValue.safeParse({ kind: 'count', value: 0 }).success).toBe(true);
  });
});
