/**
 * Claude を会議のまとめ役に使うときの取り決め。Phase 3 §5。
 * 実際の API は叩かない。**モデルが破れない保証**だけを確かめる。
 */
import { describe, expect, it, vi } from 'vitest';
import { uuidv7, type MeetingSegment } from '@astra/contracts';
import { AnthropicSummarizer } from '../src/anthropic.js';
import { withCitations } from '../src/summarize.js';

const seg = (text: string, speakerTag = 1): MeetingSegment =>
  ({
    id: uuidv7(),
    meeting_id: 'm',
    pass: 'final',
    speaker_tag: speakerTag,
    text,
    start_ms: 0,
    end_ms: 1_000,
    language: 'ja-JP',
    confidence: 0.9,
    supersedes: [],
    created_at: new Date().toISOString(),
  }) as unknown as MeetingSegment;

const respond = (input: unknown) =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify({ content: [{ type: 'tool_use', name: 'record_minutes', input }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
  );

const summarizer = (fetch: ReturnType<typeof respond>) =>
  new AnthropicSummarizer({ apiKey: 'k', fetch, retries: 0 });

const empty = { summary: [], decisions: [], action_items: [], open_questions: [] };

describe('AnthropicSummarizer', () => {
  it('is not a stand-in, so the production guard lets it through', () => {
    expect(new AnthropicSummarizer({ apiKey: 'k' }).isStandIn).toBe(false);
    expect(() => new AnthropicSummarizer({ apiKey: '' })).toThrow(/API key/);
  });

  it('does not call the model when nothing was said', async () => {
    const fetch = respond(empty);
    expect(await summarizer(fetch).summarize([])).toEqual({
      summary: [],
      decisions: [],
      actionItems: [],
      openQuestions: [],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the model numbered lines, never the raw ids', async () => {
    // 長い uuid を写させると、写し間違いがそのまま引用の欠落になる
    const segments = [seg('初期費用が気になります'), seg('10 月で行きましょう', 2)];
    const fetch = respond(empty);
    await summarizer(fetch).summarize(segments);

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain('1. [話者 1] 初期費用が気になります');
    expect(prompt).toContain('2. [話者 2] 10 月で行きましょう');
    expect(prompt).not.toContain(String(segments[0]!.id));
  });

  it('turns the numbers it chose into real segment ids', async () => {
    const segments = [seg('初期費用が気になります'), seg('10 月で行きましょう', 2)];
    const fetch = respond({
      ...empty,
      decisions: [{ text: '10 月導入', segments: [2] }],
    });
    const draft = await summarizer(fetch).summarize(segments);
    expect(draft.decisions[0]!.segmentIds).toEqual([String(segments[1]!.id)]);
  });

  it('throws away numbers that point at no line', async () => {
    // 跳べない引用を作らない。ここが AC3-9 の防波堤。
    const segments = [seg('一つだけ')];
    const fetch = respond({
      ...empty,
      summary: [{ text: '架空の要点', segments: [5] }],
      decisions: [{ text: '本物', segments: [1] }],
    });
    const draft = await summarizer(fetch).summarize(segments);
    expect(draft.summary[0]!.segmentIds).toEqual([]);
    expect(draft.decisions[0]!.segmentIds).toEqual([String(segments[0]!.id)]);

    // 引用の無い項目は、bundle を作る段で落ちる
    const cited = withCitations(draft, segments);
    expect(cited.summary).toHaveLength(0);
    expect(cited.decisions).toHaveLength(1);
    expect(cited.dropped).toBe(1);
  });

  it('keeps an unknown assignee null instead of inventing one', async () => {
    const segments = [seg('見積を送ります')];
    const fetch = respond({
      ...empty,
      action_items: [{ text: '見積を送る', segments: [1], assignee: '  ' }],
    });
    const draft = await summarizer(fetch).summarize(segments);
    expect(draft.actionItems[0]!.assignee).toBeNull();
  });

  it('fails loudly when the model answers with prose', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'すみません' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const m = new AnthropicSummarizer({ apiKey: 'k', fetch, retries: 0 });
    await expect(m.summarize([seg('何か')])).rejects.toThrow(/did not call/);
  });
});
