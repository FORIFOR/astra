/**
 * Proactive heartbeat。正本 §17 notification-service、§2.1。
 *
 * **通知を増やす仕組みではない。**
 * brief（Phase 6）は「見に来たときに何を出すか」を決める。
 * こちらは「見に来ていない人に、話しかけてよいか」を決める。
 * 後者のほうが慎重でなければならない。
 *
 * 守るのは 3 つ:
 *   - 同じことを二度言わない
 *   - 静かにしていてほしい時間には出さない
 *   - 一度に浴びせない
 */
import {
  MAX_ATTENTION_ITEMS,
  interrupts,
  overridesQuietHours,
  type BriefItem,
  type DailyBrief,
} from '@astra/contracts';

export interface NotificationSink {
  /** 端末へ出す。失敗しても heartbeat は止めない。 */
  push(item: BriefItem): Promise<void>;
}

export interface HeartbeatOptions {
  /**
   * これを下回るものは出さない。**brief より厳しくする。**
   * 見に来た人へ出す基準で話しかけると、多すぎる。
   */
  readonly minScore?: number;
  /** 1 回に出す上限。浴びせない。 */
  readonly maxPerRun?: number;
  /** 静かにしていてほしい時間帯（ローカル時刻の時）。 */
  readonly quietHours?: { readonly from: number; readonly to: number };
  /** 同じものを再び出すまでの間隔。 */
  readonly repeatAfterMs?: number;
}

const DEFAULTS = {
  minScore: 0.5,
  maxPerRun: 1,
  repeatAfterMs: 6 * 60 * 60 * 1000,
} as const;

export interface PendingNotification {
  readonly item: BriefItem;
  readonly reason: string;
}

/** 静かにしていてほしい時間か。`from`〜`to` は日を跨いでよい。 */
export function inQuietHours(hour: number, quiet?: HeartbeatOptions['quietHours']): boolean {
  if (!quiet) return false;
  const { from, to } = quiet;
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

/**
 * この 1 件を出してよいか。
 *
 * 出さない理由も返す。**黙って落とすと、なぜ通知が来ないのか誰にも分からない。**
 */
export function shouldNotify(
  item: BriefItem,
  context: {
    readonly now: Date;
    readonly lastSentAt?: number | null;
    readonly options?: HeartbeatOptions;
  },
): { notify: boolean; reason: string } {
  const options = context.options ?? {};
  const minScore = options.minScore ?? DEFAULTS.minScore;
  const repeatAfterMs = options.repeatAfterMs ?? DEFAULTS.repeatAfterMs;

  /*
   * §16: 出す面は severity が決める。
   *
   * **score だけで割り込まない。**「調査が終わりました」(info) は
   * Home に出すものであって、OS 通知で鳴らすものではない。
   * ここを通さないと、点数の高い info が割り込んでくる。
   */
  if (!interrupts(item.severity)) {
    return { notify: false, reason: `${item.severity} belongs on Home, not the OS` };
  }

  if (inQuietHours(context.now.getHours(), options.quietHours)) {
    // critical は静けさより優先する。黙っていると取り返しがつかない。
    if (!overridesQuietHours(item.severity)) {
      return { notify: false, reason: 'quiet hours' };
    }
  }
  if (item.score < minScore) {
    return { notify: false, reason: `score ${item.score.toFixed(2)} is below ${minScore}` };
  }
  if (context.lastSentAt != null && context.now.getTime() - context.lastSentAt < repeatAfterMs) {
    // 同じことを二度言わない
    return { notify: false, reason: 'already mentioned recently' };
  }
  return { notify: true, reason: `score ${item.score.toFixed(2)}` };
}

export interface HeartbeatDeps {
  readonly sink: NotificationSink;
  readonly now?: () => Date;
}

/**
 * 定期的に「話しかけるべきか」を見る。
 *
 * brief をそのまま流さない。**brief は見に来た人向け**で、
 * こちらは割り込みなので、より高い基準を通す。
 */
export class Heartbeat {
  readonly #sink: NotificationSink;
  readonly #now: () => Date;
  /** 何をいつ出したか。同じことを二度言わないため。 */
  readonly #sent = new Map<string, number>();

  constructor(deps: HeartbeatDeps) {
    this.#sink = deps.sink;
    this.#now = deps.now ?? (() => new Date());
  }

  /** 出した件数を返す。 */
  async run(brief: DailyBrief, options: HeartbeatOptions = {}): Promise<PendingNotification[]> {
    const now = this.#now();
    const maxPerRun = options.maxPerRun ?? DEFAULTS.maxPerRun;

    const candidates = [...brief.attention, ...brief.more]
      .slice(0, MAX_ATTENTION_ITEMS * 2)
      .map((item) => ({
        item,
        verdict: shouldNotify(item, { now, lastSentAt: this.#sent.get(item.id) ?? null, options }),
      }))
      .filter((c) => c.verdict.notify)
      .sort((a, b) => b.item.score - a.item.score || a.item.id.localeCompare(b.item.id))
      .slice(0, maxPerRun);

    const sent: PendingNotification[] = [];
    for (const candidate of candidates) {
      try {
        await this.#sink.push(candidate.item);
        // 出せたものだけ覚える。失敗を「言った」ことにしない。
        this.#sent.set(candidate.item.id, now.getTime());
        sent.push({ item: candidate.item, reason: candidate.verdict.reason });
      } catch {
        // 端末へ出せなくても heartbeat は止めない
      }
    }
    return sent;
  }

  /** 済んだものは忘れる。次に同じ id が来たら、また出してよい。 */
  forget(id: string): void {
    this.#sent.delete(id);
  }
}
