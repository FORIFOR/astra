/**
 * OS の資格情報ストア。正本 §21。
 *
 * **トークンはこの端末から出ない。**サーバへ行くのは参照だけで、
 * 値を読むのはこのプロセスだけ。
 *
 * macOS では `security` を使う。ライブラリを足さないのは依存を惜しむからではなく、
 * **鍵を扱う経路を、外から読める短いコードにしておきたい**から。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SecretStore } from '@astra/oauth';

const run = promisify(execFile);

/** login keychain の中でこのアプリの項目を見分ける名前。 */
export const KEYCHAIN_SERVICE_PREFIX = 'com.astra.connector';

export class KeychainUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeychainUnavailable';
  }
}

function serviceFor(key: string): string {
  return `${KEYCHAIN_SERVICE_PREFIX}.${key}`;
}

/**
 * macOS の login keychain。
 *
 * `-w` で値だけを取る。項目が無ければ `security` は 44 で終わるので、
 * **それを「無い」として扱い、他の失敗と混ぜない。**
 * 混ぜると、keychain が開けないだけの状態が「未接続」に見え、
 * 利用者は繋ぎ直しを何度も試すことになる。
 */
export class MacKeychain implements SecretStore {
  readonly #account: string;

  constructor(account: string) {
    this.#account = account;
  }

  async get(key: string): Promise<string | null> {
    try {
      const { stdout } = await run('security', [
        'find-generic-password',
        '-a',
        this.#account,
        '-s',
        serviceFor(key),
        '-w',
      ]);
      return stdout.trimEnd();
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new KeychainUnavailable(
        'この端末の資格情報ストアを開けませんでした。ロックされていないか確認してください。',
      );
    }
  }

  async set(key: string, value: string): Promise<void> {
    // `-U` で既存を更新する。付けないと、繋ぎ直すたびに項目が増える。
    await run('security', [
      'add-generic-password',
      '-a',
      this.#account,
      '-s',
      serviceFor(key),
      '-w',
      value,
      '-U',
    ]);
  }

  async delete(key: string): Promise<void> {
    try {
      await run('security', [
        'delete-generic-password',
        '-a',
        this.#account,
        '-s',
        serviceFor(key),
      ]);
    } catch (error) {
      // 無いものを消せなくても、結果は同じ
      if (!isNotFound(error)) throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: number }).code === 44;
}

/**
 * 資格情報ストアが無い環境。
 *
 * **黙って動くふりをしない。**読み書きしようとしたら断る。
 * ここで空を返すと、「繋いだのに毎回サインインを求められる」になり、
 * 原因が資格情報ストアだと分からない。
 */
export class NoKeychain implements SecretStore {
  async get(): Promise<string | null> {
    throw new KeychainUnavailable('この環境には資格情報ストアがありません。');
  }
  async set(): Promise<void> {
    throw new KeychainUnavailable('この環境には資格情報ストアがありません。');
  }
  async delete(): Promise<void> {
    throw new KeychainUnavailable('この環境には資格情報ストアがありません。');
  }
}

/** この端末で使えるものを選ぶ。**無いものを在るふりにしない。** */
export function keychainFor(platform: string, account: string): SecretStore {
  return platform === 'darwin' ? new MacKeychain(account) : new NoKeychain();
}
