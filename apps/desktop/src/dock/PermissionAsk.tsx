/**
 * 使う直前の許可のお願い。UI/UX §22。
 *
 * §22: 「permission request は利用直前に purpose-first で出す。
 * 初回起動時の一括権限要求は禁止。」
 *
 * 初回設定で「必要になったときに改めて聞きます」と言っている。
 * **言ったなら、聞かなければならない。**聞かないまま、
 * 取れなかった文脈を黙って落とすのがいちばん悪い。
 */
import { useCallback, useState, type ReactElement } from 'react';
import {
  PERMISSION_LABEL,
  PERMISSION_PURPOSE,
  PERMISSION_WITHOUT,
  isOsPermission,
  type OsPermission,
} from '@astra/contracts';
import { permissions as bridge } from '../host/tauri.js';

export function PermissionAsk({
  /** context snapshot が「これが無くて取れなかった」と言ってきたもの。 */
  missing,
  onDismiss,
}: {
  missing: readonly string[];
  onDismiss?(permission: OsPermission): void;
}): ReactElement | null {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async (permission: OsPermission) => {
    setError(null);
    try {
      await bridge.openSettings(permission);
      // 開いたことしか言えない。**許可されたと言わない。**
      setOpened((current) => new Set(current).add(permission));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  // 知らない名前は出さない。出しても、何を許せばいいか言えない。
  const asks = missing.filter((name) => isOsPermission(name) && !dismissed.has(name));
  if (asks.length === 0) return null;

  return (
    <div className="astra-permission" role="group" aria-label="許可のお願い">
      {error && (
        <p className="astra-permission__error" role="alert">
          {error}
        </p>
      )}
      {asks.map((name) => {
        const permission = name as OsPermission;
        return (
          <div key={permission} className="astra-permission__ask">
            {/* 目的が先。許可の名前は後（§22 purpose-first） */}
            <p className="astra-permission__why">
              {PERMISSION_PURPOSE[permission]}に、{PERMISSION_LABEL[permission]}
              の許可が要ります。
            </p>
            {/* 許さないとどうなるかを、許す前に言う */}
            <p className="astra-permission__without">
              許さなくても続けられます。{PERMISSION_WITHOUT[permission]}
            </p>
            {opened.has(permission) ? (
              <p className="astra-permission__opened" role="status">
                設定を開きました。許可したら、もう一度お試しください。
              </p>
            ) : (
              <button type="button" onClick={() => void open(permission)}>
                設定を開く
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setDismissed((current) => new Set(current).add(permission));
                onDismiss?.(permission);
              }}
            >
              今はしない
            </button>
          </div>
        );
      })}
    </div>
  );
}
