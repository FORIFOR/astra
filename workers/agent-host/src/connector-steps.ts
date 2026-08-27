/**
 * 端末で connector の step を走らせる。正本 §2.4・§4.4・§21。
 *
 * **ここが、トークンが存在する唯一の場所。**
 * cloud から来るのは「何をしてほしいか」だけで、鍵は端末の資格情報ストアにある。
 *
 * 承認は cloud で取ってあるが、**ここでもう一度確かめる。**
 * 経路が 1 本しかないと、いつか誰かが近道を作り、それが既定になる。
 */
import {
  ApprovalRequired,
  ConnectorError,
  CONNECTOR_RECOVERY,
  GmailConnector,
  GoogleCalendarConnector,
  type ApprovalProof,
  type CreateEventInput,
  type DraftMessage,
} from '@astra/service-connectors';
import {
  needsRefresh,
  refresh,
  TokenStore,
  type ProviderConfig,
  type SecretStore,
} from '@astra/oauth';

/** cloud から渡ってくる、端末にやってほしいこと。 */
export interface HostStep {
  readonly id: string;
  readonly toolId: string;
  readonly args: Record<string, unknown>;
  readonly approval: ApprovalProof | null;
}

export interface StepOutcome {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { code: string; message: string };
}

export interface ConnectorRuntimeDeps {
  readonly secrets: SecretStore;
  /** どの connector にどの参照が結びついているか。 */
  readonly credentialRefFor: (pluginId: string, connectorId: string) => string;
  /** 実際に許された scope。**要求した scope ではない。** */
  readonly grantedScopes: (pluginId: string) => readonly string[];
  /** トークンを更新するための設定。無ければ更新しない（切れたら繋ぎ直しを促す）。 */
  readonly refreshConfig?: (provider: string) => ProviderConfig | null;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

const GMAIL_PLUGIN = 'com.astra.gmail';
const CALENDAR_PLUGIN = 'com.astra.google-calendar';

export class ConnectorRuntime {
  readonly #deps: ConnectorRuntimeDeps;
  readonly #tokens: TokenStore;

  constructor(deps: ConnectorRuntimeDeps) {
    this.#deps = deps;
    this.#tokens = new TokenStore(deps.secrets);
  }

  /** この端末はこの step を扱えるか。**扱えないものを引き受けない。** */
  handles(toolId: string): boolean {
    return toolId.startsWith('mail.') || toolId.startsWith('calendar.');
  }

