/**
 * 読み上げへの通知。UI/UX §19。
 *
 * §19: 「Live transcript は screen reader 向け aria-live の頻度を抑制し、
 *        final segment のみ通知可能にする」
 *
 * **途中経過を読み上げさせない。**認識中の文字は数百 ms ごとに書き換わるので、
 * そのまま aria-live に流すと、読み上げが延々と割り込み続けて
 * 画面が使えなくなる。読み上げ利用者にとっては、
 * 「文字起こしが動いている」ことより **会議に参加できる**ことのほうが大事。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { TranscriptLine } from './meetingView.js';

/** 読み上げに渡す最短の間隔。これより速く来たものは、次の機会にまとめる。 */
export const ANNOUNCE_INTERVAL_MS = 4_000;

/**
 * 何を読み上げるか決める。
 *
 * **確定した行だけ。**まだ確定していない行（interim）は決して渡さない。
 */
export function announceable(
  lines: readonly TranscriptLine[],
  announcedIds: ReadonlySet<string>,
): TranscriptLine[] {
  return lines.filter((line) => !line.interim && !announcedIds.has(line.id));
}

export function LiveAnnouncer({
  lines,
  /** 読み上げを望むか。既定は off（§19「通知**可能**にする」）。 */
  enabled = false,
  intervalMs = ANNOUNCE_INTERVAL_MS,
  now = () => Date.now(),
}: {
  lines: readonly TranscriptLine[];
  enabled?: boolean;
  intervalMs?: number;
  now?: () => number;
}): ReactElement {
  const [message, setMessage] = useState('');
  const announced = useRef(new Set<string>());
  // 最初の 1 件は待たせない。0 で始めると、時計の起点次第で最初が消える。
  const lastAt = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    if (!enabled) return;
    const fresh = announceable(lines, announced.current);
    if (fresh.length === 0) return;

    const at = now();
    if (at - lastAt.current < intervalMs) return;

    lastAt.current = at;
    for (const line of fresh) announced.current.add(line.id);
    // まとめて 1 度だけ渡す。1 行ずつ流すと割り込みが積み上がる。
    setMessage(fresh.map((line) => line.text).join(' '));
  }, [lines, enabled, intervalMs, now]);

  return (
    <p
      className="astra-visually-hidden"
      // polite: 進行中の読み上げに割り込まない
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </p>
  );
}
