/**
 * 共有の状態。UI/UX §10.2・§22。
 *
 * §10.2 は「共有状態は artifact header に**常時可視化**する」、
 * §22 は「public/off・expiry・password・download 可否を header に表示」と言う。
 *
 * **既定オフを、常にオフと書いてはいけない。**
 * 実際に共有されているものを「オフ」と表示すると、
 * 出したつもりのないものが出ている状態に気付けない。
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { Share } from '@astra/contracts';
import type { AstraClient } from '@astra/api-client';

/** いま効いている共有だけ。期限切れ・失効・消費済みは「共有中」ではない。 */
export function activeShares(shares: readonly Share[], now: Date = new Date()): Share[] {
  return shares.filter(
    (share) =>
      share.revoked_at === null && share.consumed_at === null && new Date(share.expires_at) > now,
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ShareState({
  shares,
  now = new Date(),
}: {
  shares: readonly Share[] | null;
  now?: Date;
}): ReactElement {
  // まだ分からない状態を「オフ」と言わない
  if (shares === null) {
    return <p className="astra-library__share">共有: 確認しています</p>;
  }

  const live = activeShares(shares, now);
  if (live.length === 0) {
    return <p className="astra-library__share">共有: オフ</p>;
  }

  return (
    <section className="astra-library__share" aria-label="共有の状態">
      <p className="astra-library__share-on">
        共有: オン{live.length > 1 ? `（${live.length} 件のリンク）` : ''}
      </p>
      <ul>
        {live.map((share) => (
          <li key={share.id}>
            <span>{when(share.expires_at)} まで</span>
            {/* §22: 合言葉とダウンロード可否も header で言う */}
            <span>{share.policy.requires_password ? '合言葉あり' : '合言葉なし'}</span>
            <span>{share.policy.allow_download ? 'ダウンロード可' : 'ダウンロード不可'}</span>
            {share.policy.one_time && <span>一度きり</span>}
            {share.access_count > 0 && <span>{share.access_count} 回開かれました</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 取ってきて出す。取れなかったことを「オフ」にしない（§21）。 */
export function ArtifactShareState({
  client,
  artifactId,
}: {
  client: AstraClient | null;
  artifactId: string;
}): ReactElement {
  const [shares, setShares] = useState<readonly Share[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) {
      // 繋がっていないときは、状態を知らないと言う
      setShares(null);
      return;
    }
    let cancelled = false;
    setShares(null);
    setError(null);
    void client
      .artifactShares(artifactId)
      .then((items) => {
        if (!cancelled) setShares(items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [client, artifactId]);

  if (error !== null) {
    return (
      <p className="astra-library__share" role="alert">
        共有の状態を確認できませんでした。{error}
      </p>
    );
  }
  return <ShareState shares={shares} />;
}
