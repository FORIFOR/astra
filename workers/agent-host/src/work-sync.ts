/**
 * Work Context の同期。端末 → cloud。Work Context 仕様 §同期、正本 §6・§21。
 *
 * 繋いであるサービスから生データを取り、正規化して（抜粋だけ）、cloud へ渡す。
 *
 * **ここが、メールの本文が存在しうる唯一の場所。**そして本文は取りに行かない —
 * 一覧（件名・差出人・冒頭の抜粋）で足りる。cloud にも LLM にも、
 * 受信箱をまるごと渡す経路は無い（`WorkArtifact.body_excerpt` は 500 字まで）。
 *
 * **読む接続だけを使う。**送る・動かす接続（gmail-actions など）のトークンはここから触らない。
 * 意味づけ（依頼か・誰を待っているか・期限）は端末の LLM に頼む。
 * 無ければ付けずに送り、cloud 側が規則で補う（代役は賢くしない）。
 */
import {
  WorkSemantic,
  type WorkArtifact,
  type WorkArtifactBatch,
  type WorkSource,
  type WorkSyncAttempt,
  type WorkSyncState,
} from '@astra/contracts';
import {
  ConnectorError,
  fromGmail,
  fromGoogleCalendar,
  fromOutlookCalendar,
  fromOutlookMail,
  fromTodo,
  type NormalizeContext,
} from '@astra/service-connectors';
import type { ConnectorRuntime } from './connector-steps.js';
import type { StepRunner } from './step-loop.js';

/** 1 回の同期で、1 つの source がどうなったか。 */
export interface SourceOutcome {
  readonly source: WorkSource;
  readonly status: 'synced' | 'not_connected' | 'not_granted' | 'failed';
  readonly artifacts: number;
  /** LLM が意味を付けた件数。 */
  readonly classified: number;
  readonly error?: string;
}

export interface WorkSyncReport {
  readonly at: string;
  readonly outcomes: readonly SourceOutcome[];
}

export interface WorkSyncDeps {
  readonly connectors: ConnectorRuntime;
  /** cloud へ渡す（`POST /v1/work/artifacts`）。artifact の upsert と cursor は cloud が同じ transaction で進める。 */
  readonly push: (batch: WorkArtifactBatch) => Promise<void>;
  /**
   * 続きの位置を cloud から読む（`GET /v1/work/sync`）。**最初の 1 回だけ。**
   * 無ければ process 内から始める（再起動のたびに 14 日分を読み直していたのを、ここで止める）。
   */
  readonly loadState?: () => Promise<readonly WorkSyncState[]>;
  /** 失敗を残す（`POST /v1/work/sync/:source/attempt`）。cursor は動かさない。 */
  readonly attempt?: (source: WorkSource, attempt: WorkSyncAttempt) => Promise<void>;
  /** 端末の LLM。無ければ意味を付けない。 */
  readonly llm?: StepRunner;
  readonly now?: () => Date;
  /** 何日前まで遡るか（メール）。 */
  readonly lookbackDays?: number;
  readonly calendarLookbackDays?: number;
  readonly sources?: readonly WorkSource[];
  readonly metadataOnly?: boolean;
  readonly onSourceStart?: (source: WorkSource) => Promise<void>;
  readonly onOutcome?: (outcome: SourceOutcome) => Promise<void>;
  /** 何日先まで見るか（予定）。 */
  readonly lookaheadDays?: number;
  /** 1 回の同期で LLM に頼む上限。 */
  readonly maxClassifications?: number;
  /** Optional provider search restriction, applied before fetching/classifying items. */
  readonly googleQuery?: string;
  /** Restrict Microsoft validation data before classification or cloud publication. */
  readonly microsoftQuery?: string;
  /** 混み合い（429）/ 時間切れのときに一度だけ待ってやり直す間隔。 */
  readonly backoffMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onError?: (source: WorkSource, error: Error) => void;
}