  /**
   * 走らせる。
   *
   * **失敗を成功として返さない。**理由は種類ごとに分け、
   * 「何をすれば直るか」まで載せる（§21）。
   */
  async run(step: HostStep, signal?: AbortSignal): Promise<StepOutcome> {
    try {
      return { ok: true, result: await this.#dispatch(step, signal) };
    } catch (error) {
      if (error instanceof ApprovalRequired) {
        return {
          ok: false,
          error: {
            code: 'connector.approval_required',
            message: 'この操作には確認が必要です。',
          },
        };
      }
      if (error instanceof ConnectorError) {
        return {
          ok: false,
          error: {
            code: `connector.${error.reason}`,
            // tool 側の文言をそのまま出さない（§7.2）。何をすれば直るかを言う。
            message: CONNECTOR_RECOVERY[error.reason],
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'connector.failed',
          message: '端末でこの操作を完了できませんでした。',
        },
      };
    }
  }

  async #dispatch(step: HostStep, signal?: AbortSignal): Promise<unknown> {
    const { args } = step;

    switch (step.toolId) {
      case 'mail.search':
        return (await this.#gmail()).list(
          {
            ...(typeof args['query'] === 'string' ? { query: args['query'] } : {}),
            ...(typeof args['max_results'] === 'number' ? { maxResults: args['max_results'] } : {}),
          },
          signal,
        );
      case 'mail.read':
        return (await this.#gmail()).get(requireString(args, 'message_id'), signal);
      case 'mail.draft.create':
        return (await this.#gmail()).draft(draftFrom(args), signal);
      case 'mail.send':
        return (await this.#gmail()).send(draftFrom(args), step.approval ?? undefined, signal);
      case 'mail.trash':
        return (await this.#gmail()).trash(
          requireString(args, 'message_id'),
          step.approval ?? undefined,
          signal,
        );
      case 'calendar.list_events':
        return (await this.#calendar()).list(
          {
            timeMin: requireString(args, 'time_min'),
            timeMax: requireString(args, 'time_max'),
            ...(typeof args['query'] === 'string' ? { query: args['query'] } : {}),
          },
          signal,
        );
      case 'calendar.get_event':
        return (await this.#calendar()).get({ eventId: requireString(args, 'event_id') }, signal);
      case 'calendar.create_event':
        return (await this.#calendar()).create(eventFrom(args), step.approval ?? undefined, signal);
      default:
        // 知らない step を、何もせず成功にしない
        throw new ConnectorError('not_found', `this device does not handle ${step.toolId}`);
    }
  }

  async #gmail(): Promise<GmailConnector> {
    return new GmailConnector({
      token: () => this.#accessToken(GMAIL_PLUGIN, 'gmail', 'google'),
      grantedScopes: this.#deps.grantedScopes(GMAIL_PLUGIN),
      ...(this.#deps.fetch ? { fetch: this.#deps.fetch } : {}),
      ...(this.#deps.now ? { now: this.#deps.now } : {}),
    });
  }

  async #calendar(): Promise<GoogleCalendarConnector> {
    return new GoogleCalendarConnector({
      token: () => this.#accessToken(CALENDAR_PLUGIN, 'google-calendar', 'google'),
      grantedScopes: this.#deps.grantedScopes(CALENDAR_PLUGIN),
      ...(this.#deps.fetch ? { fetch: this.#deps.fetch } : {}),
      ...(this.#deps.now ? { now: this.#deps.now } : {}),
    });
  }

  /**
   * 呼ぶ直前にだけ取り出す。**手元に貯めない。**
   *
   * 期限が近ければ更新して置き直す。更新できないときは
   * 「繋ぎ直してください」と言う — 期限切れのまま呼んで
   * 意味の分からない 401 を見せない。
   */
  async #accessToken(pluginId: string, connectorId: string, provider: string): Promise<string> {
    const ref = this.#deps.credentialRefFor(pluginId, connectorId);
    const tokens = await this.#tokens.load(ref);
    if (!tokens) throw new ConnectorError('not_connected', `${pluginId} is not connected`);

    const now = (this.#deps.now ?? (() => new Date()))().getTime();
    const expired = tokens.expiresAt !== null && Date.parse(tokens.expiresAt) <= now;
    if (!expired && !needsRefresh(tokens, now)) return tokens.accessToken;

    const config = this.#deps.refreshConfig?.(provider);
    if (!config || !tokens.refreshToken) {
      /*
       * 更新できない。**切れたトークンで呼びに行かない。**
       * 呼べば 401 が返るだけで、利用者には提供者側の失敗に見える。
       * 「繋ぎ直してください」と言えるのはここだけ。
       */
      if (expired) {
        throw new ConnectorError('token_expired', `${pluginId} needs to be connected again`);
      }
      // まだ切れてはいない。更新できないだけなので、今回はそのまま使う。
      return tokens.accessToken;
    }
    const renewed = await refresh(
      config,
      tokens.refreshToken,
      this.#deps.fetch ?? globalThis.fetch,
      () => now,
    );
    await this.#tokens.save(pluginId, connectorId, renewed);
    return renewed.accessToken;
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConnectorError('provider_error', `${key} is required`);
  }
  return value;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function draftFrom(args: Record<string, unknown>): DraftMessage {
  return {
    to: stringList(args['to']),
    ...(stringList(args['cc']).length ? { cc: stringList(args['cc']) } : {}),
    ...(stringList(args['bcc']).length ? { bcc: stringList(args['bcc']) } : {}),
    subject: typeof args['subject'] === 'string' ? args['subject'] : '',
    body: typeof args['body'] === 'string' ? args['body'] : '',
    ...(typeof args['in_reply_to'] === 'string' ? { inReplyTo: args['in_reply_to'] } : {}),
  };
}

function eventFrom(args: Record<string, unknown>): CreateEventInput {
  const when = (key: string): CreateEventInput['start'] => {
    const value = args[key];
    if (typeof value === 'string') {
      // 日付だけなら終日。時刻を勝手に足さない。
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { date: value } : { dateTime: value };
    }
    throw new ConnectorError('provider_error', `${key} is required`);
  };
  return {
    title: typeof args['title'] === 'string' ? args['title'] : '',
    start: when('start'),
    end: when('end'),
    ...(typeof args['description'] === 'string' ? { description: args['description'] } : {}),
    ...(typeof args['location'] === 'string' ? { location: args['location'] } : {}),
    ...(stringList(args['attendees']).length
      ? { attendeeEmails: stringList(args['attendees']) }
      : {}),
  };
}
