/**
 * Video の step。正本 §15.2。
 *
 * **モデルが無いことを、動いたことにしない。**
 */
import { describe, expect, it, vi } from 'vitest';
import { videoExecutors, type VideoRenderer } from '../src/video-executor.js';
import type { DomainEntity } from '@astra/contracts';

const PROJECT = 'proj-1';

const clipEntity = (over: Record<string, unknown>): DomainEntity =>
  ({
    id: String(over['id'] ?? 'c1'),
    plugin_id: 'com.astra.video',
    entity_type: 'video_clip',
    title: String(over['name'] ?? 'クリップ'),
    fields: { name: 'クリップ', order: 1, prompt: '雨の街', duration_ms: 2_000, ...over },
    source_task_id: null,
    source_meeting_id: null,
    created_at: '2026-08-27T00:00:00.000Z',
    updated_at: '2026-08-27T00:00:00.000Z',
  }) as DomainEntity;

const domainWith = (clips: DomainEntity[]) => ({ linked: vi.fn(async () => clips) }) as never;

const task = { taskId: 't1', tenantId: 'ten1', input: { project_id: PROJECT } };
const step = (toolId: string) => ({ toolId, args: {} });

describe('storyboard', () => {
  it('writes what is shown and said, in order', async () => {
    const executors = videoExecutors(
      domainWith([
        clipEntity({ id: 'a', name: '一枚目', order: 1, subtitle: '雨が降る' }),
        clipEntity({ id: 'b', name: '二枚目', order: 2, voiceover: '読む' }),
      ]),
    );
    const out = await executors['video.storyboard']!.execute(task, step('video.storyboard'));

    expect(out.artifact?.markdown).toContain('一枚目');
    expect(out.artifact?.markdown).toContain('字幕: 雨が降る');
    expect(out.artifact?.markdown).toContain('読み: 読む');
    expect(out.detail).toBe('2 コマ');
  });
});

describe('subtitles', () => {
  it('produces WebVTT that can be used as it stands', async () => {
    const executors = videoExecutors(
      domainWith([clipEntity({ id: 'a', order: 1, subtitle: '出る' })]),
    );
    const out = await executors['video.subtitles']!.execute(task, step('video.subtitles'));
    expect(out.artifact?.markdown.startsWith('WEBVTT')).toBe(true);
    expect(out.detail).toBe('1 件');
  });
});

describe('rendering', () => {
  it('says everything that is wrong, not just the first thing', async () => {
    const executors = videoExecutors(
      domainWith([
        clipEntity({ id: 'a', name: '中身なし', order: 1, prompt: null }),
        clipEntity({ id: 'b', name: '尺ゼロ', order: 2, duration_ms: 0 }),
      ]),
    );
    await expect(executors['video.render']!.execute(task, step('video.render'))).rejects.toThrow(
      /中身なし[\s\S]*尺ゼロ|尺ゼロ[\s\S]*中身なし/,
    );
  });

  it('refuses rather than producing something that is not a video', async () => {
    const executors = videoExecutors(domainWith([clipEntity({ id: 'a', order: 1 })]));
    // 代役の「それらしい映像」を Library に残さない
    await expect(executors['video.render']!.execute(task, step('video.render'))).rejects.toThrow(
      /まだ繋がっていません/,
    );
  });

  it('says what did survive, so the work is not lost', async () => {
    const executors = videoExecutors(domainWith([clipEntity({ id: 'a', order: 1 })]));
    await expect(executors['video.render']!.execute(task, step('video.render'))).rejects.toThrow(
      /構成と字幕はここまでで残っています/,
    );
  });

  it('renders once something real is connected', async () => {
    const renderer: VideoRenderer = {
      name: 'test-renderer',
      render: vi.fn(async () => ({ artifactId: 'art-1' })),
    };
    const executors = videoExecutors(domainWith([clipEntity({ id: 'a', order: 1 })]), renderer);
    const out = await executors['video.render']!.execute(task, step('video.render'));
    expect(out.result).toEqual({ artifact_id: 'art-1', renderer: 'test-renderer' });
  });
});

describe('when the project is not named', () => {
  it('asks instead of guessing', async () => {
    const executors = videoExecutors(domainWith([]));
    await expect(
      executors['video.storyboard']!.execute(
        { taskId: 't', tenantId: 'ten', input: {} },
        step('video.storyboard'),
      ),
    ).rejects.toThrow(/映像プロジェクトの指定/);
  });
});
