/**
 * サインイン。UI/UX §3 Step 1「画面には説明を並べず 1 文」。
 *
 * Phase 1 は開発用エンドポイント（§4.3）。実 IdP へ差し替えるときに
 * 触るのはこの画面と `AstraClient.devSignIn` だけで済むようにしてある。
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { useSession } from '../state/SessionProvider.js';

export function SignIn(): ReactElement {
  const { signIn, error } = useSession();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (email.trim().length === 0 || busy) return;
    setBusy(true);
    try {
      await signIn(email.trim(), email.split('@')[0] ?? 'You');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="astra-signin">
      <h1 className="astra-signin__promise">
        話すか、打つだけ。調べる・作る・動かすまでやります。
      </h1>
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
        <button type="submit" className="astra-signin__submit" disabled={busy}>
          {busy ? 'サインインしています' : '始める'}
        </button>
      </form>
      {error && (
        <p className="astra-signin__error" role="alert">
          {/* §21: 影響と次の行動を書く */}
          サインインできませんでした。接続先を確認して、もう一度お試しください。
        </p>
      )}
    </main>
  );
}
