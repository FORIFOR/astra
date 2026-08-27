/**
 * プレビューからの操作。UI/UX §10.1「download / share は preview から」。
 *
 * 共有は既定オフ（§10.2）。始めるときに期限・合言葉・ダウンロード可否・
 * 宛先を決めさせ、作った URL はその場で一度だけ見せる（保存はハッシュ）。
 */
import { useState, type ReactElement } from 'react';
import type { AstraClient } from '@astra/api-client';
import type { Artifact, CreateShareRequest } from '@astra/contracts';

const EXPIRY_OPTIONS: { id: NonNullable<CreateShareRequest['expires_in']>; label: string }[] = [
  { id: '1h', label: '1 時間' },
  { id: '1d', label: '1 日' },
  { id: '7d', label: '7 日' },
  { id: '30d', label: '30 日' },
];

/** 宛先欄の文字列を allowlist に。空行・空白は落とす。 */
export function parseAllowlist(raw: string): string[] {
  return raw
    .split(/[\s,、]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

/** blob を保存する。ブラウザの保存先ダイアログに任せる。 */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ArtifactActions({
  client,
  artifact,
  onShared,
}: {
  client: AstraClient | null;
  artifact: Artifact;
  /** 共有を作ったあと、状態表示を引き直すため。 */
  onShared?(): void;
}): ReactElement {
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<'download' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<NonNullable<CreateShareRequest['expires_in']>>('7d');
  const [password, setPassword] = useState('');
  const [allowDownload, setAllowDownload] = useState(false);
  const [oneTime, setOneTime] = useState(false);
  const [allowlist, setAllowlist] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const download = async (): Promise<void> => {
    if (!client) return;
    setBusy('download');
    setError(null);
    try {
      saveBlob(await client.artifactContent(artifact.id), artifact.title);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ダウンロードできませんでした');
    } finally {
      setBusy(null);
    }
  };

  const share = async (): Promise<void> => {
    if (!client) return;
    setBusy('share');
    setError(null);
    try {
      const body: CreateShareRequest = {
        expires_in: expiresIn,
        allow_download: allowDownload,
        one_time: oneTime,
        allowlist: parseAllowlist(allowlist),
        watermark: false,
        ...(password.trim().length >= 4 ? { password: password.trim() } : {}),
      };
      const created = await client.createShare(artifact.id, body);
      setLink(created.url);
      setPassword('');
      onShared?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '共有を始められませんでした');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (): Promise<void> => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard が使えない環境では、選択して写してもらう
      setCopied(false);
    }
  };

  return (
    <div className="astra-artifact-actions">
      <div className="astra-artifact-actions__row">
        <button
          type="button"
          className="astra-button"
          disabled={!client || busy !== null}
          onClick={() => void download()}
        >
          ダウンロード
        </button>
        <button
          type="button"
          className="astra-button"
          aria-expanded={sheet}
          disabled={!client}
          onClick={() => {
            setSheet((open) => !open);
            setLink(null);
          }}
        >
          共有…
        </button>
      </div>
      {error && (
        <p className="astra-artifact-actions__error" role="alert">
          {error}
        </p>
      )}

      {sheet && (
        <form
          className="astra-share-sheet"
          aria-label="共有を始める"
          onSubmit={(event) => {
            event.preventDefault();
            void share();
          }}
        >
          {link ? (
            <>
              <p className="astra-share-sheet__done">
                リンクを作りました。ここでしか見られません。
              </p>
              <div className="astra-share-sheet__link">
                <input
                  readOnly
                  value={link}
                  aria-label="共有リンク"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button type="button" className="astra-button" onClick={() => void copy()}>
                  {copied ? 'コピーしました' : 'コピー'}
                </button>
              </div>
              <button
                type="button"
                className="astra-button astra-button--quiet"
                onClick={() => setSheet(false)}
              >
                閉じる
              </button>
            </>
          ) : (
            <>
              <label className="astra-share-sheet__field">
                <span>期限</span>
                <select
                  value={expiresIn}
                  onChange={(e) => setExpiresIn(e.target.value as typeof expiresIn)}
                >
                  {EXPIRY_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="astra-share-sheet__field">
                <span>合言葉（任意・4 文字以上）</span>
                <input
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label className="astra-share-sheet__field">
                <span>開ける人（メールアドレスか @ドメイン。空なら誰でも）</span>
                <textarea
                  rows={2}
                  value={allowlist}
                  onChange={(e) => setAllowlist(e.target.value)}
                />
              </label>
              <label className="astra-share-sheet__check">
                <input
                  type="checkbox"
                  checked={allowDownload}
                  onChange={(e) => setAllowDownload(e.target.checked)}
                />
                ダウンロードを許す
              </label>
              <label className="astra-share-sheet__check">
                <input
                  type="checkbox"
                  checked={oneTime}
                  onChange={(e) => setOneTime(e.target.checked)}
                />
                一度開いたら失効する
              </label>
              <div className="astra-share-sheet__actions">
                <button
                  type="button"
                  className="astra-button astra-button--quiet"
                  onClick={() => setSheet(false)}
                >
                  やめる
                </button>
                <button
                  type="submit"
                  className="astra-button astra-button--primary"
                  disabled={busy !== null}
                >
                  リンクを作る
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