export const DEFAULT_LOOKBACK_DAYS = 14;
export const DEFAULT_LOOKAHEAD_DAYS = 14;
export const DEFAULT_MAX_CLASSIFICATIONS = 30;
export const DEFAULT_SYNC_INTERVAL_MS = 15 * 60_000;

const DAY_MS = 86_400_000;

export class WorkSyncLoop {
  readonly #deps: WorkSyncDeps;
  /**
   * source ごとの続き（メールは最後に見た時刻）。正本は cloud の `work_sync_state`。
   * ここは写しで、push が成功したときだけ進む（cloud 側も upsert と同じ transaction でだけ進める）。
   */
  readonly #cursors = new Map<WorkSource, string>();
  #resumed = false;
  /** 既に LLM に頼んだ artifact。同じメールを毎回聞き直さない。 */
  readonly #classified = new Map<string, WorkSemantic | null>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #stopping = false;
  #inFlight: Promise<WorkSyncReport> | null = null;

  constructor(deps: WorkSyncDeps) {
    this.#deps = deps;
  }

  get cursors(): ReadonlyMap<WorkSource, string> {
    return this.#cursors;
  }

  /** 1 回だけ回す。source ごとに独立で、1 つ落ちても他は進む。 */
  async syncOnce(): Promise<WorkSyncReport> {
    if (this.#inFlight) return this.#inFlight;
    this.#inFlight = this.#run().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #run(): Promise<WorkSyncReport> {
    await this.#resume();
    const now = (this.#deps.now ?? (() => new Date()))();
    const ctx: NormalizeContext = { observedAt: now.toISOString() };
    const outcomes: SourceOutcome[] = [];
    outcomes.push(await this.#source('gmail', 'gmail', 'email.read', () => this.#gmail(now, ctx)));
    outcomes.push(
      await this.#source('google_calendar', 'google-calendar', 'calendar.read', () =>
        this.#googleCalendar(now, ctx),
      ),
    );
    outcomes.push(
      await this.#source('outlook_mail', 'outlook', 'email.read', () =>
        this.#outlookMail(now, ctx),
      ),
    );
    outcomes.push(
      await this.#source('outlook_calendar', 'outlook', 'calendar.read', () =>
        this.#outlookCalendar(now, ctx),
      ),
    );
    outcomes.push(
      await this.#source('microsoft_todo', 'microsoft-todo', 'tasks.read', () => this.#todo(ctx)),
    );
    return { at: ctx.observedAt, outcomes };
  }

  /** cloud に残した続きから始める。読めなければ（初回・未接続）そのまま最初から。 */
  async #resume(): Promise<void> {
    if (this.#resumed || !this.#deps.loadState) return;
    try {
      for (const state of await this.#deps.loadState()) {
        if (state.cursor && !this.#cursors.has(state.source)) {
          this.#cursors.set(state.source, state.cursor);
        }
      }
      this.#resumed = true;
    } catch (error) {
      // 続きが読めないのは、読み直しの理由にはなっても止める理由にはならない。次の周でまた試す。
      this.#deps.onError?.('gmail', error instanceof Error ? error : new Error(String(error)));
    }
  }

