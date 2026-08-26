/**
 * ショートカットの設定。UI/UX §20。
 *
 * §20 は「Settings で変更可能」「OS/IME 競合を検出した場合は
 * 初回設定で代替候補を提示する」と言っている。
 *
 * **効いていないショートカットを黙って放置しない。**
 * 既定が取られていたら、そう言って、押せる候補を出す。
 * 「登録できませんでした」で終わると、二度と直されない。
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  SHORTCUTS,
  bindingLabel,
  currentPlatform,
  defaultBinding,
  type Binding,
  type Platform,
  type ShortcutId,
} from '@astra/ui-kit';
import { shortcuts as bridge, type ShortcutStatus } from '../host/tauri.js';
import './settings.css';

function toBinding(status: ShortcutStatus): Binding | null {
  return status.code === null ? null : { code: status.code, modifiers: status.modifiers };
}

/** OS 側の登録結果。面の中だけで効くものは、表の既定がそのまま効く。 */
function labelFor(id: ShortcutId, platform: Platform, status?: ShortcutStatus): string | null {
  if (!status) return bindingLabel(defaultBinding(id, platform), platform);
  const binding = toBinding(status);
  return binding === null ? null : bindingLabel(binding, platform);
}

export function ShortcutSettings(): ReactElement {
  const platform = useMemo(() => currentPlatform(), []);
  const [status, setStatus] = useState<readonly ShortcutStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void bridge.status().then((next) => setStatus(next ?? []));
  }, []);

  useEffect(load, [load]);

  const rebind = useCallback(
    async (id: ShortcutId, candidate: Binding) => {
      setError(null);
      try {
        await bridge.rebind(id, candidate.code, candidate.modifiers);
        load();
      } catch (cause) {
        // 変えられなかったことを言う。黙って元のままにしない。
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [load],
  );

  return (
    <section className="astra-shortcuts" aria-label="ショートカット">
      {error && (
        <p className="astra-shortcuts__error" role="alert">
          {error}
        </p>
      )}
      <ul className="astra-shortcuts__list">
        {SHORTCUTS.map((spec) => {
          const current = status.find((s) => s.id === spec.id);
          const label = labelFor(spec.id, platform, current);
          const taken = current !== undefined && !current.usingDefault;
          return (
            <li key={spec.id} className="astra-shortcuts__row" data-taken={taken || undefined}>
              <span className="astra-shortcuts__label">{spec.label}</span>
              {label === null ? (
                <>
                  {/* 効いていない。§21: 影響と次の選択肢を書く。 */}
                  <span className="astra-shortcuts__unavailable">
                    ほかのアプリに取られていて、いま使えません
                  </span>
                  <span className="astra-shortcuts__note">
                    アプリの画面からは今までどおり開けます。
                  </span>
                </>
              ) : (
                <kbd className="astra-shortcuts__keys">{label}</kbd>
              )}
              {taken && label !== null && (
                <span className="astra-shortcuts__note">
                  既定の {bindingLabel(defaultBinding(spec.id, platform), platform)}{' '}
                  はほかで使われていました
                </span>
              )}
              {current && current.alternates.length > 0 && (
                <div className="astra-shortcuts__alternates">
                  <span className="astra-shortcuts__note">ほかの候補：</span>
                  {current.alternates.map((alternate) => {
                    const candidate: Binding = {
                      code: alternate.code,
                      modifiers: alternate.modifiers,
                    };
                    const text = bindingLabel(candidate, platform);
                    return (
                      <button
                        key={text}
                        type="button"
                        onClick={() => void rebind(spec.id, candidate)}
                      >
                        {text} にする
                      </button>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
