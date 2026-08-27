/**
 * サインイン。UI/UX §3 Step 1「画面には説明を並べず 1 文」。
 *
 * deepnote-desktop の LoginPage の並び（Google / Apple / LINE）を Astra の identity に繋ぐ。
 * 提供者の有無は **サーバに聞く**（`/v1/auth/providers`）。設定されていない提供者を
 * 「使える」顔で並べて、押した先で失敗させない（§21）。
 *
 * 開発用のメールサインイン（§4.3）は、サーバが `dev_email: true` と言うときだけ出す。
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { IdentityProvider } from '@astra/contracts';
import { useSession } from '../state/SessionProvider.js';
import { PROVIDER_LABEL, type ProviderEntry } from './providers.js';
import { AppleIcon, GoogleIcon, LineIcon } from './ProviderIcons.js';
import './signin.css';

const ICON: Record<IdentityProvider, () => ReactElement> = {
  google: GoogleIcon,
  apple: AppleIcon,
  line: LineIcon,
};

/** サーバに届かないときの並び。押せないが、何が入口かは見える。 */
const UNKNOWN_PROVIDERS: readonly ProviderEntry[] = (['google', 'apple', 'line'] as const).map(
  (id) => ({ id, configured: false, client_id: null, relay_path: null }),
);

type Providers =
  | { readonly state: 'loading' }
  | {
      readonly state: 'ready';
      readonly entries: readonly ProviderEntry[];
      readonly devEmail: boolean;
    }
  | { readonly state: 'unreachable' };

export interface SignInProps {
  /** 見本帳用。渡せばサーバに聞かない。 */
  readonly providers?: readonly ProviderEntry[];
  readonly devEmail?: boolean;
}

export function SignIn({ providers: preset, devEmail: presetDev }: SignInProps = {}): ReactElement {
  const { client, signIn, signInWith, error } = useSession();
  const [providers, setProviders] = useState<Providers>(
    preset
      ? { state: 'ready', entries: preset, devEmail: presetDev ?? false }
      : { state: 'loading' },
  );
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<IdentityProvider | 'email' | null>(null);

  useEffect(() => {
    if (preset) return;
    let cancelled = false;
    void client
      .authProviders()
      .then((res) => {
        if (!cancelled)
          setProviders({ state: 'ready', entries: res.providers, devEmail: res.dev_email });
      })
      .catch(() => {
        if (!cancelled) setProviders({ state: 'unreachable' });
      });
    return () => {
      cancelled = true;
    };
  }, [client, preset]);

  const onProvider = async (entry: ProviderEntry): Promise<void> => {
    if (busy) return;
    setBusy(entry.id);
    try {
      await signInWith(entry);
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (email.trim().length === 0 || busy) return;
    setBusy('email');
    try {
      await signIn(email.trim(), email.split('@')[0] ?? 'You');
    } finally {
      setBusy(null);
    }
  };

  const entries = providers.state === 'ready' ? providers.entries : UNKNOWN_PROVIDERS;
  const anyConfigured = entries.some((e) => e.configured);
  // 届かないときは、開発用の口を残す（本番の gateway は dev_email=false を返すので本番では出ない）
  const showDevEmail =
    providers.state === 'ready' ? providers.devEmail : providers.state === 'unreachable';

  return (
    <main className="astra-signin">
      <h1 className="astra-signin__promise">
        話すか、打つだけ。調べる・作る・動かすまでやります。
      </h1>

      <div className="astra-signin__providers" aria-busy={providers.state === 'loading'}>
        {entries.map((entry) => {
          const Icon = ICON[entry.id];
          const disabled = !entry.configured || busy !== null || providers.state === 'loading';
          return (
            <button
              key={entry.id}
              type="button"
              className={`astra-signin__provider astra-signin__provider--${entry.id}`}
              disabled={disabled}
              aria-disabled={disabled}
              onClick={() => void onProvider(entry)}
            >
              <Icon />
              <span>
                {busy === entry.id ? 'ブラウザで続けてください' : PROVIDER_LABEL[entry.id]}
              </span>
            </button>
          );
        })}
        {providers.state === 'ready' && !anyConfigured && (
          <p className="astra-signin__unavailable">
            この環境では、まだどの提供者も設定されていません。
          </p>
        )}
        {providers.state === 'unreachable' && (
          <p className="astra-signin__unavailable">
            接続先に届きません。サーバの起動を確認してください。
          </p>
        )}
      </div>

      {busy && busy !== 'email' && (
        <p className="astra-signin__waiting" role="status">
          <span className="astra-signin__spinner" aria-hidden="true" />
          ブラウザで {PROVIDER_LABEL[busy].replace(' で続ける', '')}{' '}
          にサインインすると、ここに戻ります。
        </p>
      )}

      {showDevEmail && (
        <>
          <div className="astra-signin__divider" aria-hidden="true">
            または
          </div>
          <form className="astra-signin__form" onSubmit={onSubmit}>
            <label className="astra-signin__field">
              <span>メールアドレス</span>
              <input
                type="email"
                value={email}
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <button type="submit" className="astra-signin__submit" disabled={busy !== null}>
              {busy === 'email' ? 'サインインしています' : '始める'}
            </button>
          </form>
        </>
      )}

      {error && (
        <p className="astra-signin__error" role="alert">
          {/* §21: 影響と次の行動を書く */}
          サインインできませんでした。接続先を確認して、もう一度お試しください。
        </p>
      )}

      <p className="astra-signin__terms">
        続けることで、利用規約とプライバシーポリシーに同意したことになります。 サインインの鍵はこの
        Mac の外へ出ません。
      </p>
    </main>
  );
}
