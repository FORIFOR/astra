/**
 * Plugin が持ち込む Dashboard。正本 §14.1、Phase 4 実装仕様 §3。
 *
 * **任意の HTML/JS を読み込ませない**（正本 §14.1、D-32）。
 * plugin が書けるのは「どの component に、どのデータを結ぶか」だけで、
 * 描画は Core UI Kit が行う。plugin が Core UI を壊せない形にしておく。
 */
import { z } from 'zod';

/** 正本 §14.1 の固定集合。ここに無い type は描かない。 */
export const DASHBOARD_COMPONENTS = [
  'metric',
  'text',
  'table',
  'chart',
  'timeline',
  'kanban',
  'entity-list',
  'entity-detail',
  'action-button',
  'approval-card',
  'file-preview',
] as const;

export const DashboardComponent = z.enum(DASHBOARD_COMPONENTS);
export type DashboardComponent = z.infer<typeof DashboardComponent>;

/** `<namespace>.<name>`。plugin が宣言した data source を指す。 */
export const BindRef = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'bind must look like "namespace.name"');

export const DashboardItem = z.object({
  type: DashboardComponent,
  /** 見出し。無ければ component 側の既定に任せる。 */
  title: z.string().max(100).optional(),
  /** 何を見せるか。text と action-button 以外は必須（下の refine で強制）。 */
  bind: BindRef.optional(),
  /** grid の占有幅（1〜12）。 */
  span: z.number().int().min(1).max(12).optional(),
  /** text の本文。plugin が書けるのは**平文だけ**。 */
  body: z.string().max(2_000).optional(),
  /** action-button が呼ぶ tool。risk 判定は host 側の規則に従う。 */
  tool: z.string().max(100).optional(),
});
export type DashboardItem = z.infer<typeof DashboardItem>;

/** データを要らない component。ここ以外は bind が要る。 */
const DATALESS = new Set<DashboardComponent>(['text', 'action-button']);

export const DashboardSchema = z
  .object({
    id: z.string().min(1).max(64),
    title: z.string().min(1).max(100),
    layout: z.enum(['grid', 'stack']).default('grid'),
    items: z.array(DashboardItem).min(1).max(24),
  })
  .superRefine((schema, ctx) => {
    for (const [i, item] of schema.items.entries()) {
      if (!DATALESS.has(item.type) && item.bind === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'bind'],
          message: `${item.type} needs a bind`,
        });
      }
      if (item.type === 'text' && !item.body) {
        ctx.addIssue({ code: 'custom', path: ['items', i, 'body'], message: 'text needs a body' });
      }
      if (item.type === 'action-button' && !item.tool) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'tool'],
          message: 'action-button needs a tool',
        });
      }
    }
  });
export type DashboardSchema = z.infer<typeof DashboardSchema>;

// ------------------------------------------------------------- data source

/**
 * plugin が宣言できるデータの引き方。
 *
 * **任意の SQL を書かせない**（D-33）。SQL を渡させると、
 * テーブル所有権（実装仕様 §5.1）も RLS も意味を失う。
 * `kind` と `query` の組を host 側の許可表で引く。
 */
export const DataSourceKind = z.enum(['count', 'rows', 'series']);
export type DataSourceKind = z.infer<typeof DataSourceKind>;

export const DataSourceDecl = z.object({
  id: BindRef,
  kind: DataSourceKind,
  /**
   * host の許可表にある**名前**。無い名前は publish 時に落とす。
   *
   * 識別子の形に縛るのは、長さ制限では SQL を防げないから。
   * `select * from x` は短く書ける。
   */
  query: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'query must be a plain identifier, not a statement'),
});
export type DataSourceDecl = z.infer<typeof DataSourceDecl>;

// ------------------------------------------------------------- resolved

/** 解決した値。UI はこの形だけを描く。 */
export const ResolvedValue = z.union([
  z.object({ kind: z.literal('count'), value: z.number() }),
  z.object({
    kind: z.literal('rows'),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  }),
  z.object({
    kind: z.literal('series'),
    points: z.array(z.object({ label: z.string(), value: z.number() })),
  }),
  /**
   * 解決できなかった。**0 や空表として描かない**（D-34）。
   * 「データが無い」と「壊れている」を混ぜると、誰も気づけなくなる。
   */
  z.object({ kind: z.literal('unavailable'), reason: z.string() }),
]);
export type ResolvedValue = z.infer<typeof ResolvedValue>;

export const DashboardView = z.object({
  plugin_id: z.string(),
  schema: DashboardSchema,
  /** bind → 値。schema の item が指す先。 */
  data: z.record(z.string(), ResolvedValue),
});
export type DashboardView = z.infer<typeof DashboardView>;
