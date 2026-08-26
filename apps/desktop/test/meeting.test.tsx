/**
 * Meeting / Recording UX。UI-4 / UI-5。UI/UX §12・§18。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { uuidv7, type EventEnvelope, type MeetingSegment } from '@astra/contracts';
import {
  applyMeetingEvent,
  elapsedLabel,
  emptyMeetingView,
  speakerLabel,
  speakersSoFar,
} from '../src/meeting/meetingView.js';
import { StartConfirmation } from '../src/meeting/StartConfirmation.js';
import { RecordingIndicator } from '../src/meeting/RecordingIndicator.js';
import { MeetingSurface } from '../src/meeting/MeetingSurface.js';
import { Finalizing, finalizeSteps } from '../src/meeting/Finalizing.js';
import { MeetingArtifact } from '../src/meeting/MeetingArtifact.js';
import { MeetingProvider, useMeeting } from '../src/meeting/MeetingProvider.js';
import { MeetingLayer } from '../src/meeting/MeetingLayer.js';
import type { ReactElement } from 'react';

afterEach(cleanup);

const base = {
  event_id: uuidv7(),
  timestamp: new Date().toISOString(),
  tenant_id: uuidv7(),
  stream_kind: 'meeting' as const,
  stream_id: uuidv7(),
};

const evt = (sequence: number, type: string, payload: unknown): EventEnvelope =>
  ({ ...base, event_id: uuidv7(), type, sequence, payload }) as EventEnvelope;

const partial = (sequence: number, text: string, speakerTag = 1) =>
  evt(sequence, 'meeting.transcript.partial', {
    segment_id: `partial:${sequence}`,
    speaker_tag: speakerTag,
    text,
    start_ms: 0,
    end_ms: 1_000,
    language: 'ja-JP',
  });

const settled = (sequence: number, id: string, text: string, speakerTag = 1, startMs = 0) =>
  evt(sequence, 'meeting.transcript.final', {
    segment_id: id,
    speaker_tag: speakerTag,
    text,
    start_ms: startMs,
    end_ms: startMs + 1_000,
    language: 'ja-JP',
  });

describe('meetingView', () => {
  it('replaces the interim line instead of piling lines up', () => {
    // 積むと画面が伸び続け、確定のたびに位置が跳ぶ
    let view = emptyMeetingView;
    view = applyMeetingEvent(view, partial(1, '初期'));
    view = applyMeetingEvent(view, partial(2, '初期ひよう'));
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]!.text).toBe('初期ひよう');
    expect(view.lines[0]!.interim).toBe(true);
  });

  it('drops the interim once the segment settles', () => {
    let view = emptyMeetingView;
    view = applyMeetingEvent(view, partial(1, '初期ひ'));
    view = applyMeetingEvent(view, settled(2, 'a', '初期費用が気になります'));
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]!.interim).toBe(false);
    expect(view.lines[0]!.text).toBe('初期費用が気になります');
  });

  it('does not duplicate a segment that arrives twice', () => {
    let view = emptyMeetingView;
    view = applyMeetingEvent(view, settled(1, 'a', '一度だけ'));
    view = applyMeetingEvent(view, settled(2, 'a', '一度だけ'));
    expect(view.lines).toHaveLength(1);
  });

  it('attaches a translation to the line it belongs to', () => {
    let view = emptyMeetingView;
    view = applyMeetingEvent(view, settled(1, 'a', '分割なら'));
    view = applyMeetingEvent(
      view,
      evt(2, 'meeting.translation.final', {
        segment_id: 'a',
        target_language: 'en-US',
        text: 'We can split it',
      }),
    );
    expect(view.lines[0]!.translation).toBe('We can split it');
  });

  it('clears any unsettled line when the meeting ends', () => {
    let view = emptyMeetingView;
    view = applyMeetingEvent(view, settled(1, 'a', '確定'));
    view = applyMeetingEvent(view, partial(2, '言いかけ'));
    view = applyMeetingEvent(
      view,
      evt(3, 'meeting.ended', { status: 'COMPLETE', finalize_task_id: 'task-1' }),
    );
    expect(view.ended).toBe(true);
    expect(view.lines.map((l) => l.text)).toEqual(['確定']);
    expect(view.finalizeTaskId).toBe('task-1');
  });

  it('counts only speakers who actually settled', () => {
    let view = emptyMeetingView;
    view = applyMeetingEvent(view, settled(1, 'a', 'x', 1));
    view = applyMeetingEvent(view, settled(2, 'b', 'y', 2));
    view = applyMeetingEvent(view, partial(3, 'z', 3));
    expect(speakersSoFar(view.lines)).toBe(2);
  });

  it('shows a number until somebody is named, and never guesses', () => {
    expect(speakerLabel(2, new Map())).toBe('Speaker 2');
    expect(speakerLabel(2, new Map([[2, '田中']]))).toBe('田中');
    expect(speakerLabel(null, new Map())).toBe('不明');
  });

  it('formats elapsed time the way the indicator shows it', () => {
    expect(elapsedLabel(0)).toBe('0:00');
    expect(elapsedLabel(1_122_000)).toBe('18:42');
    expect(elapsedLabel(3_723_000)).toBe('1:02:03');
  });
});

describe('StartConfirmation (§12.1)', () => {
  it('refuses to start until consent is confirmed', async () => {
    const onStart = vi.fn();
    render(<StartConfirmation defaultTitle="A社 新規提案" onCancel={() => {}} onStart={onStart} />);

    const start = screen.getByRole('button', { name: '記録を開始' });
    // 同意の確認を飛ばして始められてはならない
    expect((start as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByLabelText('参加者への録音・文字起こしの同意を確認しました'));
    expect((start as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(start);
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'A社 新規提案', audioSources: ['microphone'] }),
    );
  });

  it('refuses to start when nothing would be recorded', async () => {
    render(<StartConfirmation defaultTitle="定例" onCancel={() => {}} onStart={() => {}} />);
    await userEvent.click(screen.getByLabelText('参加者への録音・文字起こしの同意を確認しました'));
    await userEvent.click(screen.getByLabelText('マイク'));
    expect((screen.getByRole('button', { name: '記録を開始' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows each audio source separately', () => {
    render(<StartConfirmation onCancel={() => {}} onStart={() => {}} />);
    expect(screen.getByLabelText('マイク')).toBeTruthy();
    expect(screen.getByLabelText('システム音声')).toBeTruthy();
  });

  it('only asks for a target language once translation is on', async () => {
    render(<StartConfirmation defaultTitle="定例" onCancel={() => {}} onStart={() => {}} />);
    expect(screen.queryByLabelText('翻訳先')).toBeNull();
    await userEvent.click(screen.getByLabelText('翻訳'));
    expect(screen.getByLabelText('翻訳先')).toBeTruthy();
  });
});

describe('RecordingIndicator (§12.2, §18)', () => {
  it('says it is recording to a screen reader, not only in colour', () => {
    render(
      <RecordingIndicator
        state="recording"
        title="A社 新規提案"
        elapsedMs={1_122_000}
        speakers={3}
        onPause={() => {}}
        onStop={() => {}}
      />,
    );
    // 色だけで録音中を示さない（§18）
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Recording — A社 新規提案');
    expect(screen.getByText('18:42')).toBeTruthy();
    expect(screen.getByText('3 speakers')).toBeTruthy();
  });

  it('says the recording continues while transcription is degraded', () => {
    render(
      <RecordingIndicator
        state="degraded"
        title="定例"
        elapsedMs={0}
        speakers={1}
        onPause={() => {}}
        onStop={() => {}}
      />,
    );
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe(
      'Recording, transcription degraded — 定例',
    );
    expect(screen.getByText(/録音は継続中/)).toBeTruthy();
  });
});

describe('MeetingSurface (§12.3)', () => {
  const view = {
    lines: [
      {
        id: 'a',
        speakerTag: 1,
        text: '初期費用が気になります',
        startMs: 0,
        endMs: 1_000,
        interim: false,
        translation: null,
      },
    ],
    ended: false,
    finalizeTaskId: null,
  };

  const surface = (over: Partial<Parameters<typeof MeetingSurface>[0]> = {}) =>
    render(
      <MeetingSurface
        title="A社 新規提案"
        view={view}
        elapsedMs={0}
        state="recording"
        notes="価格条件について"
        speakerNames={new Map()}
        onNotesChange={() => {}}
        onMark={() => {}}
        onNameSpeaker={() => {}}
        onPause={() => {}}
        onStop={() => {}}
        {...over}
      />,
    );

  it('puts notes first and keeps the transcript closed', () => {
    surface();
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('価格条件について');
    // transcript は求められるまで開かない
    expect(screen.queryByLabelText('Transcript')).toBeNull();
    expect(screen.getByRole('button', { name: 'Transcript' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('opens the transcript on demand', async () => {
    surface();
    await userEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(screen.getByLabelText('Transcript')).toBeTruthy();
    expect(screen.getByText('初期費用が気になります')).toBeTruthy();
  });

  it('never rewrites the notes on its own', async () => {
    const onNotesChange = vi.fn();
    surface({ onNotesChange });
    await userEvent.type(screen.getByLabelText('Notes'), '!');
    // 入力は必ず呼び出し側へ返す。AI が勝手に書き換える経路を作らない。
    expect(onNotesChange).toHaveBeenCalled();
  });

  it('marks a moment with one click', async () => {
    const onMark = vi.fn();
    surface({ onMark });
    await userEvent.click(screen.getByRole('button', { name: '決定' }));
    expect(onMark).toHaveBeenCalledWith('decision');
  });

  it('lets a speaker be named from the transcript', async () => {
    const onNameSpeaker = vi.fn();
    surface({ onNameSpeaker });
    await userEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    await userEvent.click(screen.getByRole('button', { name: 'Speaker 1' }));
    expect(onNameSpeaker).toHaveBeenCalledWith(1);
  });
});

describe('Finalizing (§12.5)', () => {
  it('tells the user the window can be closed', () => {
    render(<Finalizing title="A社 新規提案" completedSteps={2} />);
    expect(screen.getByText(/閉じても構いません/)).toBeTruthy();
  });

  it('marks what is done, what is running and what is waiting', () => {
    const steps = finalizeSteps(2);
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'running', 'waiting', 'waiting']);
  });
});

describe('MeetingArtifact (§12.6)', () => {
  const segments = [
    { id: 'a', speaker_tag: 1, text: '初期費用が気になります', start_ms: 65_000 },
    { id: 'b', speaker_tag: 2, text: 'では10月で行きましょう', start_ms: 130_000 },
  ] as unknown as MeetingSegment[];

  const bundle = {
    meeting_id: uuidv7(),
    title: 'A社 新規提案',
    duration_ms: 2_532_000,
    speaker_count: 2,
    summary: [{ text: '初期費用が最大の懸念', citations: [{ segment_id: 'a', start_ms: 65_000 }] }],
    decisions: [{ text: '10 月導入', citations: [{ segment_id: 'b', start_ms: 130_000 }] }],
    action_items: [],
    open_questions: [],
  };

  it('jumps from a citation to the transcript line and its timestamp', async () => {
    render(
      <MeetingArtifact
        bundle={bundle as never}
        segments={segments}
        names={new Map([[2, '伊藤']])}
      />,
    );
    // 結論が先に出る
    expect(screen.getByText('初期費用が最大の懸念')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: '根拠 2 を見る' }));
    const evidence = screen.getByLabelText('根拠');
    expect(evidence.textContent).toContain('02:10');
    expect(evidence.textContent).toContain('伊藤');
    expect(evidence.textContent).toContain('では10月で行きましょう');
  });
});

describe('MeetingProvider (§12)', () => {
  const meeting = {
    id: 'm1',
    tenant_id: 't1',
    title: 'A社 新規提案',
    status: 'RECORDING',
    language: 'ja-JP',
    target_language: null,
    audio_sources: ['microphone'],
    consent_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    ended_at: null,
    degraded_at: null,
    recording_artifact_id: null,
    bundle_artifact_id: null,
    finalize_task_id: null,
    created_by: 'u1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const fakeClient = (over: Record<string, unknown> = {}) =>
    ({
      startMeeting: vi.fn().mockResolvedValue(meeting),
      streamMeeting: vi.fn().mockResolvedValue(0),
      finishMeeting: vi.fn().mockResolvedValue({ meetingId: 'm1', taskId: 'task-9' }),
      nameSpeaker: vi.fn().mockResolvedValue({}),
      ...over,
    }) as never;

  const Harness = ({ client }: { client: never }): ReactElement => (
    <MeetingProvider client={client}>
      <MeetingLayer />
      <StartButton />
    </MeetingProvider>
  );

  const StartButton = (): ReactElement => {
    const { requestStart } = useMeeting();
    return (
      <button type="button" onClick={requestStart}>
        会議を記録
      </button>
    );
  };

  it('asks for confirmation before it records anything', async () => {
    const client = fakeClient();
    render(<Harness client={client} />);
    await userEvent.click(screen.getByRole('button', { name: '会議を記録' }));

    // 押した瞬間に録り始めない
    expect(
      (client as unknown as { startMeeting: ReturnType<typeof vi.fn> }).startMeeting,
    ).not.toHaveBeenCalled();
    expect(screen.getByLabelText('録音の開始確認')).toBeTruthy();
  });

  it('records only after consent, then shows the minimal indicator', async () => {
    const client = fakeClient();
    render(<Harness client={client} />);
    await userEvent.click(screen.getByRole('button', { name: '会議を記録' }));
    await userEvent.type(screen.getByLabelText('会議名'), '定例');
    await userEvent.click(screen.getByLabelText('参加者への録音・文字起こしの同意を確認しました'));
    await userEvent.click(screen.getByRole('button', { name: '記録を開始' }));

    // 大きな録音画面を常駐させない。まず最小の indicator。
    expect(screen.getByRole('status').getAttribute('aria-label')).toContain('Recording');
    expect(screen.queryByLabelText('Notes')).toBeNull();
  });

  it('says why it could not start rather than staying silent', async () => {
    const client = fakeClient({
      startMeeting: vi.fn().mockRejectedValue(new Error('マイクが使えません')),
    });
    render(<Harness client={client} />);
    await userEvent.click(screen.getByRole('button', { name: '会議を記録' }));
    await userEvent.type(screen.getByLabelText('会議名'), '定例');
    await userEvent.click(screen.getByLabelText('参加者への録音・文字起こしの同意を確認しました'));
    await userEvent.click(screen.getByRole('button', { name: '記録を開始' }));

    expect(screen.getByRole('alert').textContent).toContain('マイクが使えません');
  });

  it('hands the finalize off and tells the user they can close the window', async () => {
    const client = fakeClient();
    render(<Harness client={client} />);
    await userEvent.click(screen.getByRole('button', { name: '会議を記録' }));
    await userEvent.type(screen.getByLabelText('会議名'), '定例');
    await userEvent.click(screen.getByLabelText('参加者への録音・文字起こしの同意を確認しました'));
    await userEvent.click(screen.getByRole('button', { name: '記録を開始' }));
    await userEvent.click(screen.getByRole('button', { name: '終了' }));

    expect(screen.getByText(/閉じても構いません/)).toBeTruthy();
  });
});
