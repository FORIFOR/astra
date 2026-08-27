/**
 * 「Google で発話を高精度に確定する」の保存先。
 *
 * 音は手元で文字にする（正本 §25）。Google へ送るのは、利用者がここで許したときだけ。
 * 設定は本体ウィンドウの「設定」で切り替え、Dock はそれを読む。
 * Tauri の window は同じ origin なので localStorage を共有でき、`storage` イベントで伝わる。
 */
const KEY = 'astra.voice.cloud_correction';

export function readCloudCorrection(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCloudCorrection(allowed: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY, allowed ? '1' : '0');
  } catch {
    /* 保存できない環境では、その起動の間だけ効く */
  }
  globalThis.dispatchEvent?.(new CustomEvent(KEY, { detail: allowed }));
}

/** 別 window（設定）で変わったら知らせる。戻り値で解除。 */
export function onCloudCorrectionChange(listener: (allowed: boolean) => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === KEY) listener(event.newValue === '1');
  };
  const onLocal = (event: Event): void => {
    listener(Boolean((event as CustomEvent<boolean>).detail));
  };
  globalThis.addEventListener?.('storage', onStorage);
  globalThis.addEventListener?.(KEY, onLocal);
  return () => {
    globalThis.removeEventListener?.('storage', onStorage);
    globalThis.removeEventListener?.(KEY, onLocal);
  };
}
