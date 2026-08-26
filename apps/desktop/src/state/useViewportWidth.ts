import { useEffect, useState } from 'react';

/** ビューポート幅。レイアウト判定の入力（UI/UX §7.2）。 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => globalThis.innerWidth ?? 1440);

  useEffect(() => {
    const onResize = (): void => setWidth(globalThis.innerWidth);
    globalThis.addEventListener('resize', onResize);
    // マウント時点の実寸に合わせる（SSR やテストの初期値とずれることがある）
    onResize();
    return () => globalThis.removeEventListener('resize', onResize);
  }, []);

  return width;
}