  async #source(
    source: WorkSource,
    key: Parameters<ConnectorRuntime['connected']>[0],
    permission: string,
    fetch: () => Promise<{ artifacts: WorkArtifact[]; cursor: string | null }>,
  ): Promise<SourceOutcome> {
    if (this.#deps.sources && !this.#deps.sources.includes(source))
      return { source, status: 'not_connected', artifacts: 0, classified: 0 };
    await this.#deps.onSourceStart?.(source);
    const outcome = await this.#sourceRun(source, key, permission, fetch);
    await this.#deps.onOutcome?.(outcome);
    return outcome;
  }

  async #sourceRun(
    source: WorkSource,
    key: Parameters<ConnectorRuntime['connected']>[0],
    permission: string,
    fetch: () => Promise<{ artifacts: WorkArtifact[]; cursor: string | null }>,
  ): Promise<SourceOutcome> {
    try {
      // 繋いでいないものは黙って飛ばす。繋いでいないことは失敗ではない。
      if (!(await this.#deps.connectors.connected(key))) {
        return { source, status: 'not_connected', artifacts: 0, classified: 0 };
      }
      // 繋いであっても、読む許可が外されていれば読まない。
      if (!this.#deps.connectors.granted(key).includes(permission)) {
        return { source, status: 'not_granted', artifacts: 0, classified: 0 };
      }
      const { artifacts, cursor } = await this.#withBackoff(fetch);
      const minimized = this.#deps.metadataOnly
        ? artifacts.map((a) => ({
            ...a,
            body_excerpt: null,
            provenance: { ...a.provenance, excerpt: null },
          }))
        : artifacts;
      const { items, classified } = await this.#classify(minimized);
      /*
       * 順番: fetch → normalize → upsert → cursor。
       * 500 件ずつ（契約の上限）送り、**cursor は最後の 1 回にだけ付ける**。途中の batch に付けると、
       * 後ろの batch が落ちたとき cloud の cursor だけが先へ行き、その範囲が二度と読まれない。
       * 0 件でも 1 回送る — 同期した事実（last_synced_at）は残す。
       */
      const watermark = latestOccurredAt(items);
      const chunks = items.length === 0 ? [[]] : chunk(items, 500);
      for (const [i, artifacts] of chunks.entries()) {
        const last = i === chunks.length - 1;
        await this.#deps.push({ source, cursor: last ? cursor : null, watermark, artifacts });
      }
      // push がすべて成功してから、手元の写しを進める。
      if (cursor) this.#cursors.set(source, cursor);
      return { source, status: 'synced', artifacts: items.length, classified };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.#deps.onError?.(source, err);
      // 失敗を cloud にも残す（理由つき）。cursor は動かない。残せなくても同期の結果は変えない。
      await this.#deps
        .attempt?.(source, { ok: false, error: err.message.slice(0, 500) })
        .catch(() => undefined);
      return { source, status: 'failed', artifacts: 0, classified: 0, error: err.message };
    }
  }

  // ------------------------------------------------------------ sources

  /** 読む操作だけを一度待って再試行する。pushや外部送信には使わない。 */
  async #withBackoff<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (
        !(error instanceof ConnectorError) ||
        !['rate_limited', 'timed_out'].includes(error.reason)
      )
        throw error;
      const delay = this.#deps.backoffMs ?? 1_000;
      const sleep =
        this.#deps.sleep ??
        ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
      await sleep(delay);
      return read();
    }
  }

  #since(source: WorkSource, now: Date): Date {
    const cursor = this.#cursors.get(source);
    const fallback = new Date(
      now.getTime() - (this.#deps.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * DAY_MS,
    );
    if (!cursor) return fallback;
    const parsed = Date.parse(cursor);
    return Number.isFinite(parsed) ? new Date(parsed) : fallback;
  }

  #window(now: Date): { timeMin: string; timeMax: string } {
    return {
      timeMin: new Date(
        now.getTime() - (this.#deps.calendarLookbackDays ?? 7) * DAY_MS,
      ).toISOString(),
      timeMax: new Date(
        now.getTime() + (this.#deps.lookaheadDays ?? DEFAULT_LOOKAHEAD_DAYS) * DAY_MS,
      ).toISOString(),
    };
  }

  async #gmail(
    now: Date,
    ctx: NormalizeContext,
  ): Promise<{ artifacts: WorkArtifact[]; cursor: string | null }> {
    const gmail = this.#deps.connectors.gmail();
    const since = this.#since('gmail', now);
    // Gmail の `after:` は秒。1 秒引いて、境界の 1 通を落とさない。
    const query = [
      `after:${String(Math.max(0, Math.floor(since.getTime() / 1000) - 1))}`,
      this.#deps.googleQuery,
    ]
      .filter(Boolean)
      .join(' ');
    const [inbox, sent] = await Promise.all([
      gmail.list({ query, labelIds: ['INBOX'], maxResults: 50 }),
      gmail.list({ query, labelIds: ['SENT'], maxResults: 50 }),
    ]);
    // A self-delivered Gmail message can have both INBOX and SENT labels.
    // Keep its incoming copy so the same artifact ID cannot overwrite it as outgoing.
    const inboxIds = new Set(inbox.map((message) => message.id));
    const artifacts = [
      ...inbox.map((m) => fromGmail(m, 'inbound', ctx)),
      ...sent.filter((m) => !inboxIds.has(m.id)).map((m) => fromGmail(m, 'outbound', ctx)),
    ].filter((a): a is WorkArtifact => a !== null);
    return { artifacts, cursor: latest(artifacts, since) };
  }

  async #googleCalendar(
    now: Date,
    ctx: NormalizeContext,
  ): Promise<{ artifacts: WorkArtifact[]; cursor: string | null }> {
    const events = await this.#deps.connectors.googleCalendar().list({
      ...this.#window(now),
      ...(this.#deps.googleQuery ? { query: this.#deps.googleQuery } : {}),
    });
    return {
      artifacts: events
        .map((e) => fromGoogleCalendar(e, ctx))
        .filter((a): a is WorkArtifact => a !== null),
      cursor: null,
    };
  }

  async #outlookMail(
    now: Date,
    ctx: NormalizeContext,
  ): Promise<{ artifacts: WorkArtifact[]; cursor: string | null }> {
    const outlook = this.#deps.connectors.outlookMail();
    const since = this.#since('outlook_mail', now).toISOString();
    const restriction = this.#deps.microsoftQuery;
    const [inbox, sent] = await Promise.all([
      outlook.list({
        folder: 'inbox',
        since,
        maxResults: 50,
        ...(restriction ? { query: restriction } : {}),
      }),
      outlook.list({
        folder: 'sentitems',
        since,
        maxResults: 50,
        ...(restriction ? { query: restriction } : {}),
      }),
    ]);
    const artifacts = [...inbox, ...sent]
      .filter((m) => !restriction || m.subject.includes(restriction))
      .map((m) => fromOutlookMail(m, ctx))
      .filter((a): a is WorkArtifact => a !== null);
    return { artifacts, cursor: latest(artifacts, new Date(since)) };
  }

  async #outlookCalendar(
    now: Date,
    ctx: NormalizeContext,
  ): Promise<{ artifacts: WorkArtifact[]; cursor: string | null }> {
    const events = await this.#deps.connectors.outlookCalendar().list(this.#window(now));
    return {
      artifacts: events
        .filter((e) => !this.#deps.microsoftQuery || e.title.includes(this.#deps.microsoftQuery))
        .map((e) => fromOutlookCalendar(e, ctx))
        .filter((a): a is WorkArtifact => a !== null),
      cursor: null,
    };
  }

  async #todo(
    ctx: NormalizeContext,
  ): Promise<{ artifacts: WorkArtifact[]; cursor: string | null }> {
    const tasks = await this.#deps.connectors.todo().list();
    return {
      artifacts: tasks.map((t) => fromTodo(t, ctx)).filter((a): a is WorkArtifact => a !== null),
      cursor: null,
    };
  }

  // ------------------------------------------------------------ semantic

  /**
   * メールに意味を付ける（端末の LLM）。
   *
   * **渡すのは件名と抜粋だけ。**本文は手元にも無い。
   * 読めない返事は捨てて null のまま送る（cloud 側の規則が補う）。
   * LLM が無い・落ちたときも同じ — **止めない、作らない。**
   */
  async #classify(
    artifacts: readonly WorkArtifact[],
  ): Promise<{ items: WorkArtifact[]; classified: number }> {
    const llm = this.#deps.llm;
    const limit = this.#deps.maxClassifications ?? DEFAULT_MAX_CLASSIFICATIONS;
    if (!llm || !llm.handles(CLASSIFY_TOOL)) return { items: [...artifacts], classified: 0 };

    let asked = 0;
    let classified = 0;
    const items: WorkArtifact[] = [];
    for (const art of artifacts) {
      if (art.kind !== 'email' || art.semantic !== null) {
        items.push(art);
        continue;
      }
      let semantic = this.#classified.get(art.id);
      if (semantic === undefined) {
        if (asked >= limit) {
          items.push(art);
          continue;
        }
        asked += 1;
        semantic = await this.#ask(llm, art);
        this.#classified.set(art.id, semantic);
      }
      if (semantic) classified += 1;
      items.push(semantic ? { ...art, semantic } : art);
    }
    return { items, classified };
  }

  async #ask(llm: StepRunner, art: WorkArtifact): Promise<WorkSemantic | null> {
    const from = art.people.find((p) => p.role === 'from');
    const to = art.people.filter((p) => p.role === 'to').map((p) => p.name);
    const outcome = await llm.run({
      id: `classify:${art.id}`,
      toolId: CLASSIFY_TOOL,
      args: {
        direction: art.direction,
        from: from?.name ?? null,
        to,
        subject: art.title,
        excerpt: art.body_excerpt ?? '',
        occurred_at: art.occurred_at,
      },
      approval: null,
    });
    if (!outcome.ok) return null;
    return semanticFrom(outcome.result);
  }

  // ---------------------------------------------------------------- loop

  /** 間隔で回し続ける。最初の 1 回はすぐ。 */
  start(intervalMs: number = DEFAULT_SYNC_INTERVAL_MS): void {
    if (this.#timer) return;
    this.#stopping = false;
    const tick = (): void => {
      if (this.#stopping) return;
      void this.syncOnce().finally(() => {
        if (this.#stopping) return;
        this.#timer = setTimeout(tick, intervalMs);
        this.#timer.unref?.();
      });
    };
    tick();
  }

  stop(): void {
    this.#stopping = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

export const CLASSIFY_TOOL = 'llm.classify_email';

/**
 * LLM の返事を `WorkSemantic` にする。**形が合わなければ null。**
 * 半分だけ合っている返事を無理に使うと、根拠の無い「依頼」が台帳に載る。
 */
export function semanticFrom(value: unknown): WorkSemantic | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const parsed = WorkSemantic.safeParse({
    category: raw['category'],
    project: raw['project'] ?? null,
    request: raw['request'] ?? null,
    owner: raw['owner'] ?? null,
    waiting_on: raw['waiting_on'] ?? null,
    // A date-only model answer has no time/zone. Keep the valid classification
    // but leave its timestamp unset rather than inventing midnight or losing the project.
    due:
      typeof raw['due'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw['due'])
        ? null
        : (raw['due'] ?? null),
    confidence: typeof raw['confidence'] === 'number' ? raw['confidence'] : 0.5,
    extracted_by: 'llm',
  });
  return parsed.success ? parsed.data : null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 見えた occurred_at の最大（watermark）。無ければ null。 */
function latestOccurredAt(artifacts: readonly WorkArtifact[]): string | null {
  let max: number | null = null;
  for (const a of artifacts) {
    const t = Date.parse(a.occurred_at);
    if (Number.isFinite(t) && (max === null || t > max)) max = t;
  }
  return max === null ? null : new Date(max).toISOString();
}

/** 一番新しい occurred_at。何も無ければ元の since を続きにする。 */
function latest(artifacts: readonly WorkArtifact[], since: Date): string {
  let max = since.getTime();
  for (const a of artifacts) {
    const t = Date.parse(a.occurred_at);
    if (Number.isFinite(t) && t > max) max = t;
  }
  return new Date(max).toISOString();
}
