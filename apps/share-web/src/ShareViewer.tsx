/**
 * 共有された成果物の viewer。正本 §2.3、Phase 2 実装仕様 §2。
 *
 * ここは**組織の外の人**が見る画面。Astra の中身を説明しない。
 * テナント名も所有者も出さない（サーバがそもそも返さない）。
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  PublicShareClient,
  ShareUnavailableError,
  isRenderable,
  type UnlockedShare,
} from '@astra/api-client';

type Phase = 'opening' | 'needs-input' | 'open' | 'unavailable' | 'no-link';

export function ShareViewer({
  client,
  hash = globalThis.location?.hash ?? '',
}: {
  client: PublicShareClient;
  hash?: string;
}): ReactElement {
  const [phase, setPhase] = useState<Phase>('opening');
  const [share, setShare] = useState<UnlockedShare | null>(null);
  const [text, setText] = useState<string | null>(null);
  /** 直前の試行が失敗したか。理由は持たない（サーバが区別して返さない）。 */
  const [lastAttemptFailed, setLastAttemptFailed] = useState(false);
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');

  const token = PublicShareClient.tokenFromLocation(hash);

  const open = useCallback(
    async (options: { password?: string; email?: string } = {}): Promise<void> => {
      if (!token) {
        setPhase('no-link');
        return;
      }
      try {
        const unlocked = await client.unlock(token, options);
        setShare(unlocked);
        setLastAttemptFailed(false);
        setPhase('open');
        if (isRenderable(unlocked.artifact.mime_type)) {
          setText(await (await client.content(unlocked.viewToken)).text());
        }
      } catch (error) {
        // 試行が絞られたときだけ行き止まりにする。
        // それ以外は入力に戻す — 打ち間違いで開けなくなるのは体験として悪い。
        if (error instanceof ShareUnavailableError && error.rateLimited) {
          setPhase('unavailable');
          return;
        }
        setLastAttemptFailed(true);
        setPhase('needs-input');
      }
    },
    [client, token],
  );

  useEffect(() => {
    void open();
    // 初回だけ。フラグメントは変わらない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void open({
      ...(password ? { password } : {}),
      ...(email ? { email } : {}),
    });
  };

  if (phase === 'no-link') {
    return (
      <main className="share">
        <h1 className="share__title">リンクが見つかりません</h1>
        <p className="share__note">共有リンクをもう一度開いてください。</p>
      </main>
    );
  }

  if (phase === 'opening') {
    return (
      <main className="share">
        <p role="status">開いています…</p>
      </main>
    );
  }

  if (phase === 'unavailable') {
    return (
      <main className="share">
        <h1 className="share__title">このリンクは開けません</h1>
        <p className="share__note" role="alert">
          試行が多すぎます。しばらく待ってからもう一度お試しください。
        </p>
      </main>
    );
  }

  if (phase === 'needs-input') {
    return (
      <main className="share">
        <h1 className="share__title">確認が必要です</h1>
        {lastAttemptFailed && (
          // 理由を書き分けない。書き分けると、有効なリンクの存在を教えることになる。
          <p className="share__note" role="alert">
            開けませんでした。入力を確かめるか、共有した相手にご確認ください。
          </p>
        )}
        <form className="share__form" onSubmit={onSubmit}>
          <label className="share__field">
            <span>パスワード</span>
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="share__field">
            <span>メールアドレス（求められている場合）</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button type="submit">開く</button>
        </form>
      </main>
    );
  }

  const artifact = share!.artifact;
  return (
    <main className="share" data-watermark={artifact.policy.watermark ? 'true' : 'false'}>
      {/*
       * §22・§10.2: 共有の条件を header に出す。
       * **黙って切れる方が、切れると言うより悪い。**
       */}
      <header className="share__header">
        <h1 className="share__title">{artifact.title}</h1>
        <p className="share__meta">
          {new Date(artifact.created_at).toLocaleDateString('ja-JP')} · {artifact.mime_type}
        </p>
        <ul className="share__terms" aria-label="この共有の条件">
          <li>{new Date(artifact.expires_at).toLocaleString('ja-JP')} まで開けます</li>
          {artifact.one_time && <li>このリンクは一度きりです。閉じると開けなくなります</li>}
          {artifact.requires_password && <li>合言葉で保護されています</li>}
          <li>
            {artifact.policy.allow_download ? 'ダウンロードできます' : 'ダウンロードはできません'}
          </li>
        </ul>
      </header>

      {text !== null ? (
        <pre className="share__body">{text}</pre>
      ) : (
        <p className="share__note">この形式はここでは表示できません。</p>
      )}

      {artifact.policy.allow_download ? (
        <button
          type="button"
          className="share__download"
          onClick={() => {
            void (async () => {
              const blob = await client.content(share!.viewToken);
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = artifact.title;
              link.click();
              URL.revokeObjectURL(url);
            })();
          }}
        >
          ダウンロード
        </button>
      ) : (
        <p className="share__note">この共有ではダウンロードできません。</p>
      )}
    </main>
  );
}
