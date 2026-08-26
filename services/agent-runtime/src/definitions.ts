/**
 * plugin が持ち込んだ entity 定義を引く。Phase 5 実装仕様 §5。
 *
 * 定義の実体は `data_extensions` が指すファイル。**publish 時に検証済み**
 * のものを読むだけで、ここで信用の判断はしない。
 */
import { EntityDef } from '@astra/contracts';

/** plugin の asset を読む口。registry が実装を渡す。 */
export interface AssetReader {
  /** install 済みなら中身、そうでなければ null。 */
  read(tenantId: string, pluginId: string, path: string): Promise<Buffer | null>;
  /** その plugin が宣言した data_extensions のパス。 */
  extensions(tenantId: string, pluginId: string): Promise<string[]>;
}

/**
 * `(tenantId, pluginId, entityType) → EntityDef | null`。
 *
 * 見つからなければ null。**そこで作り話をしない**。
 * 定義を知らずに値を受けると、何でも書き込める口になる。
 */
export function entityDefinitions(assets: AssetReader) {
  return async (
    tenantId: string,
    pluginId: string,
    entityType: string,
  ): Promise<EntityDef | null> => {
    const paths = await assets.extensions(tenantId, pluginId);
    for (const path of paths) {
      const content = await assets.read(tenantId, pluginId, path);
      if (!content) continue;

      let document: unknown;
      try {
        document = JSON.parse(content.toString('utf8'));
      } catch {
        // 壊れた定義は無いものとして扱う。推測で補わない。
        continue;
      }

      const list = (document as { entities?: unknown }).entities;
      if (!Array.isArray(list)) continue;

      for (const raw of list) {
        const parsed = EntityDef.safeParse(raw);
        if (parsed.success && parsed.data.id === entityType) return parsed.data;
      }
    }
    return null;
  };
}
