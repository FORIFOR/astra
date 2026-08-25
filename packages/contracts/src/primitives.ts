/** 共通スカラー。実装仕様 §1.3。 */
import { z } from 'zod';

/** RFC3339 / UTC。保存は timestamptz、表現は常に UTC。 */
export const Timestamp = z.iso.datetime({ offset: false });
export type Timestamp = z.infer<typeof Timestamp>;

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'must be lowercase sha256 hex');
export type Sha256Hex = z.infer<typeof Sha256Hex>;

/** 任意の JSON。keys は codec で変換されない不透明領域として扱う（§codec）。 */
export const JsonObject = z.record(z.string(), z.unknown());
export type JsonObject = z.infer<typeof JsonObject>;

export const Semver = z.string().regex(/^\d+\.\d+\.\d+$/, 'must be MAJOR.MINOR.PATCH');
export type Semver = z.infer<typeof Semver>;

/** semver 比較。a < b で負、a === b で 0、a > b で正。 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** カーソルページング。UUIDv7 の時系列性を利用し、id をそのままカーソルにする。 */
export const PageQuery = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const pageResponse = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), next_cursor: z.uuid().nullable() });
