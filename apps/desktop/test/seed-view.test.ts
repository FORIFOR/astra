/** 終わった仕事を開いたとき、一覧の行から view を組む（stream は過去を流さない）。 */
import { describe, expect, it } from 'vitest';
import type { Task } from '@astra/contracts';
import { isTerminal, seedWorkView } from '../src/work/workView.js';

const base = {
  title: 'A社 商談準備',
  status: 'COMPLETED',
  result_artifact_id: 'art-1',
  error: null,
  started_at: '2026-08-27T03:00:00.000Z',
  completed_at: '2026-08-27T03:02:30.000Z',
} as unknown as Task;

describe('seedWorkView', () => {
  it('carries title, status, artifact and timing from the row', () => {
    const view = seedWorkView(base);
    expect(view.title).toBe('A社 商談準備');
    expect(view.status).toBe('COMPLETED');
    expect(view.resultArtifactId).toBe('art-1');
    expect(view.elapsedMs).toBe(150_000);
    expect(view.startedAt).toBe(base.started_at);
    expect(view.endedAt).toBe(base.completed_at);
    expect(view.lastSequence).toBe(0);
  });

  it('keeps a failure explainable, without the tool wording', () => {
    const failed = {
      ...base,
      status: 'FAILED',
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'ECONNRESET at socket',
        recovery: 'retry',
        handoff_explanation: '検索の提供元に繋がりませんでした',
      },
    } as unknown as Task;
    const view = seedWorkView(failed);
    expect(view.error).toEqual({
      code: 'PROVIDER_UNAVAILABLE',
      recovery: 'retry',
      explanation: '検索の提供元に繋がりませんでした',
    });
    expect(JSON.stringify(view)).not.toContain('ECONNRESET');
  });

  it('knows which states have nothing more to stream', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('RUNNING')).toBe(false);
    expect(isTerminal('UNKNOWN')).toBe(false);
  });
});
