/**
 * トークンの置き場所。正本 §21 Credential。
 *
 * **アプリの DB にも、サーバにも、値そのものを置かない。**
 * 置くのは OS の資格情報ストアで、外へ出すのはその参照だけ。
 * `ConnectionService` は値らしきものを受け取ると断るので、
 * ここが参照を作る唯一の場所になる。
 */
import type { TokenSet } from './flow.js';

/** OS の資格情報ストアの口。desktop の host bridge がこれを満たす。 */
export interface SecretStore {
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<unknown>;
}

/**
 * 参照の形。`ConnectionService.looksLikeCredential` を通る短い文字列。
 *
 * **値を推測できる形にしない。**plugin と connector の名前だけで作る。
 */
export function credentialRef(pluginId: string, connectorId: string): string {
  return `keychain:${pluginId}/${connectorId}`;
}

/** 参照から鍵へ。1 箇所で決める。 */
export function keyFor(ref: string): string {
  return ref.startsWith('keychain:') ? ref.slice('keychain:'.length) : ref;
}

export class TokenStore {
  readonly #secrets: SecretStore;

  constructor(secrets: SecretStore) {
    this.#secrets = secrets;
  }

  /** 置いて、参照だけを返す。**値は返さない。** */
  async save(pluginId: string, connectorId: string, tokens: TokenSet): Promise<string> {
    const ref = credentialRef(pluginId, connectorId);
    await this.#secrets.set(keyFor(ref), JSON.stringify(tokens));
    return ref;
  }

  /**
   * 取り出す。無ければ null。
   *
   * **壊れていたら null。**読めないものを部分的に使うと、
   * 「繋がっているのに動かない」状態になる。
   */
  async load(ref: string): Promise<TokenSet | null> {
    const raw = await this.#secrets.get(keyFor(ref));
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as TokenSet;
      return typeof parsed?.accessToken === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  /** 消す。切ったのに残しておく理由が無い。 */
  async forget(ref: string): Promise<void> {
    await this.#secrets.delete(keyFor(ref));
  }
}
