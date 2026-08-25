/**
 * DB スキーマ型。`src/generated/schema.ts` は `infra/db/schema.sql` から
 * kysely-codegen で生成する。手で編集しない（ADR 0002）。
 */
export type { DB as Database } from './generated/schema.js';
export type * from './generated/schema.js';
