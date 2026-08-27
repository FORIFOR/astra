/**
 * Evidence Ledger。UI/UX §15・§13.2。
 *
 * **常時前面に出さない。**結論の信頼ラベル（L0）だけを出し、
 * 必要なときに 1 段ずつ掘る:
 *
 *   L0  出典数 + 確かさ + 食い違いの数
 *   L1  出典の内訳 + 重みの大きい主張
 *   L2  主張と出典の関係（支える / 食い違う）
 *   L3  出典そのもの（発行日・取得日・原文の場所）
 *
 * 掘る前から全部出すと、読む人は結論を読まなくなる。
 * 掘れないと、根拠が無いのか見せていないだけなのか分からなくなる。
 */
import { useEffect, useState, type ReactElement } from 'react';
import {
  contradictionPairs,
  ledgerHeadline,
  type EvidenceItem,
  type EvidenceLedger as Ledger,
  type EvidenceLevel,
  type SourceType,
} from '@astra/contracts';
import type { AstraClient } from '@astra/api-client';

const SOURCE_LABEL: Record<SourceType, string> = {
  official: '一次情報',
  filing: '公的な届出',
  news: '報道',
  internal: '社内',
  other: 'その他',
};

/** 次に開く段。**飛ばさない。**L0 からいきなり L3 へ行かせない。 */
export function deeper(level: EvidenceLevel): EvidenceLevel {
  switch (level) {
    case 'L0':
      return 'L1';
    case 'L1':
      return 'L2';
    default:
      return 'L3';
  }
}

function when(iso: string | null): string {
  return iso === null ? '日付なし' : new Date(iso).toLocaleDateString('ja-JP');
}

function SourceLine({ item }: { item: EvidenceItem }): ReactElement {
  return (
    <>
      {/* §19: 種類を色だけで表さない */}
      <span className="astra-evidence__type">{SOURCE_LABEL[item.source_type]}</span>
      <span className="astra-evidence__publisher">{item.publisher ?? '発行者不明'}</span>
      {/* L3: いつ書かれたか / いつ取ってきたか。片方だけでは古さを判断できない。 */}
      <span className="astra-evidence__date">
        {when(item.published_at)} 発行・{when(item.retrieved_at)} 取得
      </span>
    </>
  );
}

export function EvidenceLedgerView({
  ledger,
  initialLevel = 'L0',
}: {
  ledger: Ledger;
  /** 見本帳など、開いた状態から描きたいとき。通常は L0 から。 */
  initialLevel?: EvidenceLevel;
}): ReactElement {
  const [level, setLevel] = useState<EvidenceLevel>(initialLevel);
  const pairs = contradictionPairs(ledger);

  return (
    <section className="astra-evidence" aria-label="根拠" data-level={level}>
      {/* L0: ここだけが最初から見えている */}
      <p className="astra-evidence__headline">{ledgerHeadline(ledger)}</p>

      {level === 'L0' && (
        <button
          type="button"
          className="astra-button astra-button--quiet astra-evidence__more"
          onClick={() => setLevel('L1')}
        >
          根拠を見る
        </button>
      )}

      {level !== 'L0' && (
        <div className="astra-evidence__l1">
          <h4>出典の内訳</h4>
          <ul className="astra-evidence__groups">
            {ledger.groups.map((group) => (
              <li key={group.source_type}>
                {SOURCE_LABEL[group.source_type]} {group.count}
              </li>
            ))}
          </ul>
          <h4>重みの大きい主張</h4>
          {ledger.key_claims.length === 0 ? (
            <p className="astra-empty">主張として取り出せたものがありません。</p>
          ) : (
            <ul className="astra-evidence__claims">
              {ledger.key_claims.map((claim) => (
                <li key={claim}>{claim}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(level === 'L2' || level === 'L3') && (
        <div className="astra-evidence__l2">
          <h4>食い違い</h4>
          {pairs.length === 0 ? (
            // 0 件でもそう言う。言わないと、見ていないのか無いのか分からない。
            <p className="astra-empty">食い違いは見つかりませんでした。</p>
          ) : (
            <ul className="astra-evidence__pairs">
              {pairs.map((pair) => (
                <li key={`${pair.left.id}:${pair.right.id}`}>
                  {/* 片方だけを採って消さない。両方見せる（正本 §8.1）。 */}
                  <p className="astra-evidence__claim">{pair.left.claim}</p>
                  <p className="astra-evidence__versus">に対して</p>
                  <p className="astra-evidence__claim">{pair.right.claim}</p>
                </li>
              ))}
            </ul>
          )}
          <h4>主張と出典</h4>
          <ul className="astra-evidence__items">
            {ledger.items.map((item) => (
              <li key={item.id}>
                <p className="astra-evidence__claim">{item.claim}</p>
                <p className="astra-evidence__relation">
                  {item.supports.length > 0 && <span>{item.supports.length} 件を支えます</span>}
                  {item.contradicts.length > 0 && (
                    <span>{item.contradicts.length} 件と食い違います</span>
                  )}
                  {item.supports.length === 0 && item.contradicts.length === 0 && (
                    <span>ほかの主張との関係はありません</span>
                  )}
                </p>
                {level === 'L3' && (
                  <p className="astra-evidence__source">
                    <SourceLine item={item} />
                    {/* L3: 原文の場所。開けるものとして出す。 */}
                    <a href={item.source_url} target="_blank" rel="noreferrer noopener">
                      原文を見る
                    </a>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {level !== 'L0' && level !== 'L3' && (
        <button type="button" onClick={() => setLevel(deeper(level))}>
          {level === 'L1' ? '主張と出典の関係を見る' : '出典そのものを見る'}
        </button>
      )}
      {level !== 'L0' && (
        <button type="button" onClick={() => setLevel('L0')}>
          たたむ
        </button>
      )}
    </section>
  );
}

/** 取ってきて出す。**調査でない仕事と、根拠が無い仕事を混ぜない。** */
export function TaskEvidence({
  client,
  taskId,
}: {
  client: AstraClient | null;
  taskId: string;
}): ReactElement {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [state, setState] = useState<'loading' | 'none' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) {
      setState('loading');
      return;
    }
    let cancelled = false;
    setState('loading');
    void client
      .taskEvidence(taskId)
      .then((next) => {
        if (cancelled) return;
        setLedger(next);
        setState('ready');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        // 「調査ではなかった」と「読めなかった」を分ける
        if (/not_found|404/.test(message)) {
          setState('none');
          return;
        }
        setError(message);
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [client, taskId]);

  if (state === 'loading') return <p className="astra-empty">読み込んでいます。</p>;
  if (state === 'none') {
    return <p className="astra-empty">この仕事は、根拠を集める仕事ではありませんでした。</p>;
  }
  if (state === 'error') {
    return (
      <p className="astra-empty" role="alert">
        根拠を読み込めませんでした。{error}
      </p>
    );
  }
  return <EvidenceLedgerView ledger={ledger!} />;
}
