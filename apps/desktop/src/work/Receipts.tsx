/**
 * 受け取りの控え。UI/UX §22・§14.1、§9.2 Outputs。
 *
 * 監査ログは管理者のもの。**本人には「何をしたか」を人の言葉で見せる。**
 * 文面は承認したときに読んだものが正で、承認が要らなかった操作には
 * 文面が無い。**無いものを、それらしい文で埋めない。**
 */
import { useEffect, useState, type ReactElement } from 'react';
import { isReversible, type ActionReceiptView, type ActionRisk } from '@astra/contracts';
import type { AstraClient } from '@astra/api-client';

/** §14 の Risk を、利用者の言葉にする。tool 名も内部の enum も出さない。 */
const RISK_LABEL: Record<ActionRisk, string> = {
  READ: '参照',
  REVERSIBLE_WRITE: '下書き・変更（取り消せます）',
  EXTERNAL_COMMIT: '外部への送信',
  DESTRUCTIVE: '削除',
  REGULATED: '規制対象の記録',
  FINANCIAL: '金銭の処理',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ReceiptList({
  receipts,
  now = new Date(),
}: {
  receipts: readonly ActionReceiptView[];
  now?: Date;
}): ReactElement {
  if (receipts.length === 0) {
    return <p className="astra-empty">この仕事では、外部への操作はまだありません。</p>;
  }

  return (
    <ul className="astra-receipts" aria-label="実行した操作の控え">
      {receipts.map((receipt) => (
        <li key={receipt.id} className="astra-receipt" data-risk={receipt.risk}>
          <p className="astra-receipt__what">
            {/* 承認時に読んだ文面が正。無ければ無いと言う。 */}
            {receipt.summary ?? '確認を必要としない操作でした'}
          </p>
          <p className="astra-receipt__meta">
            <span>{when(receipt.executed_at)}</span>
            {/* §19: 種類を色だけで表さない */}
            <span className="astra-receipt__risk">{RISK_LABEL[receipt.risk]}</span>
            <span>
              {receipt.approved_by_name === null
                ? '確認は不要でした'
                : `${receipt.approved_by_name} が確認しました`}
            </span>
          </p>
          <p className="astra-receipt__recovery">
            {isReversible(receipt, now)
              ? `${when(receipt.reversible_until!)} まで取り消せます`
              : '取り消しはできません'}
          </p>
          {/* 技術的な識別子は、掘ったときにだけ出す（§9.2 Activity） */}
          <details className="astra-receipt__detail">
            <summary>詳しい記録</summary>
            <dl>
              <dt>操作</dt>
              <dd>{receipt.tool_id}</dd>
              <dt>実行したもの</dt>
              <dd>{receipt.actor === 'user' ? 'あなた' : 'Astra'}</dd>
              {receipt.result_ref !== null && (
                <>
                  <dt>結果</dt>
                  <dd>{receipt.result_ref}</dd>
                </>
              )}
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}

/** 取ってきて出す。取れなかったことを黙って空にしない（§21）。 */
export function Receipts({
  client,
  taskId,
}: {
  client: AstraClient | null;
  taskId: string | null;
}): ReactElement | null {
  const [receipts, setReceipts] = useState<readonly ActionReceiptView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !taskId) {
      setReceipts(null);
      return;
    }
    let cancelled = false;
    setError(null);
    void client
      .taskReceipts(taskId)
      .then((items) => {
        if (!cancelled) setReceipts(items);
      })
      .catch((cause: unknown) => {
        // 空と「取れなかった」は違う。取り違えると「何もしていない」ように見える。
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [client, taskId]);

  if (!taskId) return null;
  if (error !== null) {
    return (
      <p className="astra-empty" role="alert">
        操作の控えを読み込めませんでした。{error}
      </p>
    );
  }
  if (receipts === null) return <p className="astra-empty">読み込んでいます。</p>;
  return <ReceiptList receipts={receipts} />;
}
