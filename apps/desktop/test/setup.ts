/**
 * テスト環境の下ごしらえ。
 *
 * happy-dom はこの構成で `localStorage` を実装として持っていないので、
 * 最小の in-memory Storage を入れる。アプリ側は「無い」場合も動くように
 * 実装してあるが（ThemeProvider 参照）、永続の挙動そのものを確かめたいので用意する。
 */
class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }
  clear(): void {
    this.#entries.clear();
  }
  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.#entries.delete(key);
  }
  setItem(key: string, value: string): void {
    this.#entries.set(key, String(value));
  }
}

if (typeof globalThis.localStorage?.setItem !== 'function') {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: new MemoryStorage(),
  });
}
