/**
 * Plugin が持ち込む entity の定義。正本 §14、Phase 5 実装仕様 §3。
 *
 * **plugin ごとに DDL を走らせない**（D-41）。migration をユーザ入力にすると、
 * そこが最大の攻撃面になる。実体は単一表に jsonb で入れ、
 * 型と必須はここの定義に照らして検査する。
 */
import { z } from 'zod';

export const FieldType = z.enum(['text', 'number', 'date', 'boolean', 'enum', 'reference']);
export type FieldType = z.infer<typeof FieldType>;

export const FieldDef = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'a field id must be a plain identifier'),
    title: z.string().max(100).optional(),
    type: FieldType,
    required: z.boolean().default(false),
    /** enum のとき。 */
    values: z.array(z.string().min(1).max(64)).max(32).optional(),
    /** reference のとき。指す先の entity 型。 */
    entity: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'enum' && (!field.values || field.values.length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['values'], message: 'enum needs its values' });
    }
    if (field.type === 'reference' && !field.entity) {
      ctx.addIssue({ code: 'custom', path: ['entity'], message: 'reference needs an entity' });
    }
  });
export type FieldDef = z.infer<typeof FieldDef>;

export const EntityDef = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'an entity id must be a plain identifier'),
    title: z.string().min(1).max(100),
    /** 一覧の見出しに使う field。無ければ id を出す。 */
    title_field: z.string().optional(),
    fields: z.array(FieldDef).min(1).max(50),
  })
  .superRefine((entity, ctx) => {
    const ids = new Set<string>();
    for (const [i, field] of entity.fields.entries()) {
      if (ids.has(field.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', i, 'id'],
          message: `duplicate field "${field.id}"`,
        });
      }
      ids.add(field.id);
    }
    if (entity.title_field && !ids.has(entity.title_field)) {
      ctx.addIssue({
        code: 'custom',
        path: ['title_field'],
        message: `title_field "${entity.title_field}" is not one of the fields`,
      });
    }
  });
export type EntityDef = z.infer<typeof EntityDef>;

export const DomainEntity = z.object({
  id: z.uuid(),
  plugin_id: z.string(),
  entity_type: z.string(),
  title: z.string(),
  fields: z.record(z.string(), z.unknown()),
  source_task_id: z.string().nullable(),
  source_meeting_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type DomainEntity = z.infer<typeof DomainEntity>;

export interface FieldProblem {
  readonly field: string;
  readonly message: string;
}

/**
 * 値を定義に照らして検査する。
 *
 * **定義に無い field は落とす。**通すと、plugin が任意の形を書き込めることになり、
 * 定義がある意味が無くなる。
 */
export function validateFields(
  def: EntityDef,
  value: Record<string, unknown>,
): { fields: Record<string, unknown>; problems: FieldProblem[] } {
  const problems: FieldProblem[] = [];
  const out: Record<string, unknown> = {};

  for (const field of def.fields) {
    const raw = value[field.id];

    if (raw === undefined || raw === null || raw === '') {
      if (field.required) {
        problems.push({ field: field.id, message: `${field.id} is required` });
      }
      continue;
    }

    switch (field.type) {
      case 'text':
      case 'reference':
        if (typeof raw !== 'string') {
          problems.push({ field: field.id, message: `${field.id} must be text` });
          continue;
        }
        out[field.id] = raw;
        break;

      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) {
          problems.push({ field: field.id, message: `${field.id} must be a number` });
          continue;
        }
        out[field.id] = n;
        break;
      }

      case 'boolean':
        if (typeof raw !== 'boolean') {
          problems.push({ field: field.id, message: `${field.id} must be true or false` });
          continue;
        }
        out[field.id] = raw;
        break;

      case 'date': {
        // 文字列として受けるが、**日付として読めることを確かめる**
        const parsed = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
        if (Number.isNaN(parsed)) {
          problems.push({ field: field.id, message: `${field.id} must be a date` });
          continue;
        }
        out[field.id] = raw;
        break;
      }

      case 'enum':
        if (typeof raw !== 'string' || !(field.values ?? []).includes(raw)) {
          problems.push({
            field: field.id,
            message: `${field.id} must be one of ${(field.values ?? []).join(', ')}`,
          });
          continue;
        }
        out[field.id] = raw;
        break;
    }
  }

  return { fields: out, problems };
}

/** 一覧の見出し。`title_field` が無ければ、最初の text field に落ちる。 */
export function titleOf(def: EntityDef, fields: Record<string, unknown>): string {
  const named = def.title_field ? fields[def.title_field] : undefined;
  if (typeof named === 'string' && named.length > 0) return named;
  for (const field of def.fields) {
    const value = fields[field.id];
    if (field.type === 'text' && typeof value === 'string' && value.length > 0) return value;
  }
  return def.title;
}
