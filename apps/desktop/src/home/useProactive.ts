/**
 * 割り込んでよいかを決めて、OS へ出す。UI/UX §16。
 *
 * 面の判断は contracts（interrupts）、割り込みの基準は
 * `@astra/service-notification`（shouldNotify）。
 * **ここで判断をやり直さない。**二重に持つと、片方だけ直って食い違う。
 *
 * ここが持つのは 2 つだけ:
 *   - 同じことを二度言わない（この起動の間）
 *   - **出せなかったことを黙らない**
 */
import { useEffect, useRef } from 'react';
import { interrupts, type BriefItem, type DailyBrief } from '@astra/contracts';
import { shouldNotify, type HeartbeatOptions } from '@astra/service-notification';
import { notifications } from '../host/tauri.js';

/** 静かにしていてほしい時間帯の既定。UI/UX §16。 */
export const DEFAULT_QUIET_HOURS = { from: 22, to: 7 } as const;

export interface ProactiveOptions extends HeartbeatOptions {
  /** テストと診断のため。既定は本物の時計。 */
  readonly now?: () => Date;
  /** 出せなかったときに呼ぶ。黙って捨てない。 */
  onUndelivered?(item: BriefItem, reason: string): void;
}

/**
 * brief が変わるたびに「話しかけてよいか」を見る。
 *
 * **brief をそのまま流さない。**brief は見に来た人向けで、
 * こちらは割り込みなので、より高い基準を通す。
 */
export function useProactiveNotifications(
  brief: DailyBrief | null,
  options: ProactiveOptions = {},
): void {
  // 何をいつ出したか。同じことを二度言わないため。
  const sent = useRef(new Map<string, number>());

  useEffect(() => {
    if (!brief) return;
    const now = (options.now ?? (() => new Date()))();
    const quietHours = options.quietHours ?? DEFAULT_QUIET_HOURS;

    const candidates = [...brief.attention, ...brief.more]
      // §16: Home に出すものを OS へ持ち出さない
      .filter((item) => interrupts(item.severity));

    for (const item of candidates) {
      const verdict = shouldNotify(item, {
        now,
        lastSentAt: sent.current.get(item.id) ?? null,
        options: { ...options, quietHours },
      });
      if (!verdict.notify) continue;

      // 出せたものだけ覚える。失敗を「言った」ことにしない。
      void notifications
        .send(item.severity, item.title, item.detail ?? item.action_label)
        .then(() => {
          sent.current.set(item.id, now.getTime());
        })
        .catch((error: unknown) => {
          options.onUndelivered?.(item, error instanceof Error ? error.message : String(error));
        });
    }
    // options はレンダーごとに作られ得るので依存に入れない。
    // brief が変わったときだけ見ればよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief]);
}
