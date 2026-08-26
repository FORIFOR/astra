/**
 * Claude を会議のまとめ役として使う。Phase 3 実装仕様 §5（OQ-11 とは別に OQ-3 側）。
 *
 * ここでモデルに任せてよいのは「何が要点か」までで、
 * **「どの発言が根拠か」は任せない。**モデルには segment の番号だけを選ばせ、
 * 実在しない番号は捨てる。UI/UX §12.6 の「引用を押すと transcript へ跳ぶ」は、
 * モデルの善意ではなくこの検査で成り立たせる。
 */
import { z } from 'zod';
import type { MeetingSegment } from '@astra/contracts';
import type { MeetingSummarizer, SummaryDraft } from './summarize.js';

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface AnthropicSummarizerConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly fetch?: Fetch;
  readonly retries?: number;
}

const DEFAULT_MODEL = 'claude-sonnet-5';
const API_VERSION = '2023-06-01';

const item = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    segments: {
      type: 'array',
      items: { type: 'integer' },
      description: '根拠になった発言の番号（本文に付けた 1 始まりの番号）',
    },
  },
  required: ['text', 'segments'],
} as const;

const TOOL = {
  name: 'record_minutes',
  description: '会議の要点・決定事項・ToDo・未解決の問いを記録する。',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'array', items: item },
      decisions: { type: 'array', items: item },
      action_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            segments: { type: 'array', items: { type: 'integer' } },
            assignee: { type: 'string', description: '発言から分かる場合だけ' },
            due: { type: 'string', description: '発言から分かる場合だけ' },
          },
          required: ['text', 'segments'],
        },
      },
      open_questions: { type: 'array', items: item },
    },
    required: ['summary', 'decisions', 'action_items', 'open_questions'],
  },
} as const;

const Entry = z.object({ text: z.string(), segments: z.array(z.number().int()) });
const Minutes = z.object({
  summary: z.array(Entry),
  decisions: z.array(Entry),
  action_items: z.array(
    Entry.extend({
      assignee: z.string().optional(),
      due: z.string().optional(),
    }),
  ),
  open_questions: z.array(Entry),
});

const MessageResponse = z.object({
  content: z.array(
    z
      .object({ type: z.string(), name: z.string().optional(), input: z.unknown().optional() })
      .passthrough(),
  ),
});

export class AnthropicSummarizer implements MeetingSummarizer {
  readonly isStandIn = false;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #maxTokens: number;
  readonly #fetch: Fetch;
  readonly #retries: number;

  constructor(config: AnthropicSummarizerConfig) {
    if (!config.apiKey) throw new Error('an Anthropic API key is required');
    this.#apiKey = config.apiKey;
    this.#model = config.model ?? DEFAULT_MODEL;
    this.#baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
    this.#maxTokens = config.maxTokens ?? 4_096;
    this.#fetch = config.fetch ?? ((url, init) => fetch(url, init));
    this.#retries = config.retries ?? 1;
  }

  async summarize(segments: readonly MeetingSegment[]): Promise<SummaryDraft> {
    if (segments.length === 0) {
      return { summary: [], decisions: [], actionItems: [], openQuestions: [] };
    }

    // モデルには番号付きの transcript だけを渡す。id は見せない
    // （長い uuid を写させると、写し間違いが引用の欠落になる）。
    const transcript = segments
      .map((s, i) => `${i + 1}. [話者 ${s.speaker_tag ?? '不明'}] ${s.text}`)
      .join('\n');

    const minutes = await this.#call(
      [
        'この会議の要点・決定事項・ToDo・未解決の問いをまとめてください。',
        '**各項目には、根拠になった発言の番号を必ず付けてください。**',
        '発言に無いことは書かないでください。担当者や期限は、発言から分かる場合だけ書いてください。',
        '',
        transcript,
      ].join('\n'),
    );

    // 番号 → segment id。**範囲外は捨てる**（跳べない引用を作らない）。
    const idOf = (numbers: readonly number[]): string[] =>
      numbers
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= segments.length)
        .map((n) => String(segments[n - 1]!.id));

    const entries = (list: readonly z.infer<typeof Entry>[]) =>
      list
        .map((e) => ({ text: e.text.trim(), segmentIds: idOf(e.segments) }))
        .filter((e) => e.text.length > 0);

    return {
      summary: entries(minutes.summary),
      decisions: entries(minutes.decisions),
      actionItems: minutes.action_items
        .map((e) => ({
          text: e.text.trim(),
          segmentIds: idOf(e.segments),
          assignee: e.assignee?.trim() || null,
          due: e.due?.trim() || null,
        }))
        .filter((e) => e.text.length > 0),
      openQuestions: entries(minutes.open_questions),
    };
  }

  async #call(prompt: string): Promise<z.infer<typeof Minutes>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      try {
        const response = await this.#fetch(`${this.#baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.#apiKey,
            'anthropic-version': API_VERSION,
          },
          body: JSON.stringify({
            model: this.#model,
            max_tokens: this.#maxTokens,
            tools: [TOOL],
            tool_choice: { type: 'tool', name: TOOL.name },
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`anthropic responded ${response.status}: ${body.slice(0, 200)}`);
        }
        const parsed = MessageResponse.parse(await response.json());
        const use = parsed.content.find((b) => b.type === 'tool_use' && b.name === TOOL.name);
        if (!use) throw new Error(`anthropic did not call ${TOOL.name}`);
        return Minutes.parse(use.input);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
