/**
 * サインイン状態。実装仕様 §4.2。
 *
 * トークンの持ち方:
 *   access token  … **メモリのみ**。寿命 15 分。
 *   refresh token … OS の資格情報ストア（Tauri）。ブラウザでは保存しない。
 *
 * ブラウザに安全な保管先が無い以上、localStorage へ置いて「保存できている」ことに
 * するより、保存しない方が正しい。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactElement, ReactNode } from 'react';
import { AstraClient } from '@astra/api-client';
import type { MeResponse } from '@astra/contracts';
import { secrets } from '../host/tauri.js';

const REFRESH_KEY = 'astra.refresh_token';

export type SessionStatus = 'loading' | 'signed-out' | 'signed-in';

interface SessionContextValue {
  readonly status: SessionStatus;
  readonly client: AstraClient;
  readonly me: MeResponse | null;
  readonly error: string | null;
  signIn(email: string, displayName: string): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  readonly children: ReactNode;
  readonly baseUrl?: string;
  /** テストで差し替える。既定はグローバルの fetch。 */
  readonly fetchImpl?: typeof globalThis.fetch;
}

export function SessionProvider({
  children,
  baseUrl = import.meta.env.VITE_ASTRA_API_URL ?? 'http://127.0.0.1:3000',
  fetchImpl,
}: SessionProviderProps): ReactElement {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // トークンは state に置かない。再描画のたびにクライアントを作り直したくない。
  const accessToken = useRef<string | null>(null);
  const refreshToken = useRef<string | null>(null);

  const client = useMemo(
    () =>
      new AstraClient({
        baseUrl,
        accessToken: () => accessToken.current,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
        // 401 を受けたら一度だけローテーションして同じ要求をやり直す
        onUnauthorized: async () => {
          const current = refreshToken.current;
          if (!current) return false;
          try {
            const next = await clientRef.current!.refresh(current);
            accessToken.current = next.access_token;
            refreshToken.current = next.refresh_token;
            await secrets.set(REFRESH_KEY, next.refresh_token);
            return true;
          } catch {
            // 再利用検知などで失効している。黙って握らずサインアウトさせる。
            accessToken.current = null;
            refreshToken.current = null;
            await secrets.delete(REFRESH_KEY);
            setMe(null);
            setStatus('signed-out');
            return false;
          }
        },
      }),
    [baseUrl, fetchImpl],
  );

  // onUnauthorized の中から自分自身を呼ぶための参照
  const clientRef = useRef<AstraClient | null>(null);
  clientRef.current = client;

  const adopt = useCallback(
    async (tokens: { access_token: string; refresh_token: string }): Promise<void> => {
      accessToken.current = tokens.access_token;
      refreshToken.current = tokens.refresh_token;
      await secrets.set(REFRESH_KEY, tokens.refresh_token);
      setMe(await client.me());
      setError(null);
      setStatus('signed-in');
    },
    [client],
  );

  // 起動時に、保存済みの refresh token から復帰を試みる
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await secrets.get(REFRESH_KEY);
      if (cancelled) return;
      if (!stored) {
        setStatus('signed-out');
        return;
      }
      try {
        await adopt(await client.refresh(stored));
      } catch {
        // 期限切れや再利用検知。保存済みの値を残さない。
        await secrets.delete(REFRESH_KEY);
        if (!cancelled) setStatus('signed-out');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, adopt]);

  const signIn = useCallback(
    async (email: string, displayName: string): Promise<void> => {
      setError(null);
      try {
        await adopt(await client.devSignIn(email, displayName));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'サインインできませんでした');
        setStatus('signed-out');
      }
    },
    [client, adopt],
  );

  const signOut = useCallback(async (): Promise<void> => {
    const current = refreshToken.current;
    accessToken.current = null;
    refreshToken.current = null;
    await secrets.delete(REFRESH_KEY);
    setMe(null);
    setStatus('signed-out');
    // サーバ側の失効は best effort。届かなくてもローカルは既にサインアウト済み。
    if (current) await client.logout(current).catch(() => undefined);
  }, [client]);

  const value = useMemo<SessionContextValue>(
    () => ({ status, client, me, error, signIn, signOut }),
    [status, client, me, error, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
