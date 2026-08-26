/**
 * Library。UI/UX §10。
 *
 * ファイルブラウザではなく **Artifact memory**。
 * 「どこに保存された？」を探させないのが役割なので、
 * どの仕事から生まれたか（lineage）を必ず辿れるようにする。
 */
import { useMemo, useState, type ReactElement } from 'react';
import { ArtifactType, type Artifact } from '@astra/contracts';
import '../library/library.css';

/** §10.1 の Type chips。 */
export const LIBRARY_TYPE_CHIPS = [
  { id: 'ALL', label: 'すべて' },
  { id: 'MEETING_BUNDLE', label: '会議' },
  { id: 'REPORT', label: 'レポート' },
  { id: 'DOCUMENT', label: '資料' },
  { id: 'IMAGE', label: '画像' },
  { id: 'VIDEO', label: '動画' },
  { id: 'OTHER', label: 'その他' },
] as const;

export type LibraryChip = (typeof LIBRARY_TYPE_CHIPS)[number]['id'];

/** chip に載っていない type は「その他」へ寄せる。取りこぼしを作らない。 */
export function matchesChip(type: Artifact['type'], chip: LibraryChip): boolean {
  if (chip === 'ALL') return true;
  if (chip === 'OTHER') {
    const named = LIBRARY_TYPE_CHIPS.map((c) => c.id).filter(
      (id) => id !== 'ALL' && id !== 'OTHER',
    ) as readonly string[];
    return !named.includes(type);
  }
  return type === chip;
}

export function LibraryPage({
  artifacts = [],
  selectedId = null,
  onSelect,
  onOpenTask,
}: {
  artifacts?: readonly Artifact[];
  selectedId?: string | null;
  onSelect?(artifactId: string): void;
  onOpenTask?(taskId: string): void;
}): ReactElement {
  const [chip, setChip] = useState<LibraryChip>('ALL');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return artifacts.filter(
      (a) =>
        matchesChip(a.type, chip) &&
        (needle.length === 0 || a.title.toLowerCase().includes(needle)),
    );
  }, [artifacts, chip, query]);

  const selected = artifacts.find((a) => a.id === selectedId) ?? null;

  return (
    <section className="astra-library" aria-label="ライブラリ">
      <div className="astra-library__controls">
        <label className="astra-library__search">
          <span className="astra-visually-hidden">成果物を検索</span>
          <input
            type="search"
            // §10.1: 自然文で探せることを示す
            placeholder="先月のA社の決定事項"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="astra-library__chips" role="group" aria-label="種類">
          {LIBRARY_TYPE_CHIPS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={chip === option.id}
              onClick={() => setChip(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="astra-library__body">
        {visible.length === 0 ? (
          <p className="astra-empty">
            {artifacts.length === 0
              ? 'まだ成果物はありません。仕事を1つ頼むとここに残ります。'
              : '該当する成果物はありません。'}
          </p>
        ) : (
          <ul className="astra-library__grid">
            {visible.map((artifact) => (
              <li key={artifact.id}>
                <button
                  type="button"
                  className="astra-artifact"
                  aria-current={artifact.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect?.(artifact.id)}
                >
                  <span className="astra-artifact__title">{artifact.title}</span>
                  <span className="astra-artifact__meta">
                    {artifact.type} · {new Date(artifact.created_at).toLocaleDateString('ja-JP')}
                  </span>
                  {/* §5.2 と同じ考え方: 機密は色だけでなく文字でも示す */}
                  {artifact.sensitivity !== 'PRIVATE' && (
                    <span className="astra-artifact__flag">{artifact.sensitivity}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <aside className="astra-library__preview" aria-label="プレビュー">
            <h3 className="astra-library__preview-title">{selected.title}</h3>
            <dl className="astra-library__facts">
              <dt>種類</dt>
              <dd>{selected.type}</dd>
              <dt>作成</dt>
              <dd>{new Date(selected.created_at).toLocaleString('ja-JP')}</dd>
              <dt>版</dt>
              <dd>v{selected.version}</dd>
            </dl>

            {/* §10.2 Lineage: どの仕事から生まれたかを必ず辿れるようにする */}
            <section className="astra-lineage" aria-label="来歴">
              <h4>来歴</h4>
              {selected.source_task_id ? (
                <button
                  type="button"
                  className="astra-lineage__link"
                  onClick={() => onOpenTask?.(selected.source_task_id!)}
                >
                  この仕事から作られました
                </button>
              ) : (
                <p className="astra-empty">手動で追加されました。</p>
              )}
            </section>

            {/* §10.2: Share は既定 OFF。共有状態は header に常時可視化する */}
            <p className="astra-library__share">共有: オフ</p>
          </aside>
        )}
      </div>
    </section>
  );
}

export { ArtifactType };
